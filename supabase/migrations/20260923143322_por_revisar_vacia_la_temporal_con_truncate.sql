-- «Por revisar» no guardaba NADA: el vaciado de la tabla temporal era un
-- `DELETE` sin `WHERE`, y bajo el API (`service_role` por PostgREST) la
-- extensión `safeupdate` lo rechaza: «DELETE requires a WHERE clause». Las 26
-- filas de la corrida del 23-sep fallaron así, una por una.
--
-- La migración 20260922181804 se probó con `execute_sql` como `postgres`, donde
-- `safeupdate` no está cargada — por eso pasó. `TRUNCATE` vacía la temporal
-- igual y no está sujeto a `safeupdate`. El resto del cuerpo no cambia.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.upsert_clientes_por_revisar(p_filas json)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_con    integer := 0;
  v_sin    integer := 0;
BEGIN
  -- `service_role` es el proceso automático: ya es de confianza y no tiene
  -- empleado que resolver. Sin esta salida, el ÚNICO proceso que alimenta esta
  -- tabla es también el único que no puede escribirla.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'sin permiso para revisar clientes';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _filas_por_revisar (
    erp_id text, name text, motivo text, detalle text, datos jsonb, customer_id bigint
  ) ON COMMIT DROP;
  TRUNCATE _filas_por_revisar;

  INSERT INTO _filas_por_revisar (erp_id, name, motivo, detalle, datos, customer_id)
  SELECT x.erp_id, x.name, x.motivo, x.detalle, x.datos,
         coalesce(x.customer_id, nullif(x.datos->>'customer_id','')::bigint)
  FROM json_to_recordset(p_filas)
       AS x(erp_id text, name text, motivo text, detalle text, datos jsonb, customer_id bigint);

  -- ── Las que traen número: la llave es (erp_id, motivo), como siempre ──────
  INSERT INTO public.clientes_por_revisar
      (erp_id, name, motivo, detalle, datos, customer_id)
  SELECT f.erp_id, f.name, f.motivo, f.detalle, f.datos,
         coalesce(f.customer_id, (SELECT c.id FROM public.customers c WHERE c.erp_id = f.erp_id))
  FROM _filas_por_revisar f
  WHERE f.erp_id IS NOT NULL
  ON CONFLICT (erp_id, motivo) DO UPDATE SET
      name        = EXCLUDED.name,
      detalle     = EXCLUDED.detalle,
      datos       = EXCLUDED.datos,
      customer_id = EXCLUDED.customer_id,
      updated_at  = now()
  -- Sin este guard, repoblar reescribe las 150 filas cada vez aunque nada haya
  -- cambiado: es el mismo churn de WAL que el proyecto prohíbe en los syncs.
  WHERE (public.clientes_por_revisar.name, public.clientes_por_revisar.detalle,
         public.clientes_por_revisar.datos, public.clientes_por_revisar.customer_id)
        IS DISTINCT FROM
        (EXCLUDED.name, EXCLUDED.detalle, EXCLUDED.datos, EXCLUDED.customer_id);
  GET DIAGNOSTICS v_con = ROW_COUNT;

  -- ── Las que NO tienen número: la llave es la ficha del portal ─────────────
  -- Sin `customer_id` no hay nada que identifique la fila, así que no entra: se
  -- descarta acá y no en un error, porque una fila sin llave repetida cada
  -- noche sería peor que perderla.
  INSERT INTO public.clientes_por_revisar
      (erp_id, name, motivo, detalle, datos, customer_id)
  SELECT NULL, f.name, f.motivo, f.detalle, f.datos, f.customer_id
  FROM _filas_por_revisar f
  WHERE f.erp_id IS NULL AND f.customer_id IS NOT NULL
  ON CONFLICT (customer_id, motivo) WHERE erp_id IS NULL DO UPDATE SET
      name        = EXCLUDED.name,
      detalle     = EXCLUDED.detalle,
      datos       = EXCLUDED.datos,
      updated_at  = now()
  WHERE (public.clientes_por_revisar.name, public.clientes_por_revisar.detalle,
         public.clientes_por_revisar.datos)
        IS DISTINCT FROM
        (EXCLUDED.name, EXCLUDED.detalle, EXCLUDED.datos);
  GET DIAGNOSTICS v_sin = ROW_COUNT;

  RETURN v_con + v_sin;
END;
$function$;
