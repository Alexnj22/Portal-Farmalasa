SET lock_timeout = '5s';

-- Dos cosas del mismo circuito —lo que no llegó en un envío—, medidas sobre
-- la bolsa E00212 (Salud 5 → Salud 3, 4 productos).
--
-- ══════════════════════════════════════════════════════════════════════════
-- 1 · El aviso de faltante se apagaba solo
-- ══════════════════════════════════════════════════════════════════════════
-- `avisar_faltantes` le escribe a la sala que despachó con tipo
-- REQUEST_PENDING y el `request_id` de la bolsa. Al cerrarse la bolsa,
-- `marcar_notificacion_solicitud_resuelta` marca como leídos TODOS los
-- REQUEST_PENDING con ese `request_id` —para limpiar la campana de quien tenía
-- que decidir—, y en un ENVÍO el faltante se anota un instante ANTES del
-- cierre. Resultado medido: los 5 avisos «Faltaron productos» de la E00212
-- quedaron leídos 0.1 s después de nacer. Salud 5 nunca los vio como nuevos.
-- En una solicitud el orden es el inverso y no pasaba (9 de 9 sin tocar).
--
-- Se distingue por `metadata ? 'faltantes'`, que sólo pone `avisar_faltantes`.
-- Se edita la definición VIVA por reemplazo exacto, y si el ancla no está,
-- falla en vez de escribir una función a medias.
DO $migr$
DECLARE
    d   text := pg_get_functiondef('public.marcar_notificacion_solicitud_resuelta()'::regprocedure);
    a   text := $a$         WHERE type = 'REQUEST_PENDING'
           AND metadata->>'request_id' = NEW.id::text;
        RETURN NEW;$a$;
    b   text := $b$         WHERE type = 'REQUEST_PENDING'
           AND metadata->>'request_id' = NEW.id::text
           -- El aviso de faltante es para la OTRA sala y no lo resuelve cerrar
           -- la bolsa: se apagaba 0.1 s después de nacer (E00212, 1-oct).
           AND NOT (coalesce(metadata, '{}'::jsonb) ? 'faltantes');
        RETURN NEW;$b$;
BEGIN
    IF position(a IN d) = 0 THEN
        RAISE EXCEPTION 'marcar_notificacion_solicitud_resuelta cambió: no está el ancla.';
    END IF;
    EXECUTE replace(d, a, b);
END
$migr$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · La bolsa que apareció
-- ══════════════════════════════════════════════════════════════════════════
-- Una bolsa con todo «no llegó» se cierra REJECTED. Cuando lo que faltaba
-- aparece y se ingresa (`enviar-producto-erp` · `recibir_aparecido`), los
-- renglones pasan a aceptados pero la bolsa seguía diciendo «rechazada · No
-- llegó» — el historial contradecía al inventario.
--
-- Decisión del usuario (2-oct): la bolsa pasa a APPROVED recién cuando entra el
-- ÚLTIMO renglón que estaba en «no llegó» —antes, el aviso diría «N no
-- llegaron, revisa tu sala» sobre productos que están en la otra—, y a la sala
-- que envió le llega un aviso PROPIO que diga que apareció, no el genérico «te
-- recibieron el envío», que días después del faltante no se entiende.
--
-- El aviso genérico lo dispara `notificar_resolucion_envio` en todo cambio de
-- estado; acá se le enseña a callar cuando la bolsa ya estaba resuelta, porque
-- esa segunda resolución la anuncia `resolver_envio_aparecido`.
DO $migr$
DECLARE
    d   text := pg_get_functiondef('public.notificar_resolucion_envio()'::regprocedure);
    a   text := $a$    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;$a$;
    b   text := $b$    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    -- Ya estaba resuelta: es lo que apareció después de un «no llegó», y ese
    -- aviso lo manda `resolver_envio_aparecido` con su propio texto.
    IF OLD.status <> 'PENDING' THEN RETURN NEW; END IF;$b$;
BEGIN
    IF position(a IN d) = 0 THEN
        RAISE EXCEPTION 'notificar_resolucion_envio cambió: no está el ancla.';
    END IF;
    EXECUTE replace(d, a, b);
END
$migr$;

