-- Cargas y descartes de inventario: la solicitud, su validación y su aviso.
--
-- Se cuelga de `approval_requests` en vez de estrenar tabla: ahí ya viven el RLS
-- (el aprobador ve las de su sucursal), el trigger que crea la notificación y el
-- que la marca resuelta, la campana y la vista /requests. Lo único que faltaba
-- eran los dos tipos nuevos y una validación propia.
--
-- El `concepto` que viaja al ERP se arma en la Edge Function con causa +
-- solicitante + aprobador, y por eso la causa es obligatoria acá: sin ella el
-- asiento del kardex queda sin explicación y no hay dónde recuperarla.

SET lock_timeout = '5s';

-- ── 0 · El CHECK de `type` ──────────────────────────────────────────────────
-- `approval_requests_type_check` enumera los tipos aceptados, así que sin
-- tocarlo los dos nuevos rebotan con un error de constraint y no hay widget que
-- funcione. Lo destapó la prueba con inserts reales: las diez validaciones
-- nuevas pasaban y las DOS solicitudes bien formadas eran las que fallaban.
-- La tabla tiene una fila, así que el drop+add es instantáneo.
ALTER TABLE public.approval_requests DROP CONSTRAINT IF EXISTS approval_requests_type_check;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_type_check
    CHECK (type = ANY (ARRAY[
        'PERMIT','VACATION','SHIFT_CHANGE','OVERTIME','ADVANCE','CERTIFICATE',
        'DISABILITY','VACATION_CHANGE','SHIFT_EXCEPTION',
        'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST',
        'CLIENT_CHANGE_REQUEST',
        'INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST'
    ]));

-- ── 1 · El aviso: qué, dónde, cuánto y por qué ──────────────────────────────
-- Sin esto los dos tipos nuevos caen en el ELSE genérico ("Nueva solicitud
-- pendiente"), que no alcanza para decidir sin abrir la app.
CREATE OR REPLACE FUNCTION public.notificar_solicitud_creada()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
BEGIN
    IF NEW.status <> 'PENDING' OR NEW.approver_id IS NULL OR NEW.approver_id = NEW.employee_id THEN
        RETURN NEW;
    END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.employee_id;
    v_quien := coalesce(v_quien, 'Un empleado');

    v_etiqueta := CASE NEW.type
        WHEN 'ANNULMENT_REQUEST'         THEN 'Anulación de Factura'
        WHEN 'PAYMENT_CHANGE_REQUEST'    THEN 'Cambio de Forma de Pago'
        WHEN 'VENDOR_CHANGE_REQUEST'     THEN 'Cambio de Vendedor'
        WHEN 'CLIENT_CHANGE_REQUEST'     THEN 'Cambio de Cliente'
        WHEN 'INVENTORY_LOAD_REQUEST'    THEN 'Carga de Inventario'
        WHEN 'INVENTORY_DISCARD_REQUEST' THEN 'Descarte de Inventario'
        WHEN 'PERMIT'                    THEN 'Permiso / Licencia'
        WHEN 'VACATION'                  THEN 'Vacaciones'
        WHEN 'VACATION_CHANGE'           THEN 'Cambio de Vacaciones'
        WHEN 'SHIFT_CHANGE'              THEN 'Cambio de Turno'
        WHEN 'SHIFT_EXCEPTION'           THEN 'Excepción de Turno'
        WHEN 'OVERTIME'                  THEN 'Horas Extra'
        WHEN 'ADVANCE'                   THEN 'Anticipo Salarial'
        WHEN 'CERTIFICATE'               THEN 'Constancia Laboral'
        WHEN 'DISABILITY'                THEN 'Incapacidad'
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

    -- ── Los dos nuevos ──────────────────────────────────────────────────────
    -- El cuerpo tiene que alcanzar para decidir sin abrir la app: cuántas
    -- líneas, cuántas unidades, cuánto vale, de qué sucursal y por qué.
    ELSIF NEW.type IN ('INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST') THEN
        v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
        v_unidades := coalesce((m->>'total_unidades')::numeric, 0);
        v_donde    := coalesce(nullif(m->>'branch_name', ''), 'una sucursal');

        IF NEW.type = 'INVENTORY_LOAD_REQUEST' THEN
            v_titulo := '📦 Carga de Inventario';
            v_cuerpo := v_quien || ' solicita cargar ';
        ELSE
            v_titulo := '🗑️ Descarte de Inventario';
            v_cuerpo := v_quien || ' solicita descartar ';
        END IF;

        v_cuerpo := v_cuerpo
                 || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END
                 || ' (' || trim(to_char(v_unidades, 'FM999,999,990.####'))
                 || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END
                 || coalesce(' · ' || v_monto, '') || ')'
                 -- El subtipo es el que explica el asiento en el kardex.
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

    -- El id va en la URL: es lo que convierte "andá a buscarla" en "acá está".
    v_link := v_base || '?solicitud=' || NEW.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    VALUES (
        NEW.approver_id, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
        jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'correlativo', m->>'correlativo'),
        nullif(m->>'branch_id', '')::integer,
        NEW.employee_id
    );

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object(
            'title', v_titulo, 'message', v_cuerpo, 'url', v_link,
            'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[NEW.approver_id])
        )
    );

    RETURN NEW;
