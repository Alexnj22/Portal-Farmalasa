SET lock_timeout = '5s';

-- «1 producto» no dice cuál (2026-08-10).
--
-- El aviso de un descarte decía «Yessica solicita descartar 1 producto (1
-- unidad) por CONSUMO INTERNO en Salud 5», y con eso hay que abrir la solicitud
-- para saber qué se está por sacar de la sala. El traslado —tres ramas más
-- arriba en esta misma función— ya resuelve el caso: con una sola línea mete el
-- nombre, porque es el caso normal y evita el viaje.
--
-- Se aplica el mismo criterio a carga y descarte, que es de donde salió la
-- idea. Con varias líneas se sigue diciendo cuántas: tres nombres cortados a la
-- mitad en una notificación no ayudan a nadie.
--
-- Sólo cambia el bloque de INVENTORY_LOAD/DISCARD. El resto de la función se
-- reescribe idéntico porque `CREATE OR REPLACE FUNCTION` no admite parches.
--
-- Verificado contra prod con una solicitud de prueba dentro de una transacción
-- revertida: «Yessica Xiomara Hernandez solicita descartar 2 unidades de
-- ALGODON MIGASA 100 GRS. por VENCIMIENTO en Salud 5 — prueba de texto».

CREATE OR REPLACE FUNCTION public.notificar_solicitud_creada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    v_lineas     integer;
    v_unidades   numeric;
    v_donde      text;
    v_que        text;
    v_dest       uuid[];
BEGIN
    IF NEW.status <> 'PENDING' OR NEW.approver_id IS NULL OR NEW.approver_id = NEW.employee_id THEN
        RETURN NEW;
    END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.employee_id;
    v_quien := coalesce(v_quien, 'Un empleado');

    v_etiqueta := CASE NEW.type
        WHEN 'ANNULMENT_REQUEST'          THEN 'Anulación de Factura'
        WHEN 'PAYMENT_CHANGE_REQUEST'     THEN 'Cambio de Forma de Pago'
        WHEN 'VENDOR_CHANGE_REQUEST'      THEN 'Cambio de Vendedor'
        WHEN 'CLIENT_CHANGE_REQUEST'      THEN 'Cambio de Cliente'
        WHEN 'INVENTORY_LOAD_REQUEST'     THEN 'Carga de Inventario'
        WHEN 'INVENTORY_DISCARD_REQUEST'  THEN 'Descarte de Inventario'
        WHEN 'INVENTORY_TRANSFER_REQUEST' THEN 'Traslado entre Salas'
        WHEN 'PERMIT'                     THEN 'Permiso / Licencia'
        WHEN 'VACATION'                   THEN 'Vacaciones'
        WHEN 'VACATION_CHANGE'            THEN 'Cambio de Vacaciones'
        WHEN 'SHIFT_CHANGE'               THEN 'Cambio de Turno'
        WHEN 'SHIFT_EXCEPTION'            THEN 'Excepción de Turno'
        WHEN 'OVERTIME'                   THEN 'Horas Extra'
        WHEN 'ADVANCE'                    THEN 'Anticipo Salarial'
        WHEN 'CERTIFICATE'                THEN 'Constancia Laboral'
        WHEN 'DISABILITY'                 THEN 'Incapacidad'
        ELSE NEW.type
    END;

    v_monto := CASE
        WHEN m ? 'total' AND (m->>'total') ~ '^-?[0-9.]+$'
        THEN '$' || to_char((m->>'total')::numeric, 'FM999,999,990.00')
        ELSE NULL
    END;

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

    -- ── El traslado ─────────────────────────────────────────────────────────
    -- Va PRIMERO que la rama de carga/descarte porque quien lo recibe está del
    -- otro lado del pedido: acá el cuerpo tiene que decir QUIÉN pide y DESDE
    -- QUÉ SALA, que en las otras dos es implícito.
    ELSIF NEW.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
        v_unidades := coalesce((m->>'total_unidades')::numeric, 0);
        v_donde    := coalesce(nullif(m->>'branch_name', ''), 'otra sala');
        v_que := CASE WHEN v_lineas = 1
                      THEN nullif(btrim(coalesce(m->'items'->0->>'descripcion', '')), '')
                      ELSE NULL END;

        v_titulo := '🔄 Te piden un traslado';
        v_cuerpo := v_quien || ' (' || v_donde || ') pide '
                 || trim(to_char(v_unidades, 'FM999,999,990.####'))
                 || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END
                 || coalesce(' de ' || v_que,
                             ' de ' || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END)
                 || ' de tu sala.';

    ELSIF NEW.type IN ('INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST') THEN
        v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
        v_unidades := coalesce((m->>'total_unidades')::numeric, 0);
        v_donde    := coalesce(nullif(m->>'branch_name', ''), 'una sucursal');
        -- Con un solo producto entra el nombre, igual que en el traslado: es el
        -- caso normal y es la diferencia entre saber qué se está por mover y
        -- tener que abrir la solicitud para averiguarlo.
        v_que := CASE WHEN v_lineas = 1
                      THEN nullif(btrim(coalesce(m->'items'->0->>'descripcion', '')), '')
                      ELSE NULL END;

        IF NEW.type = 'INVENTORY_LOAD_REQUEST' THEN
            v_titulo := '📦 Carga de Inventario';
            v_cuerpo := v_quien || ' solicita cargar ';
        ELSE
            v_titulo := '🗑️ Descarte de Inventario';
            v_cuerpo := v_quien || ' solicita descartar ';
        END IF;

        v_cuerpo := v_cuerpo
                 || trim(to_char(v_unidades, 'FM999,999,990.####'))
                 || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END
                 || coalesce(' de ' || v_que,
                             ' en ' || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END)
                 || coalesce(' (' || v_monto || ')', '')
                 || coalesce(' por ' || nullif(m->>'subtipo', ''), '')
                 || ' en ' || v_donde;

    ELSIF NEW.type = 'SHIFT_CHANGE' AND NEW.current_level = 1 THEN
        v_titulo := 'Cambio de turno propuesto';
        v_base   := '/my-requests';
        v_cuerpo := v_quien || ' te propone un cambio de turno'
                 || coalesce(' para el ' || (m->>'date'), '') || '. Requiere tu aprobación.';

    ELSE
        v_titulo := 'Nueva solicitud pendiente';
        v_cuerpo := 'Solicitud de ' || v_etiqueta || ' de ' || v_quien || ' espera tu decisión.';
    END IF;

    IF v_motivo IS NOT NULL THEN
        v_cuerpo := v_cuerpo || ' — ' || left(v_motivo, 140);
    END IF;

    v_link := v_base || '?solicitud=' || NEW.id;

    -- Los destinatarios. Para todo lo anterior es el aprobador y nada más;
    -- `destinatarios` solo lo escribe el traslado.
    SELECT coalesce(
             (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(m->'destinatarios') d),
             ARRAY[NEW.approver_id])
      INTO v_dest;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'correlativo', m->>'correlativo'),
           nullif(m->>'branch_id', '')::integer,
           NEW.employee_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object(
            'title', v_titulo, 'message', v_cuerpo, 'url', v_link,
            'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)
        )
    );

    RETURN NEW;
END;
$function$;
