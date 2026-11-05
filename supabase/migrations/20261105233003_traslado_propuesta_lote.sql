-- Contrapropuesta de lote por vencimiento corto (2026-11-05).
--
-- Pedido del usuario: «si el que se enviará está más corto de vencimiento que
-- el solicitado, se regrese como contra solicitud de aprobación a la sucursal,
-- para no enviar el más corto vence sólo por mandar». Reglas que dio:
--   1. cuenta si el lote que sale vence ANTES que el pedido y dentro de 6 meses;
--   2. acepta cualquiera de la sala que pidió;
--   3. se le recuerda a la hora, y a las 3 horas se acepta solo, avisando a
--      las dos salas.
--
-- La propuesta vive en `approval_requests.metadata.propuesta_lote` (la escribe
-- `aplicar-traslado-inventario` a través de `traslado_proponer_lote`), y la
-- solicitud sigue PENDING: aceptar no despacha nada —la caja la arma la sala
-- que envía—, sólo destraba el despacho de ESE lote.
--
--   { estado: pendiente|aceptada|rechazada, propuesta_at, propuesta_por,
--     recordado_at?, respondido_at?, respondido_por?, auto?,
--     lineas: [{ posicion, producto, lote, vence, sin_asignar, pedido: [{lote, vence}] }] }

SET lock_timeout = '5s';

-- ── Los avisos: un solo sitio que sabe qué decirle a quién ──────────────────
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
                 || to_char(((v_prop->>'propuesta_at')::timestamptz + interval '3 hours') AT TIME ZONE 'America/El_Salvador', 'HH12:MI am')
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

