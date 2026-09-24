SET lock_timeout = '5s';

-- El aviso de traslado lleva TODOS los productos (hasta 15), no tres: se
-- aprueba desde la tarjeta y hay que poder verlos todos antes (usuario, 24-sep).

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
    -- La tarjeta de la campana (24-sep): el mismo aviso en datos, no en prosa.
    v_sala       text;
    v_num        text;
    v_doc        text;
    v_antes      text;
    v_despues    text;
    v_productos  jsonb;
    v_mas        integer;
    v_sol        jsonb;
    v_cliente    text;
    v_fecha      text;
    v_pago       text;
    v_origen_b   bigint;
    v_origen_s   integer;
    v_tope       integer := 3;
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
        v_titulo := 'Anulación de factura';
        v_cuerpo := v_quien || ' solicita anular ' || coalesce(m->>'correlativo', 'una factura')
                 || coalesce(' (' || v_monto || ')', '')
                 || coalesce(' · ' || (m->>'branch_name'), '');

    ELSIF NEW.type = 'PAYMENT_CHANGE_REQUEST' THEN
        v_titulo := 'Cambio de forma de pago';
        v_cuerpo := v_quien || ' solicita cambiar el pago de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(m->>'current_pago', '—') || ' → ' || coalesce(m->>'new_pago', '—')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'VENDOR_CHANGE_REQUEST' THEN
        v_titulo := 'Cambio de vendedor';
        v_cuerpo := v_quien || ' solicita reasignar ' || coalesce(m->>'correlativo', 'una factura')
                 || ' a ' || coalesce(m->>'new_vendor_name', 'otro vendedor')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'CLIENT_CHANGE_REQUEST' THEN
        v_titulo := 'Cambio de cliente';
        v_cuerpo := v_quien || ' solicita cambiar el cliente de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(nullif(m->>'current_cliente', ''), 'Sin nombre')
                 || ' → ' || coalesce(m->>'new_client_name', '—');

    /* ── Las tres del dinero ─────────────────────────────────────────────── */
    ELSIF NEW.type = 'CAJA_MOVIMIENTO_CHANGE' THEN
        v_plata := coalesce('$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00'), 'un movimiento');
        v_titulo := 'Corrección de caja';
        v_cuerpo := v_quien || ' pide '
                 || CASE WHEN m->>'que' = 'ANULAR'
                         THEN 'anular ' || v_plata || ' de la caja'
                         ELSE 'dejar ' || v_plata || ' en $'
                              || coalesce(to_char(nullif(m->>'monto_nuevo','')::numeric, 'FM999,999,990.00'), '—') END
                 || coalesce(' · ' || nullif(m->>'concepto',''), '') || '.';

    ELSIF NEW.type = 'ABONO_CREDITO_CHANGE' THEN
        v_plata := coalesce('$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00'), 'un abono');
        v_titulo := 'Corrección de un abono';
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
        v_titulo := 'Abono por confirmar';
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
            v_titulo := 'Carga de inventario';
            v_cuerpo := v_quien || ' solicita cargar ';
        ELSE
            v_titulo := 'Descarte de inventario';
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
        v_titulo := v_etiqueta || ' por aprobar';
        v_cuerpo := 'Solicitud de ' || v_etiqueta || ' de ' || v_quien || ' espera tu decisión.';
    END IF;

    IF v_motivo IS NOT NULL THEN
        v_cuerpo := v_cuerpo || ' — ' || left(v_motivo, 140);
    END IF;

    v_link := v_base || '?solicitud=' || NEW.id;

    /* ── Lo que dibuja la tarjeta de la campana (usuario, 24-sep) ───────────
     * Los mismos datos del cuerpo, pero como datos: quién (con su foto), la
     * sala, el documento con su número legible («Factura N.º 74092» y no
     * «0000074092_COF»), el monto, qué cambia (antes → después), los productos y
     * el motivo. El título lleva la sala delante y ya no lleva emoji: el color
     * lo pone la tarjeta. */
    v_sala := coalesce(nullif(m->>'branch_name', ''),
                       (SELECT b.name FROM public.branches b WHERE b.id = nullif(m->>'branch_id', '')::integer));
    IF NEW.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_titulo := coalesce(v_sala, 'Otra sala') || ' te pide un traslado';
    ELSIF v_sala IS NOT NULL AND NOT (NEW.type = 'SHIFT_CHANGE' AND NEW.current_level = 1) THEN
        v_titulo := v_sala || ' · ' || v_titulo;
    END IF;

    v_num := nullif(regexp_replace(regexp_replace(coalesce(m->>'correlativo', ''), '_.*$', ''), '^0+(?=[0-9])', ''), '');
    -- El TIPO de documento, que es lo que se mira; el número no (24-sep: «el
    -- n.º de factura no es relevante en esa vista»).
    v_doc := CASE WHEN m->>'tipo_documento' = 'CCF' OR m->>'correlativo' LIKE '%\_CCF' THEN 'Crédito fiscal'
                  WHEN m->>'tipo_documento' = 'COF' OR m->>'correlativo' IS NOT NULL THEN 'Consumidor final' END;

    -- La factura: de qué fecha y a nombre de quién (24-sep).
    IF nullif(m->>'invoice_id', '') ~ '^[0-9]+$' THEN
        SELECT si.cliente, si.fecha::text, si.tipo_pago INTO v_cliente, v_fecha, v_pago
          FROM public.sales_invoices si WHERE si.id = (m->>'invoice_id')::bigint;
    END IF;
    v_fecha := coalesce(nullif(m->>'fecha', ''), v_fecha);

    v_antes := CASE NEW.type
        WHEN 'PAYMENT_CHANGE_REQUEST' THEN m->>'current_pago'
        WHEN 'CLIENT_CHANGE_REQUEST'  THEN coalesce(nullif(m->>'current_cliente', ''), 'Sin nombre')
        WHEN 'CAJA_MOVIMIENTO_CHANGE' THEN '$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00')
        WHEN 'ABONO_CREDITO_CHANGE'   THEN '$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00')
        END;
    v_despues := CASE NEW.type
        WHEN 'PAYMENT_CHANGE_REQUEST' THEN m->>'new_pago'
        WHEN 'VENDOR_CHANGE_REQUEST'  THEN m->>'new_vendor_name'
        WHEN 'CLIENT_CHANGE_REQUEST'  THEN m->>'new_client_name'
        WHEN 'CAJA_MOVIMIENTO_CHANGE' THEN CASE WHEN m->>'que' = 'ANULAR' THEN 'Anular'
                                                ELSE '$' || to_char(nullif(m->>'monto_nuevo','')::numeric, 'FM999,999,990.00') END
        WHEN 'ABONO_CREDITO_CHANGE'   THEN CASE m->>'que' WHEN 'ANULAR' THEN 'Anular'
                                                WHEN 'MONTO' THEN '$' || to_char(nullif(m->>'monto_nuevo','')::numeric, 'FM999,999,990.00')
                                                ELSE nullif(m->>'forma_nueva', '') END
        END;

    -- En un traslado, de cada producto: cuántas hay en la sala a la que se lo
    -- piden y cuánto vendió ella (24-sep: «no dice cuántas tengo en
    -- inventario; agrega el total de ventas de 6 meses y del último mes»).
    IF NEW.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_origen_b := CASE WHEN m->>'origen_branch_id' ~ '^[0-9]+$' THEN (m->>'origen_branch_id')::bigint END;
        v_origen_s := CASE WHEN m->>'origen_erp_sucursal_id' ~ '^[0-9]+$' THEN (m->>'origen_erp_sucursal_id')::integer END;
        -- Todos los productos, no tres: se aprueba desde la tarjeta, así que
        -- tiene que poder verse la lista entera («Ver los N productos»). 15 de
        -- tope: ~34 ms por producto, y en 60 días el más largo tuvo 8.
        v_tope := 15;
    END IF;

    BEGIN
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'nombre', i->>'descripcion',
                   'cantidad', CASE WHEN i->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (i->>'cantidad')::numeric END,
                   'existencia', CASE WHEN v_origen_s IS NOT NULL AND i->>'erp_product_id' ~ '^[0-9]+$'
                                      THEN (public.get_minmax_contexto_producto((i->>'erp_product_id')::integer, v_origen_s)->>'existencia')::numeric END,
                   'ventas_meses', CASE WHEN v_origen_b IS NOT NULL AND i->>'erp_product_id' ~ '^[0-9]+$'
                                        THEN public.ventas_por_mes_de_producto((i->>'erp_product_id')::integer, v_origen_b) END)))
          INTO v_productos
          FROM (SELECT i FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) i LIMIT v_tope) x;
    EXCEPTION WHEN OTHERS THEN
        -- Sin las cifras, la solicitud y su aviso salen igual.
        SELECT jsonb_agg(jsonb_build_object('nombre', i->>'descripcion'))
          INTO v_productos
          FROM (SELECT i FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) i LIMIT v_tope) x;
    END;
    v_mas := greatest(coalesce(jsonb_array_length(m->'items'), 0) - v_tope, 0);

    v_sol := jsonb_strip_nulls(jsonb_build_object(
        'tipo',      NEW.type,
        'etiqueta',  v_etiqueta,
        'quien',     v_quien,
        'quien_id',  NEW.employee_id,
        'quien_foto', public.foto_de_empleado(NEW.employee_id),
        'sala',      v_sala,
        'origen',    nullif(m->>'origen_branch_name', ''),
        'doc',       v_doc,
        'numero',    v_num,
        -- Sólo si es un número: un valor raro no puede tumbar la solicitud.
        'monto',     CASE WHEN m->>'total' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (m->>'total')::numeric
                          WHEN m->>'monto' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (m->>'monto')::numeric END,
        'antes',     v_antes,
        'despues',   v_despues,
        'cliente',   coalesce(nullif(m->>'cliente', ''), nullif(btrim(v_cliente), '')),
        'fecha',     v_fecha,
        -- En el cambio de pago ya lo dicen `antes`/`despues`.
        'pago',      CASE WHEN NEW.type <> 'PAYMENT_CHANGE_REQUEST'
                          THEN coalesce(nullif(m->>'tipo_pago', ''), v_pago) END,
        'productos', v_productos,
        'mas',       nullif(v_mas, 0),
        'unidades',  CASE WHEN m->>'total_unidades' ~ '^[0-9]+(\.[0-9]+)?$' THEN (m->>'total_unidades')::numeric END,
        'subtipo',   nullif(m->>'subtipo', ''),
        'creditos',  nullif(coalesce(jsonb_array_length(m->'creditos'), 0), 0),
        'desde',     coalesce(m->>'startDate', m->>'date'),
        'hasta',     m->>'endDate',
        'motivo',    left(v_motivo, 200)));

    SELECT coalesce(
             (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(m->'destinatarios') d),
             (SELECT array_agg(DISTINCT s.x) FROM (SELECT NEW.approver_id AS x UNION SELECT e.id FROM public.employees e WHERE e.status = 'ACTIVO' AND public.puede_aprobar_modulo(e.id, public.modulo_de_notificacion(NEW.type))) s WHERE s.x IS NOT NULL AND s.x <> NEW.employee_id), ARRAY[NEW.approver_id])
      INTO v_dest;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'correlativo', m->>'correlativo',
                              'solicitud', v_sol),
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
