SET lock_timeout = '5s';

-- Auditoría del alta de clientes (2026-11-15). Dos ajustes a partir de la
-- definición VIVA:
--  1. Al CREAR, la cola de cambios se daba por aplicada entera. Pero el alta
--     viaja con la ficha tal como estaba al TOMARLA (`ultimo_intento_at`): una
--     edición hecha mientras la caja contestaba se marcaba aplicada sin haber
--     viajado. Ahora sólo se salda lo anterior a la toma; lo posterior lo sube
--     el empuje de siempre.
--  2. Si la ficha ya tenía número cuando llegó el resultado (no se escribió
--     nada), la cola no se toca.
CREATE OR REPLACE FUNCTION public.clientes_alta_erp_resultado(p_customer_id bigint, p_resultado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_rol  text := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');
  v_erp  text := nullif(btrim(coalesce(p_resultado ->> 'erp_id', '')), '');
  v_como text := p_resultado ->> 'como';
  v_otra bigint;
  v_n    integer := 0;
  v_toma timestamptz;
BEGIN
  IF v_rol <> 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

  IF coalesce((p_resultado ->> 'ok')::boolean, false) AND v_erp IS NOT NULL THEN
    -- Ese número ya es de otra ficha del portal: no se pisa, lo decide una persona.
    SELECT id INTO v_otra FROM public.customers WHERE erp_id = v_erp AND id <> p_customer_id LIMIT 1;
    IF v_otra IS NOT NULL THEN
      UPDATE public.clientes_alta_erp
         SET estado = 'revisar', tomado_hasta = NULL,
             ultimo_error = format('En la caja ya es la ficha %s del portal (cliente %s).', v_erp, v_otra)
       WHERE customer_id = p_customer_id;
      RETURN json_build_object('ok', false, 'motivo', 'numero_de_otra_ficha', 'otra', v_otra);
    END IF;

    SELECT ultimo_intento_at INTO v_toma FROM public.clientes_alta_erp WHERE customer_id = p_customer_id;

    UPDATE public.customers SET erp_id = v_erp, updated_at = now()
     WHERE id = p_customer_id AND erp_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    -- Creada con los datos del momento de la toma: lo que estaba en la cola
    -- HASTA ESE MOMENTO ya viajó en el alta. Lo posterior, y todo lo de una
    -- ficha vinculada, lo sube el empuje de siempre.
    IF v_como = 'creada' AND v_n = 1 AND v_toma IS NOT NULL THEN
      UPDATE public.customers_changelog SET erp_synced_at = now()
       WHERE customer_id = p_customer_id AND erp_synced_at IS NULL AND descartado_at IS NULL
         AND campo <> 'notes' AND changed_at <= v_toma;
    END IF;

    UPDATE public.clientes_alta_erp
       SET estado = 'hecha', erp_id = v_erp, como = v_como, ultimo_error = NULL,
           tomado_hasta = NULL, resuelto_at = now()
     WHERE customer_id = p_customer_id;
    RETURN json_build_object('ok', true, 'erp_id', v_erp, 'actualizada', v_n);
  END IF;

  UPDATE public.clientes_alta_erp
     SET estado = CASE WHEN coalesce((p_resultado ->> 'revisar')::boolean, false)
                       THEN 'revisar' ELSE 'pendiente' END,
         ultimo_error = left(coalesce(p_resultado ->> 'error', 'sin detalle'), 500),
         tomado_hasta = NULL
   WHERE customer_id = p_customer_id;
  RETURN json_build_object('ok', false);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.clientes_alta_erp_resultado(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clientes_alta_erp_resultado(bigint, jsonb) TO service_role;
