SET lock_timeout = '5s';
-- Dos personas en el mismo producto (2026-10-31): la toma vence a los 15
-- minutos y otra persona puede tomarlo; quien lo tenía antes guardaba igual y
-- pisaba lo de la otra. Ahora guardar respeta la toma vigente de otra persona.
DO $$
DECLARE d text := pg_get_functiondef('public.guardar_carga_producto(integer, text, jsonb, text)'::regprocedure);
  marca text := $x$    IF p_foto_url IS NULL AND p_filas IS NULL THEN RAISE EXCEPTION 'NADA_QUE_GUARDAR'; END IF;
$x$;
BEGIN
  IF position(marca IN d) = 0 THEN RAISE EXCEPTION 'la función cambió: revisar antes de reescribir'; END IF;
  EXECUTE replace(d, marca, marca || $x$
    -- Si otra persona lo tomó (porque la toma de esta venció), no se pisa.
    PERFORM 1 FROM public.producto_carga_tomas t
      WHERE t.product_id = p_product_id AND t.employee_id <> v_yo AND t.tomado_el >= now() - interval '15 minutes';
    IF FOUND THEN
        RAISE EXCEPTION 'TOMADO_POR_OTRO: %', (SELECT coalesce(e.nombre_corto, e.name) FROM public.producto_carga_tomas t
            JOIN public.employees e ON e.id = t.employee_id WHERE t.product_id = p_product_id);
    END IF;
$x$);
END $$;
