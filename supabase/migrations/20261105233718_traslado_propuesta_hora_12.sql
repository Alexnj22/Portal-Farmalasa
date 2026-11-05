-- La hora del aviso con public.hora_12, igual que el resto del portal (2026-11-05).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.traslado_avisar_propuesta(p_request_id uuid, p_evento text, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    m        jsonb;
    v_prop   jsonb;
    v_pide   integer;
    v_origen integer;
    v_sala   text;
    v_osala  text;
    v_que    text;
    v_titulo text;
    v_cuerpo text;
    v_meta   jsonb;
BEGIN
    SELECT metadata INTO m FROM public.approval_requests WHERE id = p_request_id;
    v_prop   := m->'propuesta_lote';
    IF v_prop IS NULL THEN RETURN; END IF;
    v_pide   := nullif(m->>'branch_id', '')::integer;
    v_origen := nullif(m->>'origen_branch_id', '')::integer;
    v_sala   := coalesce(nullif(m->>'branch_name', ''), 'La sala que pidió');
    v_osala  := coalesce(nullif(m->>'origen_branch_name', ''), 'La otra sala');

    -- «ACETAMINOFEN: lote K221, vence 02/2027 (pediste L1, vence 08/2028)»
    SELECT string_agg(
               coalesce(l->>'producto', 'Un producto') || ': lote '
               || coalesce(l->>'lote', '—')
               || ', vence ' || coalesce(to_char((l->>'vence')::date, 'MM/YYYY'), 'sin fecha')
               || coalesce(' (pediste ' || (l->'pedido'->0->>'lote')
                           || coalesce(', vence ' || to_char((l->'pedido'->0->>'vence')::date, 'MM/YYYY'), '')
                           || ')', ''),
               ' · ')
      INTO v_que
      FROM jsonb_array_elements(coalesce(v_prop->'lineas', '[]'::jsonb)) l;

    v_meta := jsonb_build_object('request_id', p_request_id, 'evento', p_evento);

    IF p_evento IN ('propuesta', 'recordatorio') THEN
        v_titulo := CASE p_evento WHEN 'propuesta'
                        THEN v_osala || ' te propone otro lote'
                        ELSE 'Recordatorio: ' || v_osala || ' espera tu respuesta' END;
        v_cuerpo := 'No tiene el lote que pediste y el que puede mandar vence antes. ' || coalesce(v_que, '')
                 || '. Acéptalo o recházalo en Traslados; si nadie contesta, se acepta solo a las '
                 || public.hora_12((((v_prop->>'propuesta_at')::timestamptz + interval '3 hours') AT TIME ZONE 'America/El_Salvador')::time)
                 || '.';
        PERFORM public.notify_branch_como(p_actor, v_pide, 'TRASLADO_PROPUESTA', v_titulo, v_cuerpo,
                                          '/traslados', v_meta, true);

    ELSIF p_evento = 'aceptada' THEN
        PERFORM public.notify_branch_como(p_actor, v_origen, 'TRASLADO_PROPUESTA',
            v_sala || ' aceptó el lote', coalesce(v_que, '') || '. Ya puedes enviarlo.',
            '/traslados', v_meta, true);

    ELSIF p_evento = 'rechazada' THEN
        PERFORM public.notify_branch_como(p_actor, v_origen, 'TRASLADO_PROPUESTA',
            v_sala || ' no aceptó el lote', coalesce(v_que, '')
            || '. Elige otro lote o rechaza la solicitud.',
            '/traslados', v_meta, true);

    ELSIF p_evento = 'auto' THEN
        PERFORM public.notify_branch_como(NULL, v_origen, 'TRASLADO_PROPUESTA',
            'Lote aceptado solo: ' || v_sala || ' no contestó en 3 horas',
            coalesce(v_que, '') || '. Ya puedes enviarlo.', '/traslados', v_meta, true);
        PERFORM public.notify_branch_como(NULL, v_pide, 'TRASLADO_PROPUESTA',
            'Se aceptó solo el lote que propuso ' || v_osala,
            'Nadie contestó en 3 horas. ' || coalesce(v_que, '') || '.', '/traslados', v_meta, true);
    END IF;
END;
$$;