-- Cuántos renglones «aparecieron» = aceptados DESPUÉS de declarados faltantes.
-- Un faltante tardío —declarado sobre un renglón ya aceptado— queda afuera
-- por construcción: ahí la decisión es anterior a la declaración.
CREATE OR REPLACE FUNCTION public.resolver_envio_aparecido(p_request_id uuid, p_actor uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_org    integer;
    v_sala   text;
    v_nombre text;
    v_n      integer;
    v_prods  jsonb;
    v_uno    text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    v_resp   jsonb;
BEGIN
    -- Todavía queda algo en «no llegó»: la bolsa no se toca ni se avisa.
    IF EXISTS (SELECT 1 FROM public.envio_linea
                WHERE request_id = p_request_id AND estado = 'no_llego') THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'QUEDAN');
    END IF;

    SELECT count(*),
           jsonb_agg(jsonb_build_object('nombre', coalesce(el.descripcion, 'Producto #' || el.erp_product_id))
                     ORDER BY el.posicion),
           max(coalesce(el.descripcion, 'el producto #' || el.erp_product_id))
      INTO v_n, v_prods, v_uno
      FROM public.envio_linea el
      JOIN public.bolsa_faltante bf
        ON bf.request_id = el.request_id AND bf.posicion = el.posicion AND bf.familia = 'envio'
     WHERE el.request_id = p_request_id
       AND el.estado = 'aceptada'
       AND bf.estado = 'aparecio'
       AND el.decidido_at > bf.declarado_at;
    IF coalesce(v_n, 0) = 0 THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'NADA_APARECIO');
    END IF;

    -- Una sola vez por bolsa, aunque dos lleguen a la vez: el UPDATE con la
    -- marca es el candado. Si la bolsa era REJECTED pasa a APPROVED y se le
    -- quita el «No llegó»; si ya era APPROVED (aceptaron una parte y lo demás
    -- apareció después) sólo se marca.
    UPDATE public.approval_requests
       SET status      = CASE WHEN status = 'REJECTED' THEN 'APPROVED' ELSE status END,
           approver_id = CASE WHEN status = 'REJECTED' THEN p_actor ELSE approver_id END,
           metadata    = (coalesce(metadata, '{}'::jsonb)
                          - CASE WHEN status = 'REJECTED' THEN 'rejection_reason' ELSE '' END)
                         || jsonb_build_object('aparecio_avisado_at', now()),
           updated_at  = now()
     WHERE id = p_request_id
       AND type = 'INVENTORY_TRANSFER_PUSH'
       AND status IN ('REJECTED', 'APPROVED')
       AND NOT (coalesce(metadata, '{}'::jsonb) ? 'aparecio_avisado_at')
    RETURNING * INTO r;
    IF r.id IS NULL THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'YA_AVISADO');
    END IF;

    -- El aviso de faltante ya está resuelto: se apaga en la campana de quien
    -- lo recibió, con el desenlace.
    UPDATE public.notifications
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('resuelta', 'APARECIO'),
           read_at  = coalesce(read_at, now())
     WHERE type = 'REQUEST_PENDING'
       AND metadata->>'request_id' = p_request_id::text
       AND metadata ? 'faltantes';

    m      := coalesce(r.metadata, '{}'::jsonb);
    v_org  := nullif(m->>'origen_branch_id', '')::integer;
    v_sala := coalesce(nullif(m->>'branch_name', ''), 'La otra sala');
    IF v_org IS NULL THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'SIN_ORIGEN');
    END IF;

    -- Los mismos destinatarios que el aviso de resolución de siempre: quien
    -- armó el envío, la jefatura de su sala y quien esté en turno.
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = r.employee_id
            OR (e.branch_id = v_org
                AND (public.rango_de_empleado(e.id) BETWEEN 1 AND 2
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_org) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'SIN_DESTINATARIOS');
    END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = p_actor;

    v_titulo := 'Apareció lo que faltaba de tu envío'
             || coalesce(' ' || nullif(m->>'codigo_bolsa', ''), '');
    v_cuerpo := v_sala || ' encontró y recibió '
             || CASE WHEN v_n = 1 THEN v_uno || ', que había marcado como no llegado.'
                     ELSE 'los ' || v_n || ' productos que había marcado como no llegados.' END
             || ' Ya no hay que buscarlos en tu sala.';
    v_link   := '/traslados?tab=envios&envio=' || r.id;

    v_resp := jsonb_strip_nulls(jsonb_build_object(
        'tipo',       'envio',
        'estado',     'APARECIO',
        'quien',      v_nombre,
        'quien_id',   p_actor,
        'quien_foto', public.foto_de_empleado(p_actor),
        'sala',       nullif(m->>'branch_name', ''),
        'aceptados',  v_n,
        'productos',  v_prods));

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'resuelta', r.status,
                              'respuesta', v_resp),
           v_org, p_actor
      FROM unnest(v_dest) d;

    -- El cuerpo va entero al teléfono: `texto_de_push` resumiría una respuesta
    -- de envío como «Se quedó con N», que acá no explica nada.
    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN json_build_object('ok', true, 'avisado', true, 'productos', v_n,
                             'destinatarios', array_length(v_dest, 1));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolver_envio_aparecido(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolver_envio_aparecido(uuid, uuid) TO service_role;