REVOKE EXECUTE ON FUNCTION public.traslado_avisar_propuesta(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.traslado_avisar_propuesta(uuid, text, uuid) TO service_role;

-- ── La propone el despacho (sólo el servidor) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.traslado_proponer_lote(p_request_id uuid, p_lineas jsonb, p_actor uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_prop jsonb;
BEGIN
    IF jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
        RETURN json_build_object('ok', false, 'error', 'La propuesta no trae renglones.');
    END IF;
    v_prop := jsonb_build_object(
        'estado', 'pendiente', 'propuesta_at', now(), 'propuesta_por', p_actor, 'lineas', p_lineas);
    UPDATE public.approval_requests
       SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{propuesta_lote}', v_prop)
     WHERE id = p_request_id AND type = 'INVENTORY_TRANSFER_REQUEST' AND status = 'PENDING';
    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'La solicitud ya no está pendiente.');
    END IF;
    PERFORM public.traslado_avisar_propuesta(p_request_id, 'propuesta', p_actor);
    RETURN json_build_object('ok', true, 'propuesta', v_prop);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.traslado_proponer_lote(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.traslado_proponer_lote(uuid, jsonb, uuid) TO service_role;

-- ── La contesta cualquiera de la sala que pidió ─────────────────────────────
CREATE OR REPLACE FUNCTION public.traslado_responder_propuesta(p_request_id uuid, p_acepta boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_yo     uuid := public.auth_employee_id();
    v_sala   integer := public.auth_employee_branch_id();
    m        jsonb;
    v_status text;
    v_estado text;
BEGIN
    IF v_yo IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
    END IF;
    SELECT metadata, status INTO m, v_status
      FROM public.approval_requests
     WHERE id = p_request_id AND type = 'INVENTORY_TRANSFER_REQUEST'
       FOR UPDATE;
    IF NOT FOUND OR v_status <> 'PENDING' THEN
        RETURN json_build_object('ok', false, 'error', 'La solicitud ya no está pendiente.');
    END IF;
    -- El alcance: sólo la sala que pidió. El id de la sala sale de la sesión,
    -- nunca de un parámetro.
    IF v_sala IS NULL OR v_sala::text IS DISTINCT FROM (m->>'branch_id') THEN
        RETURN json_build_object('ok', false, 'error', 'Sólo la sala que pidió puede contestar la propuesta.');
    END IF;
    IF coalesce(m->'propuesta_lote'->>'estado', '') <> 'pendiente' THEN
        RETURN json_build_object('ok', false, 'error', 'Ya no hay una propuesta por contestar.');
    END IF;

    v_estado := CASE WHEN p_acepta THEN 'aceptada' ELSE 'rechazada' END;
    UPDATE public.approval_requests
       SET metadata = jsonb_set(metadata, '{propuesta_lote}',
               (m->'propuesta_lote') || jsonb_build_object(
                   'estado', v_estado, 'respondido_at', now(), 'respondido_por', v_yo, 'auto', false))
     WHERE id = p_request_id;
    PERFORM public.traslado_avisar_propuesta(p_request_id, v_estado, v_yo);
    RETURN json_build_object('ok', true, 'estado', v_estado);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.traslado_responder_propuesta(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.traslado_responder_propuesta(uuid, boolean) TO authenticated, service_role;

-- ── Lo que la sala de quien mira tiene por contestar ────────────────────────
CREATE OR REPLACE FUNCTION public.traslado_propuestas_de_mi_sala()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT coalesce(json_agg(json_build_object(
               'id', ar.id,
               'origen', ar.metadata->>'origen_branch_name',
               'propuesta', ar.metadata->'propuesta_lote') ORDER BY ar.metadata->'propuesta_lote'->>'propuesta_at'), '[]'::json)
      FROM public.approval_requests ar
     WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
       AND ar.status = 'PENDING'
       AND ar.metadata->'propuesta_lote'->>'estado' = 'pendiente'
       AND ar.metadata->>'branch_id' = (SELECT public.auth_employee_branch_id())::text;
$$;

REVOKE EXECUTE ON FUNCTION public.traslado_propuestas_de_mi_sala() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.traslado_propuestas_de_mi_sala() TO authenticated, service_role;

-- ── El reloj: recordatorio a la hora, aceptada sola a las 3 ─────────────────
CREATE OR REPLACE FUNCTION public.traslados_propuestas_al_dia()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r          record;
    v_desde    timestamptz;
    v_record   integer := 0;
    v_auto     integer := 0;
BEGIN
    FOR r IN
        SELECT id, metadata FROM public.approval_requests
         WHERE type = 'INVENTORY_TRANSFER_REQUEST' AND status = 'PENDING'
           AND metadata->'propuesta_lote'->>'estado' = 'pendiente'
         FOR UPDATE SKIP LOCKED
    LOOP
        v_desde := (r.metadata->'propuesta_lote'->>'propuesta_at')::timestamptz;
        IF now() - v_desde >= interval '3 hours' THEN
            UPDATE public.approval_requests
               SET metadata = jsonb_set(metadata, '{propuesta_lote}',
                       (metadata->'propuesta_lote') || jsonb_build_object(
                           'estado', 'aceptada', 'respondido_at', now(), 'auto', true))
             WHERE id = r.id;
            PERFORM public.traslado_avisar_propuesta(r.id, 'auto', NULL);
            v_auto := v_auto + 1;
        ELSIF now() - v_desde >= interval '1 hour'
              AND (r.metadata->'propuesta_lote'->>'recordado_at') IS NULL THEN
            UPDATE public.approval_requests
               SET metadata = jsonb_set(metadata, '{propuesta_lote,recordado_at}', to_jsonb(now()))
             WHERE id = r.id;
            PERFORM public.traslado_avisar_propuesta(r.id, 'recordatorio', NULL);
            v_record := v_record + 1;
        END IF;
    END LOOP;
    RETURN json_build_object('recordadas', v_record, 'aceptadas_solas', v_auto);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.traslados_propuestas_al_dia() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.traslados_propuestas_al_dia() TO service_role;

-- Cada 5 minutos: el recordatorio y la aceptación caen a lo sumo 5 min tarde.
-- Trabajo contra la propia base (sin HTTP salvo el push del aviso). Con guarda
-- «sólo si no existe» para que el replay de un branch no choque.
SELECT cron.schedule('traslados-propuestas-al-dia', '*/5 * * * *',
                     'SELECT public.traslados_propuestas_al_dia();')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'traslados-propuestas-al-dia');
