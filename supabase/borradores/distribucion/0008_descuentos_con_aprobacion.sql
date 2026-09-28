-- ════════════════════════════════════════════════════════════════════════════
-- Distribución — el descuento que no se puede dar, se PIDE
-- ════════════════════════════════════════════════════════════════════════════
--
-- BORRADOR (ver 0001). Pedido del usuario, 2026-09-28:
--   «los descuentos sólo personas que tienen permiso. Si se le quiere aplicar
--   algo extra debe mandar solicitud; al recibirla se ve, y se aprueba o
--   rechaza. Por lo que debe quedar esa venta como preventa sin finalizar, y
--   se actualiza».
--
-- ── Quién da qué ────────────────────────────────────────────────────────────
--   · `distribucion_descuentos` (editar): da descuentos hasta el tope de la
--     empresa (`dist_emisores.descuento_max_pct`) sin pedirle a nadie.
--   · `distribucion_config` (editar): cualquier descuento (es quien fija el tope).
--   · Todo lo demás —sin permiso, o pasando el tope— NO se aplica: el renglón
--     queda con el descuento PEDIDO y en cero, y la venta queda como preventa
--     hasta que alguien con `requests_distribucion` (aprobar) lo resuelva en
--     Solicitudes. Quien pide no puede aprobárselo.
--
-- ── Por qué en cero mientras espera ────────────────────────────────────────
-- Lo que la pantalla, el pedido y un eventual documento muestran es lo que
-- VALE hoy. Un descuento pedido y todavía no dado no se cobra: si se aprueba,
-- el renglón se actualiza solo; si se rechaza, queda como estaba.
--
-- ── Qué se toca de lo compartido, y qué no ─────────────────────────────────
-- Del sistema de solicitudes sólo lo mínimo: el CHECK de tipos, qué módulo lo
-- decide (`modulo_de_aprobacion`) y que es operativa (`es_solicitud_operativa`).
-- `notificar_solicitud_creada` NO se reescribe (327 líneas que otras sesiones
-- tocan seguido): la solicitud nace sin `approver_id` —así ese trigger no
-- avisa con la clave cruda como rótulo— y el aviso lo manda `dist_pedir_descuento`
-- a todos los que pueden decidirla. Decidir va por `dist_resolver_descuento`
-- (DEFINER), así la policy de UPDATE tampoco se toca.
--
-- ⚠️ Al pasar a producción: las tres definiciones compartidas de abajo se
-- regeneran desde la VIVA de producción (`pg_get_functiondef`) y se les agrega
-- el tipo nuevo. Copiarlas de este archivo pisaría lo que otra sesión haya
-- cambiado entretanto.

SET lock_timeout = '5s';

-- ── 1 · Los renglones recuerdan el descuento pedido ────────────────────────
ALTER TABLE public.dist_pedido_items
    ADD COLUMN descuento_estado text NOT NULL DEFAULT 'aplicado'
        CHECK (descuento_estado IN ('aplicado', 'pendiente', 'rechazado')),
    -- Lo que se PIDIÓ, con IVA, cuando no se pudo aplicar.
    ADD COLUMN descuento_pedido numeric(14,6) CHECK (descuento_pedido IS NULL OR descuento_pedido >= 0);

ALTER TABLE public.dist_pedidos
    ADD COLUMN descuento_solicitud_id uuid REFERENCES public.approval_requests(id);
CREATE INDEX dist_pedidos_descuento_solicitud ON public.dist_pedidos (descuento_solicitud_id);

-- ── 2 · El sistema de solicitudes conoce el tipo nuevo ─────────────────────
ALTER TABLE public.approval_requests DROP CONSTRAINT IF EXISTS approval_requests_type_check;
ALTER TABLE public.approval_requests
    ADD CONSTRAINT approval_requests_type_check CHECK (type IN (
        'PERMISSION','VACATION','SICK_LEAVE','SCHEDULE_CHANGE','SHIFT_CHANGE','OTHER',
        'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST',
        'CLIENT_CHANGE_REQUEST',
        'INVENTORY_TRANSFER_REQUEST','INVENTORY_TRANSFER_PUSH',
        'INVENTORY_DISCARD_REQUEST','INVENTORY_LOAD_REQUEST',
        'MINMAX_CHANGE_REQUEST',
        'CAJA_MOVIMIENTO_CHANGE',
        'ABONO_CREDITO_CHANGE',
        'ABONO_APROBACION',
        'DIST_DESCUENTO'
    )) NOT VALID;
