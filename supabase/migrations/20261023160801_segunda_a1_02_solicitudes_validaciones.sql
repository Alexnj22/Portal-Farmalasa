-- segunda-a1-02 · Solicitudes: validaciones de alta y vigilancia (H2, H6, H7, H8)
-- Las cuatro funciones parten de su definición VIVA (pg_get_functiondef,
-- 2026-10-23). Sólo cambia lo que se anota en cada bloque.
SET lock_timeout = '5s';

-- ── H2 · Un movimiento de inventario es de UNA sala, y es la de quien pide ──
CREATE OR REPLACE FUNCTION public.validar_solicitud_movimiento_inventario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m          jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_items    jsonb := m->'items';
    it         jsonb;
    v_sub      text  := nullif(btrim(coalesce(m->>'subtipo', '')), '');
    v_suc      integer;
    v_ubic     integer;
    v_branch   integer;
    v_dice     integer;
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
        RAISE EXCEPTION 'Falta la sucursal o la ubicación en la solicitud.';
    END IF;
    SELECT branch_id INTO v_branch FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_suc;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La sucursal % no existe.', v_suc;
    END IF;

    -- H2: una sola sala. La del rótulo tiene que ser la que se mueve.
    v_dice := nullif(m->>'branch_id', '')::integer;
    IF v_dice IS NOT NULL AND v_dice IS DISTINCT FROM v_branch THEN
        RAISE EXCEPTION 'La sala de la solicitud no coincide con la sucursal del movimiento.';
    END IF;
    m := m || jsonb_build_object('branch_id', v_branch);
    NEW.metadata := m;

    -- H2: con alcance de sucursal, sólo la propia (o la que se está cubriendo).
    -- Sin sesión de empleado (edge function con la llave del servidor) no hay
    -- a quién comparar: ese camino valida por su cuenta.
    IF public.auth_employee_id() IS NOT NULL
       AND 'ALL' <> ALL (ARRAY[coalesce(public.auth_module_scope('requests'), ''),
                               coalesce(public.auth_module_scope('requests_inventario'), ''),
                               coalesce(public.auth_module_scope('dash_inv_movement'), '')])
       AND v_branch IS DISTINCT FROM public.auth_employee_branch_id()
       AND NOT (v_branch = ANY (coalesce(public.salas_que_cubro_ahora(), ARRAY[]::integer[]))) THEN
        RAISE EXCEPTION 'Sólo puedes pedir movimientos de inventario de tu sucursal.'
            USING ERRCODE = '42501';
    END IF;

    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'La solicitud no tiene ni un producto.';
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        IF coalesce(nullif(it->>'erp_product_id','')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'Hay una línea sin producto.';
        END IF;

        -- El significado de la presentación, no su id: «UNIDAD» + factor 1.
        -- Con eso la Edge Function encuentra la opción del ERP por etiqueta.
        IF nullif(btrim(coalesce(it->>'presentacion_tipo','')), '') IS NULL THEN
            RAISE EXCEPTION 'La línea del producto % no dice qué presentación es.',
                it->>'erp_product_id';
        END IF;
        IF coalesce(nullif(it->>'factor','')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'La presentación del producto % no trae su factor.',
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

-- ── H8 · Los dos estados de «anulada», no uno ──────────────────────────────
CREATE OR REPLACE FUNCTION public.validar_solicitud_facturacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_estado text;
    v_id     bigint;
BEGIN
    IF NEW.type NOT IN ('ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                        'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST') THEN
        RETURN NEW;
    END IF;

    -- Antes de mirar la factura: no depende de ella y el motivo es distinto.
    IF NEW.type = 'PAYMENT_CHANGE_REQUEST'
       AND lower(coalesce(NEW.metadata->>'new_pago', '')) = 'credito' THEN
        RAISE EXCEPTION 'PAGO_A_CREDITO_NO: una venta emitida no se puede pasar a crédito; hay que anularla y volver a facturarla.';
    END IF;

    BEGIN
        v_id := (NEW.metadata->>'invoice_id')::bigint;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'SOLICITUD_SIN_FACTURA: la solicitud no identifica una factura.';
    END;

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'SOLICITUD_SIN_FACTURA: la solicitud no identifica una factura.';
    END IF;

    SELECT estado INTO v_estado FROM public.sales_invoices WHERE id = v_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FACTURA_NO_EXISTE: esa factura ya no está en el portal.';
    END IF;

    -- Una factura anulada no se anula otra vez, y tampoco se le cambia el
    -- cliente, la forma de pago ni el vendedor: ya no es un documento vivo.
    IF upper(coalesce(v_estado, '')) = 'NULA'
       OR (public.factura_esta_anulada(v_estado) AND NEW.type <> 'ANNULMENT_REQUEST') THEN
        RAISE EXCEPTION 'FACTURA_ANULADA: esa factura ya está anulada.';
    END IF;

    RETURN NEW;
END;
$function$;

-- ── H7 · «Hoy» es el de El Salvador ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.empleado_no_disponible(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_events e
    WHERE e.employee_id = p_employee_id
      AND e.type IN ('VACATION','DISABILITY')
      AND e.date <= (now() AT TIME ZONE 'America/El_Salvador')::date
      AND coalesce(e.metadata->>'status','') NOT IN ('CANCELLED','SUPERSEDED')
      AND (
        nullif(e.metadata->>'endDate','') IS NULL
        OR nullif(e.metadata->>'endDate','') >= to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM-DD')
      )
  );
$function$;

-- ── H6 · Vigilar por la fecha del CAMBIO, no por el mes de la venta ──────────
CREATE OR REPLACE FUNCTION public.avisar_cambios_que_no_se_quedaron(p_horas integer DEFAULT 2)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r          record;
    v_dest     uuid[];
    v_titulo   text;
    v_cuerpo   text;
    v_link     text;
    v_esperado text;
    v_actual   text;
    v_que      text;
    v_n        integer := 0;
BEGIN
    FOR r IN
        SELECT ar.id, ar.type, ar.employee_id, ar.approver_id,
               ar.metadata->'erp_aplicado'->>'campo' AS campo,
               ar.metadata->'erp_aplicado'->>'a'     AS aplicado,
               si.correlativo, si.cod_vendedor, si.tipo_pago, si.fecha,
               b.name AS sala
          FROM public.approval_requests ar
          JOIN public.sales_invoices si
            ON si.id = (ar.metadata->>'invoice_id')::bigint
          LEFT JOIN public.branches b ON b.id = si.branch_id
         WHERE ar.status = 'APPROVED'
           AND ar.metadata ? 'erp_aplicado'
           AND ar.metadata->'erp_aplicado'->>'campo' IN ('cod_vendedor', 'tipo_pago')
           AND coalesce((ar.metadata->>'avisado_no_se_quedo')::boolean, false) = false
           AND (ar.metadata->'erp_aplicado'->>'at')::timestamptz
                 < now() - make_interval(hours => greatest(1, p_horas))
           AND (ar.metadata->'erp_aplicado'->>'at')::timestamptz
                 >= now() - interval '10 days'
           AND public.venta_valida(si.estado)
    LOOP
        IF r.campo = 'cod_vendedor' THEN
            CONTINUE WHEN btrim(coalesce(r.aplicado, '')) = '';
            CONTINUE WHEN btrim(coalesce(r.cod_vendedor, '')) = btrim(r.aplicado);
            v_esperado := public.nombre_de_vendedor(r.aplicado);
            v_actual   := public.nombre_de_vendedor(r.cod_vendedor);
            v_que      := 'el vendedor';
        ELSE
            CONTINUE WHEN btrim(coalesce(r.aplicado, '')) = '';
            CONTINUE WHEN lower(btrim(coalesce(r.tipo_pago, ''))) = lower(btrim(r.aplicado));
            v_esperado := public.nombre_de_pago(r.aplicado);
            v_actual   := public.nombre_de_pago(r.tipo_pago);
            v_que      := 'la forma de pago';
        END IF;

        v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(
                     ARRAY[r.approver_id, r.employee_id]) x WHERE x IS NOT NULL);
        v_dest := coalesce(v_dest, ARRAY[]::uuid[]);
        CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

        v_titulo := '⚠️ Un cambio de venta no se quedó';
        v_cuerpo := 'La venta ' || coalesce(r.correlativo, 'sin número')
                 || ' de ' || coalesce(r.sala, 'una sala')
                 || ' se cambió a ' || v_esperado || ', pero hoy vuelve a decir '
                 || v_actual || '. El cambio de ' || v_que
                 || ' no se quedó: hay que revisarla.';
        v_link := CASE WHEN public.es_solicitud_operativa(r.type)
                       THEN '/solicitudes' ELSE '/solicitudes-personales' END
               || '?solicitud=' || r.id;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, created_by)
        SELECT d, 'REQUEST_DECIDED', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', r.id, 'request_type', r.type,
                                  'campo', r.campo,
                                  'esperado', r.aplicado,
                                  'en_el_portal', CASE WHEN r.campo = 'cod_vendedor'
                                                       THEN r.cod_vendedor ELSE r.tipo_pago END),
               r.employee_id
          FROM unnest(v_dest) d;

        UPDATE public.approval_requests
           SET metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('avisado_no_se_quedo', true)
         WHERE id = r.id;

        PERFORM net.http_post(
            url     := public.push_function_url(),
            headers := public.push_function_headers(),
            body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo,
                                          'url', v_link, 'target_type', 'EMPLOYEE',
                                          'target_value', to_jsonb(v_dest)));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;