END;
$function$;

-- ── 2 · La validación, en la BD ─────────────────────────────────────────────
-- Va acá y no en la pantalla porque el RLS impide que el navegador vea las
-- solicitudes de otros: una validación que no puede ver el dato no valida nada.
CREATE OR REPLACE FUNCTION public.validar_solicitud_movimiento_inventario()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m          jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_items    jsonb := m->'items';
    it         jsonb;
    v_sub      text  := nullif(btrim(coalesce(m->>'subtipo', '')), '');
    v_suc      integer;
    v_ubic     integer;
    -- Los cuatro exactos del <select> del ERP. Cualquier otro valor lo rechaza
    -- el ERP con un 200 y un typeinfo Error, que es justo lo que no queremos
    -- descubrir después de aprobar.
    v_subtipos text[] := ARRAY['VENCIMIENTO','DESCARTE','PRODUCTO DAÑADO','CONSUMO INTERNO'];
BEGIN
    IF NEW.type NOT IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST') THEN
        RETURN NEW;
    END IF;

    -- La causa: es lo que va al `concepto` del ERP y queda en el kardex.
    IF nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La solicitud necesita una causa: es lo que queda escrito en el movimiento.';
    END IF;

    IF NEW.type = 'INVENTORY_DISCARD_REQUEST' THEN
        IF v_sub IS NULL THEN
            RAISE EXCEPTION 'Un descarte necesita su tipo (%).', array_to_string(v_subtipos, ', ');
        END IF;
        IF NOT (v_sub = ANY (v_subtipos)) THEN
            RAISE EXCEPTION 'Tipo de descarte no válido: "%". Los aceptados son %.',
                v_sub, array_to_string(v_subtipos, ', ');
        END IF;
    ELSIF v_sub IS NOT NULL THEN
        RAISE EXCEPTION 'Una carga no lleva tipo de descarte.';
    END IF;

    -- Sucursal y ubicación: los ids del ERP, no los del portal. Son
    -- numeraciones distintas y el ERP acepta la equivocada sin protestar.
    v_suc  := nullif(m->>'erp_sucursal_id', '')::integer;
    v_ubic := nullif(m->>'erp_ubicacion_id', '')::integer;

    IF v_suc IS NULL OR v_ubic IS NULL THEN
        RAISE EXCEPTION 'Falta la sucursal o la ubicación del ERP en la solicitud.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_suc) THEN
        RAISE EXCEPTION 'La sucursal % no existe en el mapa del ERP.', v_suc;
    END IF;

    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'La solicitud no tiene ni un producto.';
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        IF coalesce(nullif(it->>'erp_product_id','')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'Hay una línea sin producto.';
        END IF;
        -- El id_presentacion tiene que venir resuelto: en el ERP son tres
        -- opciones de etiqueta idéntica y el orden cambia entre pantallas, así
        -- que elegir "la primera" apunta a cosas distintas según dónde se mire.
        IF coalesce(nullif(it->>'id_presentacion','')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'La línea del producto % no trae presentación resuelta.',
                it->>'erp_product_id';
        END IF;
        IF coalesce(nullif(it->>'cantidad','')::numeric, 0) <= 0 THEN
            RAISE EXCEPTION 'La línea del producto % no tiene cantidad.',
                it->>'erp_product_id';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validar_solicitud_movimiento_inventario ON public.approval_requests;
CREATE TRIGGER trg_validar_solicitud_movimiento_inventario
    BEFORE INSERT ON public.approval_requests
    FOR EACH ROW EXECUTE FUNCTION public.validar_solicitud_movimiento_inventario();

REVOKE EXECUTE ON FUNCTION public.validar_solicitud_movimiento_inventario() FROM PUBLIC, anon;
