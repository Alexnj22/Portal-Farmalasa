-- El aviso llevaba a `/requests` a secas: quien lo abría caía en la lista
-- completa y tenía que buscar cuál era. Ahora lleva a LA solicitud, con su id
-- en la URL, y la vista abre su diálogo de decisión.
--
-- Es además lo que hace usable el flujo en iPhone: iOS no dibuja los botones
-- de acción de una notificación web (ignora el arreglo `actions`), así que allá
-- el camino es tocar el aviso y caer directo en la decisión. Dos toques, con
-- todo el contexto a la vista — que para algo que anula ante Hacienda no es
-- peor que un botón en la pantalla bloqueada.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.notificar_solicitud_creada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    m            jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_quien      text;
    v_etiqueta   text;
    v_titulo     text;
    v_cuerpo     text;
    v_base       text := '/requests';
    v_link       text;
    v_monto      text;
    v_motivo     text;
BEGIN
    -- Sin aprobador no hay a quién avisar (el kiosco crea SHIFT_EXCEPTION así,
    -- para que Talento Humano lo revise después). Y nadie se avisa a sí mismo.
    IF NEW.status <> 'PENDING'
       OR NEW.approver_id IS NULL
       OR NEW.approver_id = NEW.employee_id THEN
        RETURN NEW;
    END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.employee_id;
    v_quien := coalesce(v_quien, 'Un empleado');

    v_etiqueta := CASE NEW.type
        WHEN 'ANNULMENT_REQUEST'      THEN 'Anulación de Factura'
        WHEN 'PAYMENT_CHANGE_REQUEST' THEN 'Cambio de Forma de Pago'
        WHEN 'VENDOR_CHANGE_REQUEST'  THEN 'Cambio de Vendedor'
        WHEN 'CLIENT_CHANGE_REQUEST'  THEN 'Cambio de Cliente'
        WHEN 'PERMIT'                 THEN 'Permiso / Licencia'
        WHEN 'VACATION'               THEN 'Vacaciones'
        WHEN 'VACATION_CHANGE'        THEN 'Cambio de Vacaciones'
        WHEN 'SHIFT_CHANGE'           THEN 'Cambio de Turno'
        WHEN 'SHIFT_EXCEPTION'        THEN 'Excepción de Turno'
        WHEN 'OVERTIME'               THEN 'Horas Extra'
        WHEN 'ADVANCE'                THEN 'Anticipo Salarial'
        WHEN 'CERTIFICATE'            THEN 'Constancia Laboral'
        WHEN 'DISABILITY'             THEN 'Incapacidad'
        ELSE NEW.type
    END;

    -- El monto, cuando lo hay, con formato de dinero y no como número crudo.
    v_monto := CASE
        WHEN m ? 'total' AND (m->>'total') ~ '^-?[0-9.]+$'
        THEN '$' || to_char((m->>'total')::numeric, 'FM999,999,990.00')
        ELSE NULL
    END;

    -- El motivo: primero el catálogo (`reason`), después lo escrito a mano.
    v_motivo := nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '');

    IF NEW.type = 'ANNULMENT_REQUEST' THEN
        v_titulo := '⚠️ Anulación de Factura';
        v_cuerpo := v_quien || ' solicita anular ' || coalesce(m->>'correlativo', 'una factura')
                 || coalesce(' (' || v_monto || ')', '')
                 || coalesce(' · ' || (m->>'branch_name'), '');

    ELSIF NEW.type = 'PAYMENT_CHANGE_REQUEST' THEN
        v_titulo := '💳 Cambio de Forma de Pago';
        v_cuerpo := v_quien || ' solicita cambiar el pago de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(m->>'current_pago', '—') || ' → ' || coalesce(m->>'new_pago', '—')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'VENDOR_CHANGE_REQUEST' THEN
        v_titulo := '👤 Cambio de Vendedor';
        v_cuerpo := v_quien || ' solicita reasignar ' || coalesce(m->>'correlativo', 'una factura')
                 || ' a ' || coalesce(m->>'new_vendor_name', 'otro vendedor')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'CLIENT_CHANGE_REQUEST' THEN
        v_titulo := '🧾 Cambio de Cliente';
        v_cuerpo := v_quien || ' solicita cambiar el cliente de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(nullif(m->>'current_cliente', ''), 'Sin nombre')
                 || ' → ' || coalesce(m->>'new_client_name', '—');

    ELSIF NEW.type = 'SHIFT_CHANGE' AND NEW.current_level = 1 THEN
        -- Nivel 1 de un cambio de turno lo aprueba el COMPAÑERO, y lo ve en su
        -- propia pantalla de solicitudes, no en la de aprobaciones.
        v_titulo := 'Cambio de turno propuesto';
        v_base   := '/my-requests';
        v_cuerpo := v_quien || ' te propone un cambio de turno'
                 || coalesce(' para el ' || (m->>'date'), '') || '. Requiere tu aprobación.';

    ELSE
        v_titulo := 'Nueva solicitud pendiente';
        v_cuerpo := 'Solicitud de ' || v_etiqueta || ' de ' || v_quien || ' espera tu decisión.';
    END IF;

    -- El motivo va al final para todos: es lo que decide si vale la pena abrir.
    IF v_motivo IS NOT NULL THEN
        v_cuerpo := v_cuerpo || ' — ' || left(v_motivo, 140);
    END IF;

    -- El id va en la URL: es lo que convierte «andá a buscarla» en «acá está».
    v_link := v_base || '?solicitud=' || NEW.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    VALUES (
        NEW.approver_id,
        'REQUEST_PENDING',
        v_titulo,
        v_cuerpo,
        v_link,
        jsonb_build_object(
            'request_id',   NEW.id,
            'request_type', NEW.type,
            'correlativo',  m->>'correlativo'
        ),
        nullif(m->>'branch_id', '')::integer,
        NEW.employee_id
    );

    -- El push viaja fuera de la transacción por naturaleza (pg_net encola), así
    -- que si el INSERT se revierte el aviso del navegador podría igual salir.
    -- Es el lado seguro del error: un aviso de más se ignora, uno de menos deja
    -- una solicitud sin dueño.
    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object(
            'title',        v_titulo,
            'message',      v_cuerpo,
            'url',          v_link,
            'target_type',  'EMPLOYEE',
            'target_value', to_jsonb(ARRAY[NEW.approver_id])
        )
    );

    RETURN NEW;
END;
$$;

