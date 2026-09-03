SET lock_timeout = '5s';

/* ── «Sin detalle» no es un motivo ─────────────────────────────────────────
 *
 * El cuerpo del aviso pega la nota de quien pidió al final, después de un
 * guión. Cuando la solicitud no trae motivo, `creditos-erp` escribe el literal
 * `"Sin detalle"` como `note` —es su valor de relleno—, y el aviso salía así:
 *
 *   «… Ya entró; falta que lo revises. — Sin detalle»
 *
 * Un relleno pegado con un guión se lee como si fuera lo que la persona
 * escribió. No es un error de la nota sino del aviso: el guión promete una
 * explicación y ahí no hay ninguna. Se trata como ausencia, que es lo que es.
 *
 * (`creditos-erp` además pasó a guardar el MOTIVO real en `note` desde
 * v2.966.1 — antes guardaba el número del documento, y el motivo ni siquiera
 * llegaba al servidor. Esta guarda queda igual: sigue habiendo cobros sin
 * motivo, y el relleno sigue siendo el mismo.)
 */
CREATE OR REPLACE FUNCTION public.motivo_de_solicitud(p_metadata jsonb, p_note text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT nullif(
           nullif(btrim(coalesce(p_metadata->>'reason', p_note, '')), ''),
           'Sin detalle');
$function$;

REVOKE EXECUTE ON FUNCTION public.motivo_de_solicitud(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.motivo_de_solicitud(jsonb, text) TO authenticated, service_role;

-- Y el trigger la usa, en vez de repetir la expresión.
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
    v_base       text;
    v_link       text;
    v_monto      text;
    v_motivo     text;
    v_lineas     integer;
    v_unidades   numeric;
    v_donde      text;
    v_que        text;
    v_dest       uuid[];
    v_plata      text;
    v_creditos   integer;
BEGIN
    IF NEW.status <> 'PENDING' OR NEW.approver_id IS NULL OR NEW.approver_id = NEW.employee_id THEN
        RETURN NEW;
    END IF;

    v_base := CASE WHEN public.es_solicitud_operativa(NEW.type)
                   THEN '/requests' ELSE '/requests-personales' END;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.employee_id;
    v_quien := coalesce(v_quien, 'Un empleado');

    v_etiqueta := CASE NEW.type
        WHEN 'ANNULMENT_REQUEST'          THEN 'Anulación de factura'
        WHEN 'PAYMENT_CHANGE_REQUEST'     THEN 'Cambio de forma de pago'
        WHEN 'VENDOR_CHANGE_REQUEST'      THEN 'Cambio de vendedor'
        WHEN 'CLIENT_CHANGE_REQUEST'      THEN 'Cambio de cliente'
        WHEN 'INVENTORY_LOAD_REQUEST'     THEN 'Carga de inventario'
        WHEN 'INVENTORY_DISCARD_REQUEST'  THEN 'Descarte de inventario'
        WHEN 'INVENTORY_TRANSFER_REQUEST' THEN 'Traslado entre salas'
        WHEN 'CAJA_MOVIMIENTO_CHANGE'     THEN 'Corrección de caja'
        WHEN 'ABONO_CREDITO_CHANGE'       THEN 'Corrección de un abono'
        WHEN 'ABONO_APROBACION'           THEN 'Abono por aprobar'
        WHEN 'PERMIT'                     THEN 'Permiso / licencia'
        WHEN 'VACATION'                   THEN 'Vacaciones'
        WHEN 'VACATION_CHANGE'            THEN 'Cambio de vacaciones'
        WHEN 'SHIFT_CHANGE'               THEN 'Cambio de turno'
        WHEN 'SHIFT_EXCEPTION'            THEN 'Excepción de turno'
        WHEN 'OVERTIME'                   THEN 'Horas extra'
        WHEN 'ADVANCE'                    THEN 'Anticipo salarial'
        WHEN 'CERTIFICATE'                THEN 'Constancia Laboral'
        WHEN 'DISABILITY'                 THEN 'Incapacidad'
        ELSE NEW.type
    END;

    v_monto := CASE
        WHEN m ? 'total' AND (m->>'total') ~ '^-?[0-9.]+$'
        THEN '$' || to_char((m->>'total')::numeric, 'FM999,999,990.00')
        ELSE NULL
    END;

    v_motivo := public.motivo_de_solicitud(m, NEW.note);

    IF NEW.type = 'ANNULMENT_REQUEST' THEN
        v_titulo := '⚠️ Anulación de factura';
        v_cuerpo := v_quien || ' solicita anular ' || coalesce(m->>'correlativo', 'una factura')
                 || coalesce(' (' || v_monto || ')', '')
                 || coalesce(' · ' || (m->>'branch_name'), '');

    ELSIF NEW.type = 'PAYMENT_CHANGE_REQUEST' THEN
        v_titulo := '💳 Cambio de forma de pago';
        v_cuerpo := v_quien || ' solicita cambiar el pago de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(m->>'current_pago', '—') || ' → ' || coalesce(m->>'new_pago', '—')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'VENDOR_CHANGE_REQUEST' THEN
        v_titulo := '👤 Cambio de vendedor';
        v_cuerpo := v_quien || ' solicita reasignar ' || coalesce(m->>'correlativo', 'una factura')
                 || ' a ' || coalesce(m->>'new_vendor_name', 'otro vendedor')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'CLIENT_CHANGE_REQUEST' THEN
        v_titulo := '🧾 Cambio de cliente';
        v_cuerpo := v_quien || ' solicita cambiar el cliente de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(nullif(m->>'current_cliente', ''), 'Sin nombre')
                 || ' → ' || coalesce(m->>'new_client_name', '—');

    /* ── Las tres del dinero ─────────────────────────────────────────────── */
    ELSIF NEW.type = 'CAJA_MOVIMIENTO_CHANGE' THEN
        v_plata := coalesce('$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00'), 'un movimiento');
        v_titulo := '💵 Corrección de caja';
        v_cuerpo := v_quien || ' pide '
                 || CASE WHEN m->>'que' = 'ANULAR'
                         THEN 'anular ' || v_plata || ' de la caja'
                         ELSE 'dejar ' || v_plata || ' en $'
                              || coalesce(to_char(nullif(m->>'monto_nuevo','')::numeric, 'FM999,999,990.00'), '—') END
                 || coalesce(' · ' || nullif(m->>'concepto',''), '') || '.';

    ELSIF NEW.type = 'ABONO_CREDITO_CHANGE' THEN
        v_plata := coalesce('$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00'), 'un abono');
        v_titulo := '💵 Corrección de un abono';
        v_cuerpo := v_quien || ' pide '
                 || CASE m->>'que'
                      WHEN 'ANULAR' THEN 'anular el abono de ' || v_plata
                      WHEN 'MONTO'  THEN 'cambiar el abono de ' || v_plata || ' a $'
                                       || coalesce(to_char(nullif(m->>'monto_nuevo','')::numeric, 'FM999,999,990.00'), '—')
                      ELSE 'cambiar a ' || coalesce(nullif(m->>'forma_nueva',''), 'otra forma')
                           || ' el abono de ' || v_plata
                    END
                 || coalesce(' de ' || nullif(m->>'cliente',''), '') || '.';

    ELSIF NEW.type = 'ABONO_APROBACION' THEN
        v_plata := coalesce('$' || to_char(nullif(m->>'monto','')::numeric, 'FM999,999,990.00'), 'un abono');
        v_creditos := coalesce(jsonb_array_length(m->'creditos'), 0);
        v_titulo := '💵 Abono por confirmar';
        v_cuerpo := v_quien || ' cobró ' || v_plata
                 || coalesce(' de ' || nullif(m->>'cliente',''), '')
                 || coalesce(' con ' || lower(nullif(m->>'forma','')), '')
                 || CASE WHEN v_creditos > 1
                         THEN ' en ' || v_creditos || ' créditos' ELSE '' END
                 || '. Ya entró; falta que lo revises.';

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
        v_que := CASE WHEN v_lineas = 1
                      THEN nullif(btrim(coalesce(m->'items'->0->>'descripcion', '')), '')
                      ELSE NULL END;

        IF NEW.type = 'INVENTORY_LOAD_REQUEST' THEN
            v_titulo := '📦 Carga de inventario';
            v_cuerpo := v_quien || ' solicita cargar ';
        ELSE
            v_titulo := '🗑️ Descarte de inventario';
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

    SELECT coalesce(
             (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(m->'destinatarios') d),
             (SELECT array_agg(DISTINCT s.x) FROM (SELECT NEW.approver_id AS x UNION SELECT e.id FROM public.employees e WHERE e.status = 'ACTIVO' AND public.puede_aprobar_modulo(e.id, public.modulo_de_notificacion(NEW.type))) s WHERE s.x IS NOT NULL AND s.x <> NEW.employee_id), ARRAY[NEW.approver_id])
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