ALTER TABLE public.approval_requests VALIDATE CONSTRAINT approval_requests_type_check;

CREATE OR REPLACE FUNCTION public.es_solicitud_operativa(p_type text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_type = ANY (ARRAY[
    'ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
    'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST',
    'INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST',
    'INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH',
    'CAJA_MOVIMIENTO_CHANGE',
    'ABONO_CREDITO_CHANGE', 'ABONO_APROBACION',
    'DIST_DESCUENTO'
  ]);
$function$;

CREATE OR REPLACE FUNCTION public.modulo_de_aprobacion(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN p_type = ANY (ARRAY['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                             'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
      THEN 'requests_facturacion'
    WHEN p_type = ANY (ARRAY['INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST'])
      THEN 'requests_inventario'
    WHEN p_type = 'CAJA_MOVIMIENTO_CHANGE'
      THEN 'requests_caja'
    WHEN p_type = ANY (ARRAY['ABONO_CREDITO_CHANGE', 'ABONO_APROBACION'])
      THEN 'requests_cuentas_por_cobrar'
    WHEN p_type = 'DIST_DESCUENTO'
      THEN 'requests_distribucion'
    ELSE NULL
  END;
$function$;

-- Una sola solicitud pendiente por venta.
CREATE UNIQUE INDEX approval_requests_un_descuento_por_venta
    ON public.approval_requests ((metadata ->> 'pedido_id'))
    WHERE status = 'PENDING' AND type = 'DIST_DESCUENTO';

-- ── 3 · Permisos: los dos módulos nuevos, sembrados desde los que ya hay ────
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'distribucion_descuentos', true, true, false, 'ALL'
  FROM public.role_permissions rp
 WHERE rp.module_key = 'distribucion_config' AND rp.can_edit
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'requests_distribucion', true, true, true, 'ALL'
  FROM public.role_permissions rp
 WHERE rp.module_key = 'requests_cuentas_por_cobrar' AND rp.can_approve
ON CONFLICT DO NOTHING;

-- ── 4 · El juez del renglón: aplica lo que se puede, guarda lo que se pide ─
CREATE OR REPLACE FUNCTION public.dist_validar_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_cliente   public.dist_clientes%ROWTYPE;
    v_pedido    public.dist_pedidos%ROWTYPE;
    v_cat       public.dist_catalogo%ROWTYPE;
    v_prod      public.products%ROWTYPE;
    v_emisor    public.dist_emisores%ROWTYPE;
    v_precio    numeric;
    v_lista     smallint;
    v_importe   numeric;
    v_pedido_d  numeric;   -- el descuento que se pide en este renglón, con IVA
    v_pct       numeric;
    v_puede     boolean;
BEGIN
    SELECT * INTO v_pedido FROM public.dist_pedidos WHERE id = NEW.pedido_id;
    IF v_pedido.estado <> 'confirmado' THEN
        RAISE EXCEPTION 'DIST_PEDIDO_CERRADO: el pedido ya está %', v_pedido.estado;
    END IF;
    SELECT * INTO v_cliente FROM public.dist_clientes WHERE id = v_pedido.cliente_id;
    SELECT * INTO v_emisor FROM public.dist_emisores WHERE id = v_pedido.emisor_id;
    SELECT * INTO v_cat FROM public.dist_catalogo
     WHERE emisor_id = v_pedido.emisor_id AND product_id = NEW.product_id AND activo;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DIST_FUERA_DE_CATALOGO: el producto % no está en el catálogo de ruta', NEW.product_id;
    END IF;
    SELECT * INTO v_prod FROM public.products WHERE id = NEW.product_id;
    IF v_cliente.tipo IN ('tienda','supermercado') AND (
        NOT v_cat.venta_libre OR coalesce(v_prod.es_antibiotico, false)
        OR coalesce(v_prod.regulado, false) OR coalesce(v_prod.requiere_receta, false)) THEN
        RAISE EXCEPTION 'DIST_NO_VENTA_LIBRE: «%» no es de venta libre y el cliente es %', v_prod.nombre, v_cliente.tipo;
    END IF;

    -- Precio: la lista pedida → la del cliente → la base; y si la presentación
    -- no tiene precio, «UNIDAD» con el precio del catálogo. Gemelo de pantalla:
    -- src/views/distribucion/precios.js.
    v_lista := coalesce(NEW.lista_id, v_cliente.lista_id);
    SELECT p.precio_con_iva, p.lista_id, p.unidades INTO v_precio, v_lista, NEW.unidades
      FROM public.dist_precios p JOIN public.dist_listas l ON l.id = p.lista_id
     WHERE p.emisor_id = v_pedido.emisor_id AND p.product_id = NEW.product_id
       AND p.presentacion = NEW.presentacion AND p.activo AND l.activo
     ORDER BY (p.lista_id = v_lista) DESC, l.orden
     LIMIT 1;
    IF NOT FOUND THEN
        IF NEW.presentacion <> 'UNIDAD' THEN
            RAISE EXCEPTION 'DIST_SIN_PRECIO: «%» no tiene precio en la presentación %', v_prod.nombre, NEW.presentacion;
        END IF;
        v_precio := v_cat.precio_con_iva;
        NEW.unidades := 1;
        v_lista := NULL;
    END IF;
    NEW.precio_con_iva := v_precio;
    NEW.lista_id := v_lista;
    NEW.descripcion := v_prod.nombre || CASE WHEN NEW.presentacion <> 'UNIDAD' THEN ' — ' || NEW.presentacion ELSE '' END;

    -- ── El descuento ──
    v_importe := NEW.cantidad * NEW.precio_con_iva;
    -- Aprobando una solicitud: `dist_resolver_descuento` ya decidió; el
    -- renglón trae el monto final y no se vuelve a juzgar.
    IF current_setting('dist.resolviendo_descuento', true) = 'on' THEN
        IF NEW.descuento > v_importe THEN
            RAISE EXCEPTION 'DIST_DESCUENTO: el descuento pasa del importe del renglón';
        END IF;
        RETURN NEW;
    END IF;

    v_pedido_d := CASE WHEN NEW.descuento_pct IS NOT NULL
                       THEN round(v_importe * NEW.descuento_pct / 100, 2)
                       ELSE NEW.descuento END;
    IF v_pedido_d > v_importe THEN
        RAISE EXCEPTION 'DIST_DESCUENTO: el descuento pasa del importe del renglón';
    END IF;

    IF v_pedido_d = 0 THEN
        NEW.descuento := 0;
        NEW.descuento_estado := 'aplicado';
        NEW.descuento_pedido := NULL;
        RETURN NEW;
    END IF;

    -- Volver a guardar la venta con el MISMO descuento ya dado (aprobado o
    -- aplicado por quien podía) no lo vuelve a poner en duda.
    IF TG_OP = 'UPDATE' AND OLD.descuento_estado = 'aplicado' AND OLD.descuento = v_pedido_d
       AND OLD.cantidad = NEW.cantidad AND OLD.precio_con_iva = NEW.precio_con_iva THEN
        NEW.descuento := v_pedido_d;
        NEW.descuento_estado := 'aplicado';
        NEW.descuento_pedido := NULL;
        RETURN NEW;
    END IF;

    v_pct := CASE WHEN v_importe > 0 THEN v_pedido_d * 100 / v_importe ELSE 0 END;
    v_puede := (SELECT auth.role()) = 'service_role'
        OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config']))
        OR ((SELECT public.auth_can_edit_any(ARRAY['distribucion_descuentos']))
            AND v_pct <= v_emisor.descuento_max_pct + 0.005);

    IF v_puede THEN
        NEW.descuento := v_pedido_d;
        NEW.descuento_estado := 'aplicado';
        NEW.descuento_pedido := NULL;
    ELSE
        -- Se guarda lo pedido; lo que vale hoy es cero.
        NEW.descuento := 0;
        NEW.descuento_estado := 'pendiente';
        NEW.descuento_pedido := v_pedido_d;
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_validar_item() FROM PUBLIC, anon, authenticated;

-- ── 5 · Pedir: una solicitud por venta, con el detalle y el aviso ──────────
CREATE OR REPLACE FUNCTION public.dist_pedir_descuento(p_pedido bigint, p_nota text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo       uuid := public.auth_employee_id();
    v_pedido   public.dist_pedidos%ROWTYPE;
    v_cliente  text;
    v_quien    text;
    v_renglones jsonb;
    v_total    numeric;
    v_tope     numeric;
    v_id       uuid;
    v_dest     uuid[];
    v_titulo   text;
    v_cuerpo   text;
    v_link     text;
BEGIN
    IF v_yo IS NULL OR NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes vender en Distribución';
    END IF;
    SELECT * INTO v_pedido FROM public.dist_pedidos WHERE id = p_pedido FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'no existe el pedido %', p_pedido; END IF;
    IF v_pedido.estado <> 'confirmado' THEN
        RAISE EXCEPTION 'DIST_PEDIDO_CERRADO: el pedido ya está %', v_pedido.estado;
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
               'descripcion', i.descripcion, 'cantidad', i.cantidad,
               'precio', i.precio_con_iva, 'descuento', i.descuento_pedido,
               'pct', round(i.descuento_pedido * 100 / nullif(i.cantidad * i.precio_con_iva, 0), 2)
           ) ORDER BY i.id),
           sum(i.descuento_pedido)
      INTO v_renglones, v_total
      FROM public.dist_pedido_items i
     WHERE i.pedido_id = p_pedido AND i.descuento_estado = 'pendiente';

    -- Nada que pedir: si había una solicitud abierta, se retira.
    IF v_renglones IS NULL THEN
        UPDATE public.approval_requests SET status = 'CANCELLED', updated_at = now()
         WHERE type = 'DIST_DESCUENTO' AND status = 'PENDING' AND metadata->>'pedido_id' = p_pedido::text;
        UPDATE public.dist_pedidos SET descuento_solicitud_id = NULL WHERE id = p_pedido;
        RETURN NULL;
    END IF;

    SELECT nombre INTO v_cliente FROM public.dist_clientes WHERE id = v_pedido.cliente_id;
    SELECT descuento_max_pct INTO v_tope FROM public.dist_emisores WHERE id = v_pedido.emisor_id;

    SELECT id INTO v_id FROM public.approval_requests
     WHERE type = 'DIST_DESCUENTO' AND status = 'PENDING' AND metadata->>'pedido_id' = p_pedido::text
     FOR UPDATE;
    IF v_id IS NOT NULL THEN
        -- La venta cambió mientras esperaba: la solicitud dice lo de AHORA.
        UPDATE public.approval_requests
           SET metadata = metadata || jsonb_build_object('renglones', v_renglones, 'total', v_total, 'cliente', v_cliente),
               note = coalesce(nullif(btrim(p_nota), ''), note), updated_at = now()
         WHERE id = v_id;
        UPDATE public.dist_pedidos SET descuento_solicitud_id = v_id WHERE id = p_pedido;
        RETURN v_id;
    END IF;

    -- Sin `approver_id` a propósito: ver el encabezado.
    INSERT INTO public.approval_requests (employee_id, type, status, note, metadata)
    VALUES (v_yo, 'DIST_DESCUENTO', 'PENDING', nullif(btrim(p_nota), ''),
            jsonb_build_object('pedido_id', p_pedido, 'cliente', v_cliente,
                               'renglones', v_renglones, 'total', v_total, 'tope_pct', v_tope))
    RETURNING id INTO v_id;
    UPDATE public.dist_pedidos SET descuento_solicitud_id = v_id WHERE id = p_pedido;

    -- El aviso: a todos los que pueden decidirla, menos a quien la pidió.
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.id <> v_yo
       AND public.puede_aprobar_modulo(e.id, 'requests_distribucion');
    -- Con UN solo aprobador, la ficha nombra a esa persona (así lo decide la
    -- bandeja: `areaQueDecide`); sin `approver_id` decía «Sin asignar». Va en
    -- un UPDATE y no en el INSERT para que `notificar_solicitud_creada` (AFTER
    -- INSERT) no mande un segundo aviso con la clave cruda como rótulo.
    IF array_length(v_dest, 1) = 1 THEN
        UPDATE public.approval_requests SET approver_id = v_dest[1] WHERE id = v_id;
    END IF;
    IF v_dest IS NOT NULL THEN
        SELECT name INTO v_quien FROM public.employees WHERE id = v_yo;
        v_titulo := 'Descuento por aprobar';
        v_cuerpo := coalesce(v_quien, 'Un vendedor') || ' pide un descuento de $'
                 || to_char(v_total, 'FM999,999,990.00') || ' para ' || coalesce(v_cliente, 'un cliente')
                 || ' (venta ' || p_pedido || ').'
                 || coalesce(' — ' || left(nullif(btrim(p_nota), ''), 140), '');
        v_link := '/requests?solicitud=' || v_id;
        INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, created_by)
        SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', v_id, 'request_type', 'DIST_DESCUENTO'), v_yo
          FROM unnest(v_dest) d;
        PERFORM net.http_post(
            url := public.push_function_url(), headers := public.push_function_headers(),
            body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                       'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));
    END IF;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_pedir_descuento(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_pedir_descuento(bigint, text) TO authenticated, service_role;

-- ── 6 · Decidir: aprobar aplica, rechazar deja el renglón como estaba ──────
CREATE OR REPLACE FUNCTION public.dist_resolver_descuento(p_solicitud uuid, p_aprobar boolean, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo      uuid := public.auth_employee_id();
    v_sol     public.approval_requests%ROWTYPE;
    v_pedido  bigint;
    v_estado  text;
    v_n       integer;
    v_titulo  text;
    v_cuerpo  text;
BEGIN
    IF v_yo IS NULL OR NOT public.puede_aprobar_modulo(v_yo, 'requests_distribucion') THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes decidir descuentos de Distribución';
    END IF;
    SELECT * INTO v_sol FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
    IF NOT FOUND OR v_sol.type <> 'DIST_DESCUENTO' THEN RAISE EXCEPTION 'no existe esa solicitud de descuento'; END IF;
    IF v_sol.status <> 'PENDING' THEN RAISE EXCEPTION 'DIST_SOLICITUD_RESUELTA: esa solicitud ya está resuelta'; END IF;
    -- Una firma que puede ser de quien pide no es una firma.
    IF v_sol.employee_id = v_yo THEN
        RAISE EXCEPTION 'DIST_AUTOAPROBAR: no puedes decidir un descuento que pediste tú';
    END IF;
    IF NOT p_aprobar AND nullif(btrim(coalesce(p_nota, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Una solicitud se rechaza con motivo: escribe por qué.';
    END IF;

    v_pedido := (v_sol.metadata->>'pedido_id')::bigint;
    SELECT estado INTO v_estado FROM public.dist_pedidos WHERE id = v_pedido FOR UPDATE;
    IF v_estado IS DISTINCT FROM 'confirmado' THEN
        RAISE EXCEPTION 'DIST_PEDIDO_CERRADO: la venta ya está %', coalesce(v_estado, 'borrada');
    END IF;

    PERFORM set_config('dist.resolviendo_descuento', 'on', true);
    IF p_aprobar THEN
        UPDATE public.dist_pedido_items
           SET descuento = descuento_pedido, descuento_estado = 'aplicado', descuento_pedido = NULL
         WHERE pedido_id = v_pedido AND descuento_estado = 'pendiente';
    ELSE
        -- Rechazado: el renglón sigue sin descuento, y se ve que se pidió.
        UPDATE public.dist_pedido_items
           SET descuento = 0, descuento_pct = NULL, descuento_estado = 'rechazado'
         WHERE pedido_id = v_pedido AND descuento_estado = 'pendiente';
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('dist.resolviendo_descuento', 'off', true);

    UPDATE public.approval_requests
       SET status = CASE WHEN p_aprobar THEN 'APPROVED' ELSE 'REJECTED' END,
           approver_note = nullif(btrim(coalesce(p_nota, '')), ''), updated_at = now()
     WHERE id = p_solicitud;
    UPDATE public.dist_pedidos SET descuento_solicitud_id = NULL WHERE id = v_pedido;

    v_titulo := CASE WHEN p_aprobar THEN 'Descuento aprobado' ELSE 'Descuento rechazado' END;
    v_cuerpo := 'Venta ' || v_pedido || ' de ' || coalesce(v_sol.metadata->>'cliente', 'un cliente')
             || CASE WHEN p_aprobar THEN ': ya se puede facturar con el descuento.'
                     ELSE ': queda sin el descuento. ' || btrim(p_nota) END;
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, created_by)
    VALUES (v_sol.employee_id, 'REQUEST_DECIDED', v_titulo, v_cuerpo, '/distribucion/venta/' || v_pedido,
            jsonb_build_object('request_id', p_solicitud, 'request_type', 'DIST_DESCUENTO', 'pedido_id', v_pedido), v_yo);
    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', '/distribucion/venta/' || v_pedido,
                                   'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[v_sol.employee_id])));

    RETURN json_build_object('pedido_id', v_pedido, 'renglones', v_n, 'aprobado', p_aprobar);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_resolver_descuento(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_resolver_descuento(uuid, boolean, text) TO authenticated, service_role;
