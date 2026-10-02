-- La anticipación de 10 días por pieza tampoco se exige en octubre de 2026:
-- la oferta es del 30 de septiembre y lo programado para los primeros días del
-- mes no pudo estar listo diez días antes (decisión del usuario, 2026-10-01).
-- Mismo corte que el calendario: `marketing_ajustes.control_desde`.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.marketing_cumplimiento(p_mes_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_m   public.marketing_meses;
    v_aj  public.marketing_ajustes;
    v_fin date;
    v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_limite_cal timestamptz;
    r json;
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_view') THEN
        RAISE EXCEPTION 'FORBIDDEN: el control exige ver Marketing';
    END IF;
    SELECT * INTO v_m FROM public.marketing_meses WHERE id = p_mes_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO v_aj FROM public.marketing_ajustes WHERE id;
    v_fin := (v_m.mes + interval '1 month - 1 day')::date;
    -- Límite del calendario: el día límite del mes ANTERIOR, al final del día.
    v_limite_cal := (((v_m.mes - interval '1 month')::date + (v_aj.dia_limite_envio - 1)) + time '23:59:59')
                    AT TIME ZONE 'America/El_Salvador';

    WITH p AS (
        SELECT pz.*,
               pz.estado IN ('aprobado','programado','publicado') AS ok,
               (SELECT min(h.created_at) FROM public.marketing_historial h
                 WHERE h.pieza_id = pz.id AND h.evento = 'estado' AND h.a = 'finalizado') AS lista_at,
               (SELECT count(*) FROM public.marketing_comentarios c
                 WHERE c.pieza_id = pz.id AND c.tipo = 'cambio') AS cambios
          FROM public.marketing_piezas pz
         WHERE pz.mes_id = p_mes_id
    ), puntual AS (
        SELECT p.id,
               CASE WHEN v_m.mes < v_aj.control_desde THEN NULL   -- mes exento (octubre 2026)
                    WHEN p.lista_at IS NOT NULL
                         THEN (p.lista_at AT TIME ZONE 'America/El_Salvador')::date <= p.fecha - v_aj.dias_anticipacion
                    WHEN p.fecha - v_aj.dias_anticipacion < v_hoy THEN false
                    ELSE NULL END AS a_tiempo
          FROM p
    ), correcciones AS (
        -- De cada cambio pedido a la siguiente vez que la pieza volvió a estar lista.
        SELECT extract(epoch FROM (
                   (SELECT min(h.created_at) FROM public.marketing_historial h
                     WHERE h.pieza_id = c.pieza_id AND h.evento = 'estado' AND h.a = 'finalizado'
                       AND h.created_at > c.created_at) - c.created_at)) / 3600.0 AS horas
          FROM public.marketing_comentarios c JOIN p ON p.id = c.pieza_id
         WHERE c.tipo = 'cambio'
    )
    SELECT json_build_object(
        'mes', v_m.mes,
        'metas', json_build_object('publicaciones', v_aj.meta_publicaciones, 'videos', v_aj.meta_videos,
                                   'visitas', v_aj.meta_visitas, 'dias_anticipacion', v_aj.dias_anticipacion),
        'publicaciones', json_build_object(
            'aprobadas', (SELECT count(*) FROM p WHERE ok AND formato IN ('post','carrusel')),
            'planificadas', (SELECT count(*) FROM p WHERE formato IN ('post','carrusel'))),
        'videos', json_build_object(
            'aprobados', (SELECT count(*) FROM p WHERE ok AND formato IN ('reel','video')),
            'planificados', (SELECT count(*) FROM p WHERE formato IN ('reel','video'))),
        'historias', (SELECT count(*) FROM p WHERE ok AND formato = 'historia'),
        'piezas', json_build_object(
            'total', (SELECT count(*) FROM p),
            'aprobadas', (SELECT count(*) FROM p WHERE ok),
            'publicadas', (SELECT count(*) FROM p WHERE estado = 'publicado')),
        'puntualidad', json_build_object(
            'exento', v_m.mes < v_aj.control_desde,
            'a_tiempo', (SELECT count(*) FROM puntual WHERE a_tiempo),
            'tarde', (SELECT count(*) FROM puntual WHERE a_tiempo = false),
            'por_vencer', (SELECT count(*) FROM puntual WHERE a_tiempo IS NULL)),
        'cambios', json_build_object(
            'rondas', (SELECT coalesce(sum(cambios), 0) FROM p),
            'piezas_con_cambios', (SELECT count(*) FROM p WHERE cambios > 0),
            'maximo', (SELECT coalesce(max(cambios), 0) FROM p),
            'horas_correccion', (SELECT round(avg(horas)::numeric, 1) FROM correcciones WHERE horas IS NOT NULL)),
        'calendario', json_build_object(
            'exento', v_m.mes < v_aj.control_desde,
            'limite', v_limite_cal,
            'enviado', v_m.primer_envio_at,
            'a_tiempo', CASE WHEN v_m.mes < v_aj.control_desde THEN NULL
                             WHEN v_m.primer_envio_at IS NULL THEN (CASE WHEN now() > v_limite_cal THEN false END)
                             ELSE v_m.primer_envio_at <= v_limite_cal END),
        'visitas', (SELECT count(*) FROM public.marketing_visitas WHERE fecha BETWEEN v_m.mes AND v_fin),
        'manual', (SELECT count(*) FROM public.marketing_recursos
                    WHERE tipo = 'manual' AND (created_at AT TIME ZONE 'America/El_Salvador')::date BETWEEN v_m.mes AND v_fin),
        'extraordinarias', (SELECT json_build_object(
                'pedidas', count(*),
                'entregadas', count(*) FILTER (WHERE estado = 'entregada'),
                'dias_entrega', round(avg(extract(epoch FROM (updated_at - created_at)) / 86400.0)
                                      FILTER (WHERE estado = 'entregada')::numeric, 1))
              FROM public.marketing_solicitudes
             WHERE (created_at AT TIME ZONE 'America/El_Salvador')::date BETWEEN v_m.mes AND v_fin)
    ) INTO r;
    RETURN r;
END $$;
