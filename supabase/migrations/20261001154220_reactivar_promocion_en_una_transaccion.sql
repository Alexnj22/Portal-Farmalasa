-- reactivar_promocion: reabrir una terminada en UNA transacción (2026-10-01).
--
-- El portal la reactivaba llamando `extender_renglon` producto por producto, en
-- tandas de 8: con 102 productos, un corte de red a mitad dejaba la promoción
-- medio reactivada. Esta función hace lo mismo que `extender_renglon` sobre
-- todos los renglones que cerraron por FECHA, todo o nada. Los que cerraron por
-- lote agotado se saltan: mover la fecha no agrega producto. Probado en el
-- branch de pruebas: fecha pasada rechazada; 1 extendido + 1 agotado saltado;
-- la promoción vuelve a `activa`.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reactivar_promocion(p_id bigint, p_fin date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor      uuid := public.auth_employee_id();
    v_promo      public.promociones%ROWTYPE;
    v_r          public.promocion_renglon%ROWTYPE;
    v_extendidos int := 0;
    v_agotados   int := 0;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;
    IF p_fin IS NULL THEN RAISE EXCEPTION 'FECHA_REQUERIDA: hasta cuándo'; END IF;
    -- Con una fecha pasada, el ciclo diario la volvería a cerrar a la mañana.
    IF p_fin < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
        RAISE EXCEPTION 'FECHA_PASADA: el fin tiene que ser hoy o después';
    END IF;

    SELECT * INTO v_promo FROM public.promociones WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: la promoción % no existe', p_id; END IF;
    IF v_promo.tipo = 'laboratorio' THEN
        RAISE EXCEPTION 'ES_DE_LABORATORIO: una promoción por laboratorio vive por mes; se duplica para el mes siguiente';
    END IF;

    FOR v_r IN SELECT * FROM public.promocion_renglon
                WHERE promocion_id = p_id ORDER BY id FOR UPDATE
    LOOP
        IF v_r.estado = 'cerrado' AND v_r.cerrado_motivo = 'lote_agotado' THEN
            v_agotados := v_agotados + 1;
            CONTINUE;
        END IF;
        IF p_fin < v_r.inicio THEN
            RAISE EXCEPTION 'FECHA_INVALIDA: el fin no puede ser antes del inicio (%)', v_r.inicio;
        END IF;

        UPDATE public.promocion_renglon
           SET fin            = p_fin,
               estado         = 'abierto',
               cerrado_at     = NULL,
               cerrado_motivo = NULL,
               updated_at     = now()
         WHERE id = v_r.id;

        PERFORM public.promocion_log(
            p_id, v_r.id, NULL, 'extendido', v_r.fin::text, p_fin::text, 'reactivada');
        v_extendidos := v_extendidos + 1;
    END LOOP;

    IF v_extendidos = 0 THEN
        RAISE EXCEPTION 'NADA_QUE_REABRIR: todos sus productos cerraron porque se vendió el lote';
    END IF;

    UPDATE public.promociones
       SET estado = 'activa', updated_at = now()
     WHERE id = p_id AND estado = 'finalizada';

    RETURN json_build_object('id', p_id, 'extendidos', v_extendidos, 'agotados', v_agotados, 'fin', p_fin);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reactivar_promocion(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivar_promocion(bigint, date) TO authenticated, service_role;
