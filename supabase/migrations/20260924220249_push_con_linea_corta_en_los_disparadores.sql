SET lock_timeout = '5s';

-- El push al teléfono con una línea corta (usuario, 24-sep), segunda parte:
-- los cuatro disparadores de solicitudes, traslados y envíos que mandan su
-- propio push pasan por `texto_de_push`.

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
    -- piden (24-sep: «no dice cuántas tengo en inventario»). Las ventas se
    -- mostraron un rato y se quitaron el mismo día: «solo deja lo que
    -- solicitan, el producto, cantidad y cuánto en inventario».
    IF NEW.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_origen_s := CASE WHEN m->>'origen_erp_sucursal_id' ~ '^[0-9]+$' THEN (m->>'origen_erp_sucursal_id')::integer END;
        -- Todos los productos, no tres: se aprueba desde la tarjeta, así que
        -- tiene que poder verse la lista entera («Ver los N productos»). 15 de
        -- tope: ~22 ms por producto, y en 60 días el más largo tuvo 8.
        v_tope := 15;
    END IF;

    BEGIN
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'nombre', i->>'descripcion',
                   'cantidad', CASE WHEN i->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (i->>'cantidad')::numeric END,
                   'existencia', CASE WHEN v_origen_s IS NOT NULL AND i->>'erp_product_id' ~ '^[0-9]+$'
                                      THEN (public.get_minmax_contexto_producto((i->>'erp_product_id')::integer, v_origen_s)->>'existencia')::numeric END)))
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
            'title', v_titulo,
            -- La línea corta del teléfono (24-sep).
            'message', public.texto_de_push('REQUEST_PENDING', v_cuerpo, jsonb_build_object('solicitud', v_sol)),
            'url', v_link,
            'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)
        )
    );

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_resolucion_traslado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m        jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_branch integer := nullif(m->>'branch_id', '')::integer;
    v_quien  text;
    v_que    text;
    v_n      integer;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    v_motivo text;
    v_alt    text;
    v_parcial jsonb;
    v_falto  text;
    -- La tarjeta de la campana (24-sep): la respuesta como datos.
    v_origen text := nullif(m->>'origen_branch_name', '');
    v_nombre text;
    v_estado text;
    v_prods  jsonb;
    v_resp   jsonb;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_REQUEST' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_branch IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_nombre, 'La otra sala');

    -- Qué se pidió. Con un renglón, su nombre; con varios, cuántos son: la
    -- lista entera no entra en un aviso y el nombre del primero haría creer que
    -- es el único.
    v_n := jsonb_array_length(coalesce(m->'items', '[]'::jsonb));
    v_que := CASE
        WHEN v_n = 1 THEN coalesce(nullif(m->'items'->0->>'descripcion', ''), 'lo que pediste')
        WHEN v_n > 1 THEN v_n || ' productos'
        ELSE 'lo que pediste'
    END;

    -- Quien pidió, más la jefatura y el turno de su sala.
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = NEW.employee_id
            OR (e.branch_id = v_branch
                AND (public.rango_de_empleado(e.id) BETWEEN 1 AND 2
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_branch) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF NEW.status = 'APPROVED' THEN
        v_parcial := m->'erp_traslado'->'parcial';

        IF v_parcial IS NULL THEN
            v_estado := 'ENVIA';
            v_titulo := coalesce(v_origen, 'La otra sala') || ' te lo envía';
            v_cuerpo := v_quien || ' confirmó el traslado de ' || v_que
                     || ' desde ' || coalesce(nullif(m->>'origen_branch_name',''), 'la otra sala')
                     || '. Avisa cuando llegue para recibirlo.';
        ELSE
            -- Renglón por renglón, qué salió de lo que se pidió. Los que
            -- quedaron fuera no traen `enviada`: salieron cero.
            SELECT string_agg(
                       coalesce(nullif(x->>'descripcion',''), 'el producto #' || (x->>'erp_product_id'))
                       || ': ' || coalesce(x->>'enviada','0') || ' de ' || coalesce(x->>'pedida','?'),
                       '; ' ORDER BY (x->>'i')::integer)
              INTO v_falto
              FROM (
                  SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados','[]'::jsonb)) AS x
                  UNION ALL
                  SELECT jsonb_array_elements(coalesce(v_parcial->'fuera','[]'::jsonb))
              ) t;

            -- Dónde está lo que faltó. Sólo se ofrece una sala que lo cubra
            -- ENTERO: media sugerencia haría que quien pidió se mueva para nada.
            SELECT string_agg(f.nombre || ' lo tiene ' || d.sala || ' (' || d.unidades || ')', ' · ')
              INTO v_alt
              FROM (
                  SELECT (x->>'erp_product_id')::integer AS prod,
                         coalesce(nullif(x->>'descripcion',''), 'el producto #' || (x->>'erp_product_id')) AS nombre,
                         ((coalesce((x->>'pedida')::numeric, 0) - coalesce((x->>'enviada')::numeric, 0))
                           * coalesce((m->'items'->((x->>'i')::integer)->>'factor')::numeric, 1)) AS unidades
                  FROM (
                      SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados','[]'::jsonb)) AS x
                      UNION ALL
                      SELECT jsonb_array_elements(coalesce(v_parcial->'fuera','[]'::jsonb))
                  ) t
              ) f
              JOIN LATERAL (
                  SELECT coalesce(sm.nombre, 'Sucursal ' || v.erp_sucursal_id) AS sala, v.unidades
                    FROM public.v_inventario_disponible v
                    LEFT JOIN public.erp_sucursal_map sm ON sm.erp_sucursal_id = v.erp_sucursal_id
                   WHERE v.erp_product_id = f.prod
                     AND v.erp_sucursal_id IS DISTINCT FROM nullif(m->>'origen_erp_sucursal_id','')::integer
                     AND v.erp_sucursal_id IS DISTINCT FROM nullif(m->>'erp_sucursal_id','')::integer
                     AND v.unidades >= f.unidades
                   ORDER BY v.unidades DESC
                   LIMIT 1
              ) d ON true;

            v_estado := 'PARTE';
            v_titulo := coalesce(v_origen, 'La otra sala') || ' te envía una parte';
            v_cuerpo := coalesce(nullif(m->>'origen_branch_name',''), 'La otra sala')
                     || ' no tenía todo: ' || coalesce(v_falto, 'salió menos de lo pedido')
                     || coalesce('. ' || nullif(btrim(coalesce(v_parcial->>'motivo','')), ''), '')
                     || coalesce('. Lo que faltó: ' || v_alt, '')
                     || '. Avisa cuando llegue para recibirlo.';
        END IF;
    ELSE
        v_motivo := nullif(btrim(coalesce(m->>'rejection_reason','')), '');
        -- La sugerencia es el motivo por el que este aviso existe: sin ella,
        -- quien pidió vuelve a empezar de cero — abrir la consulta, buscar el
        -- producto, mirar qué sala lo tiene. El dato ya lo teníamos.
        v_alt := nullif(btrim(coalesce(m->>'sugerencia','')), '');
        v_estado := 'NO';
        v_titulo := coalesce(v_origen, 'La otra sala') || ' no te lo puede enviar';
        v_cuerpo := coalesce(nullif(m->>'origen_branch_name',''), 'La otra sala')
                 || ' no puede enviar ' || v_que
                 || coalesce(': ' || lower(v_motivo), '')
                 || coalesce('. ' || left(nullif(btrim(NEW.approver_note),''), 120), '')
                 || coalesce(' — ' || v_alt, '');
    END IF;

    v_link := '/requests?solicitud=' || NEW.id;

    /* ── Lo que dibuja la tarjeta (usuario, 24-sep) ─────────────────────────
     * Quién respondió (con su cara), qué se pidió y cuánto sale de cada
     * producto, por qué no, y dónde más hay. El título lleva la sala que
     * responde y ya no lleva emoji: el color lo pone la tarjeta. Los
     * `enviada` salen del mismo `parcial` que arma el cuerpo: los de `fuera`
     * salieron cero, los que no aparecen salieron enteros. */
    BEGIN
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'nombre',  coalesce(nullif(it->>'descripcion', ''), 'Producto #' || (it->>'erp_product_id')),
                   'pedida',  CASE WHEN it->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (it->>'cantidad')::numeric END,
                   'enviada', CASE
                                  WHEN v_estado = 'NO' THEN NULL
                                  WHEN aj.x IS NOT NULL AND aj.x->>'enviada' ~ '^[0-9]+(\.[0-9]+)?$' THEN (aj.x->>'enviada')::numeric
                                  WHEN aj.x IS NOT NULL THEN 0
                                  WHEN it->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (it->>'cantidad')::numeric
                              END)) ORDER BY t.ord)
          INTO v_prods
          FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS t(it, ord)
          LEFT JOIN LATERAL (
              SELECT x FROM (
                  SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados', '[]'::jsonb)) AS x
                  UNION ALL
                  SELECT jsonb_array_elements(coalesce(v_parcial->'fuera', '[]'::jsonb))
              ) p WHERE (p.x->>'i') = (t.ord - 1)::text LIMIT 1
          ) aj ON true
         WHERE t.ord <= 15;
    EXCEPTION WHEN OTHERS THEN
        v_prods := NULL;
    END;

    v_resp := jsonb_strip_nulls(jsonb_build_object(
        'tipo',        'traslado',
        'estado',      v_estado,
        'quien',       v_nombre,
        'quien_id',    NEW.approver_id,
        'quien_foto',  public.foto_de_empleado(NEW.approver_id),
        'origen',      v_origen,
        'productos',   v_prods,
        'mas',         nullif(greatest(v_n - 15, 0), 0),
        'motivo',      CASE WHEN v_estado = 'NO' THEN v_motivo
                            ELSE nullif(btrim(coalesce(v_parcial->>'motivo', '')), '') END,
        'nota',        CASE WHEN v_estado = 'NO' THEN left(nullif(btrim(NEW.approver_note), ''), 200) END,
        'alternativa', v_alt));

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status,
                              'respuesta', v_resp),
           v_branch, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        -- La línea corta del teléfono (24-sep).
        body := jsonb_build_object('title', v_titulo,
                'message', public.texto_de_push('REQUEST_RESOLVED', v_cuerpo, jsonb_build_object('respuesta', v_resp)),
                'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_resolucion_envio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m        jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_org    integer := nullif(m->>'origen_branch_id', '')::integer;
    v_quien  text;
    v_ok     integer;
    v_no     integer;
    v_falta  integer;
    v_lista  text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    -- La tarjeta de la campana (24-sep).
    v_nombre text;
    v_sala   text := nullif(m->>'branch_name', '');
    v_devs   jsonb;
    v_resp   jsonb;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_org IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_nombre, coalesce(nullif(m->>'branch_name',''), 'La otra sala'));

    SELECT count(*) FILTER (WHERE estado = 'aceptada'),
           count(*) FILTER (WHERE estado IN ('devuelta','devuelta_recibida')),
           count(*) FILTER (WHERE estado = 'no_llego')
      INTO v_ok, v_no, v_falta
      FROM public.envio_linea WHERE request_id = NEW.id;

    -- Sólo faltantes: ya lo dijo `avisar_faltantes`, con el producto y el
    -- enlace. No se repite.
    IF coalesce(v_ok, 0) = 0 AND coalesce(v_no, 0) = 0 AND coalesce(v_falta, 0) > 0 THEN
        RETURN NEW;
    END IF;

    SELECT string_agg(coalesce(descripcion, 'el producto #' || erp_product_id)
                      || ' (' || coalesce(motivo_rechazo, 'sin motivo') || ')', '; ' ORDER BY posicion)
      INTO v_lista
      FROM public.envio_linea
     WHERE request_id = NEW.id AND estado IN ('devuelta','devuelta_recibida');

    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = NEW.employee_id
            OR (e.branch_id = v_org
                AND (public.rango_de_empleado(e.id) BETWEEN 1 AND 2
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_org) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF coalesce(v_no, 0) = 0 THEN
        v_titulo := coalesce(v_sala, 'La otra sala') || ' recibió tu envío';
        v_cuerpo := v_quien || ' aceptó ' || v_ok
                 || CASE WHEN v_ok = 1 THEN ' producto' ELSE ' productos' END || ' de tu envío.';
    ELSE
        v_titulo := coalesce(v_sala, 'La otra sala') || ' te devuelve '
                 || CASE WHEN v_no = 1 THEN 'un producto' ELSE v_no || ' productos' END || ' de tu envío';
        v_cuerpo := v_quien || ' devuelve ' || v_no
                 || CASE WHEN v_no = 1 THEN ' producto' ELSE ' productos' END
                 || CASE WHEN coalesce(v_ok,0) > 0 THEN ' y se queda con ' || v_ok ELSE '' END
                 || coalesce(': ' || v_lista, '')
                 || '. Confirma cuando la caja esté de vuelta en tu sala.';
    END IF;

    -- Lo que no llegó se agrega SIEMPRE al final, en las dos ramas: es el único
    -- dato del aviso que manda a alguien a mirar el mostrador hoy.
    IF coalesce(v_falta, 0) > 0 THEN
        v_cuerpo := v_cuerpo || ' Ojo: ' || v_falta
                 || CASE WHEN v_falta = 1 THEN ' producto no llegó en la caja.'
                         ELSE ' productos no llegaron en la caja.' END
                 || ' Revisa si quedó en tu sala.';
    END IF;

    v_link := '/traslados?tab=envios&envio=' || NEW.id;

    -- Lo que dibuja la tarjeta (24-sep): quién lo recibió, cuántos se quedó,
    -- cuáles devuelve y por qué, y cuántos no llegaron.
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre', coalesce(descripcion, 'Producto #' || erp_product_id),
               'motivo', motivo_rechazo)) ORDER BY posicion)
      INTO v_devs
      FROM (SELECT * FROM public.envio_linea
             WHERE request_id = NEW.id AND estado IN ('devuelta','devuelta_recibida')
             ORDER BY posicion LIMIT 15) l;

    v_resp := jsonb_strip_nulls(jsonb_build_object(
        'tipo',        'envio',
        'estado',      CASE WHEN coalesce(v_no, 0) = 0 THEN 'RECIBIDO' ELSE 'DEVUELVE' END,
        'quien',       v_nombre,
        'quien_id',    NEW.approver_id,
        'quien_foto',  public.foto_de_empleado(NEW.approver_id),
        'sala',        v_sala,
        'aceptados',   coalesce(v_ok, 0),
        'devueltos',   v_devs,
        'no_llegaron', nullif(coalesce(v_falta, 0), 0)));

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status,
                              'respuesta', v_resp),
           v_org, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        -- La línea corta del teléfono (24-sep).
        body := jsonb_build_object('title', v_titulo,
                'message', public.texto_de_push('REQUEST_RESOLVED', v_cuerpo, jsonb_build_object('respuesta', v_resp)),
                'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_envio_despachado(p_request_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_quien  text;
    v_n      integer;
    v_unid   numeric;
    v_que    text;
    v_salidas integer;
    v_ya     integer;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    -- La tarjeta de la campana (24-sep).
    v_nombre text;
    v_prods  jsonb;
    v_sol    jsonb;
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL OR r.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN 0; END IF;

    m := coalesce(r.metadata, '{}'::jsonb);

    -- Cuántos salieron ALGUNA VEZ. Este número sólo crece, así que sirve de
    -- marca de agua contra lo ya anunciado.
    SELECT count(*) INTO v_salidas
      FROM public.envio_linea l
     WHERE l.request_id = p_request_id AND l.enviado_at IS NOT NULL;

    v_ya := coalesce((m->>'avisado_lineas')::integer, 0);
    IF coalesce(v_salidas, 0) <= v_ya THEN RETURN 0; END IF;

    -- Y de ésos, los que esperan que la sala de destino los mire: es de lo que
    -- habla el aviso. Sin ninguno no hay nada que anunciar —salió y ya se
    -- decidió— pero la marca se sube igual, para no anunciarlo más tarde.
    SELECT count(*), coalesce(sum(l.unidades), 0),
           CASE WHEN count(*) = 1 THEN max(coalesce(l.descripcion, 'el producto #' || l.erp_product_id))
                ELSE NULL END
      INTO v_n, v_unid, v_que
      FROM public.envio_linea l
     WHERE l.request_id = p_request_id AND l.estado = 'enviada';

    IF coalesce(v_n, 0) = 0 THEN
        UPDATE public.approval_requests
           SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('avisado_lineas', v_salidas)
         WHERE id = p_request_id;
        RETURN 0;
    END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = r.employee_id;
    v_quien := coalesce(v_nombre, 'Otra sala');

    -- La sala que envía va en el título, sin emoji (24-sep): el color y el
    -- ícono los pone la tarjeta.
    v_titulo := coalesce(nullif(m->>'origen_branch_name', ''), 'Otra sala') || ' te envía producto';
    v_cuerpo := v_quien || ' (' || coalesce(nullif(m->>'origen_branch_name',''), 'otra sala') || ') te envía '
             || trim(to_char(v_unid, 'FM999,999,990.####'))
             || CASE WHEN v_unid = 1 THEN ' unidad' ELSE ' unidades' END
             || coalesce(' de ' || v_que,
                         ' de ' || v_n || CASE WHEN v_n = 1 THEN ' producto' ELSE ' productos' END)
             || ' — ' || coalesce(m->>'motivo_tipo', 'sin motivo')
             || coalesce(': ' || left(nullif(btrim(coalesce(m->>'reason', r.note, '')), ''), 120), '')
             || '. Revisa la caja y acepta o devuelve lo que no vayas a vender.';

    v_link := '/traslados?tab=envios&envio=' || r.id;

    /* Lo que dibuja la tarjeta (usuario, 24-sep): quién lo envía con su cara,
     * cada producto que espera respuesta con cuántas unidades, y el motivo.
     * Es la misma tarjeta de las solicitudes (`metadata.solicitud`). */
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre',   coalesce(l.descripcion, 'Producto #' || l.erp_product_id),
               'cantidad', l.unidades)) ORDER BY l.posicion)
      INTO v_prods
      FROM (SELECT * FROM public.envio_linea
             WHERE request_id = p_request_id AND estado = 'enviada'
             ORDER BY posicion LIMIT 15) l;

    v_sol := jsonb_strip_nulls(jsonb_build_object(
        'tipo',       'INVENTORY_TRANSFER_PUSH',
        'etiqueta',   'Envío de producto',
        'quien',      v_nombre,
        'quien_id',   r.employee_id,
        'quien_foto', public.foto_de_empleado(r.employee_id),
        'sala',       nullif(m->>'origen_branch_name', ''),
        'productos',  v_prods,
        'mas',        nullif(greatest(v_n - 15, 0), 0),
        'unidades',   v_unid,
        'motivo',     nullif(concat_ws(': ', nullif(m->>'motivo_tipo', ''),
                              left(nullif(btrim(coalesce(m->>'reason', r.note, '')), ''), 160)), '')));

    SELECT coalesce(
             (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(m->'destinatarios') d),
             ARRAY[r.approver_id]) INTO v_dest;
    v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(v_dest) x WHERE x IS NOT NULL AND x <> r.employee_id);
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    -- Se anota ANTES de mandar: `pg_net` es transaccional, así que si algo de
    -- acá para abajo revienta, la anotación se va con él y el aviso se puede
    -- volver a intentar.
    UPDATE public.approval_requests
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('avisado_lineas', v_salidas)
     WHERE id = p_request_id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'solicitud', v_sol),
           nullif(m->>'branch_id','')::integer, r.employee_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        -- La línea corta del teléfono (24-sep).
        body    := jsonb_build_object('title', v_titulo,
                                      'message', public.texto_de_push('REQUEST_PENDING', v_cuerpo, jsonb_build_object('solicitud', v_sol)),
                                      'url', v_link,
                                      'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN coalesce(array_length(v_dest, 1), 0);
END;
$function$;
