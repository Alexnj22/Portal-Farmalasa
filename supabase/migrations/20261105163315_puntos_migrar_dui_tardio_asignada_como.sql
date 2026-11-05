-- `asignada_como` sólo acepta 'dui' o 'manual' (CHECK de la tabla): la primera
-- versión escribía 'dui_tardio' y las tres cuentas cayeron a `fallas` sin
-- escribir nada. Es por DUI, así que va 'dui'; lo tardío queda en
-- `asignada_nota`, que empieza con «dui_tardio:». Se cambió la función y no el
-- CHECK para no hacer ALTER TABLE por un rótulo.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_migrar_dui_tardio(p_simular boolean DEFAULT true)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_carga bigint; c record; r json;
  v_pasadas json[] := '{}'; v_fallas json[] := '{}';
BEGIN
  SELECT id INTO v_carga FROM public.puntos_archivo_carga
   WHERE completa ORDER BY id DESC LIMIT 1;
  IF v_carga IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no hay una copia completa del sistema anterior');
  END IF;

  FOR c IN
    WITH a AS (
      SELECT ac.id_cliente, ac.puntos, ac.asignada_a, regexp_replace(coalesce(ac.dui, ''), '\D', '', 'g') AS d
        FROM public.puntos_archivo_cliente ac
       WHERE ac.carga_id = v_carga
    ), por_dui AS (
      SELECT d, count(*) AS n FROM a GROUP BY d
    ), pendientes AS (
      SELECT a.* FROM a JOIN por_dui pd ON pd.d = a.d AND pd.n = 1
       WHERE a.asignada_a IS NULL AND a.puntos > 0 AND length(a.d) >= 8
    ), fichas AS (
      SELECT regexp_replace(cu.dui, '\D', '', 'g') AS d, count(*) AS n, min(cu.id) AS customer_id
        FROM public.customers cu
       WHERE cu.dui IS NOT NULL
         AND regexp_replace(cu.dui, '\D', '', 'g') IN (SELECT d FROM pendientes)
       GROUP BY 1
    )
    SELECT p.id_cliente, p.puntos, f.customer_id
      FROM pendientes p
      JOIN fichas f ON f.d = p.d AND f.n = 1
     WHERE NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc
                        WHERE pc.customer_id = f.customer_id AND pc.fusionada_en IS NOT NULL)
     ORDER BY p.id_cliente
  LOOP
    IF p_simular THEN
      v_pasadas := v_pasadas || json_build_object('id_cliente', c.id_cliente, 'customer_id', c.customer_id, 'puntos', c.puntos);
      CONTINUE;
    END IF;
    BEGIN
      r := public.puntos_sincronizar_cuenta_anterior(v_carga, c.id_cliente, c.customer_id, 'dui', NULL,
             'dui_tardio: el DUI llegó a la ficha después de la migración');
      IF coalesce((r->>'ok')::boolean, false) AND coalesce((r->>'cuadra')::boolean, false) THEN
        v_pasadas := v_pasadas || json_build_object('id_cliente', c.id_cliente, 'customer_id', c.customer_id,
                       'puntos', c.puntos, 'saldo_despues', r->'saldo_despues');
      ELSE
        -- No cuadra o no se pudo: se deshace ESTA cuenta y se deja para revisar a mano.
        RAISE EXCEPTION 'cuenta %: %', c.id_cliente, coalesce(r->>'error', 'no cuadra tras migrar');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fallas := v_fallas || json_build_object('id_cliente', c.id_cliente, 'customer_id', c.customer_id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN json_build_object('ok', true, 'simulado', p_simular, 'carga', v_carga,
    'pasadas', coalesce(array_length(v_pasadas, 1), 0), 'detalle', to_json(v_pasadas),
    'fallas', to_json(v_fallas));
END;
$function$;

