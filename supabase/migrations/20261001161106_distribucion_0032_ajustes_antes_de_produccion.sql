-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0032 — ajustes antes de producción (auditoría 2026-10-01)
-- ═══════════════════════════════════════════════════════════════════════════
-- La auditoría de los 31 borradores contra las reglas de CLAUDE.md encontró:
--
--   1. BUG: `dist_costo_al_mover` no estampaba costo en `faltante` (0030), así
--      que el faltante del camión salía en $0 en la liquidación (0031).
--   2. REVOKE incompleto: 0001, 0003, 0004 y la vista de 0019 sólo le quitaban
--      a `anon`. En este proyecto una tabla nueva nace con TRUNCATE para
--      `authenticated` (medido en 0006), y TRUNCATE salta el RLS. Se revoca
--      todo y se vuelve a dar exactamente lo que ya se daba.
--   3. FKs sin un índice que las cubra entero (o sólo con uno parcial, que no
--      sirve para el chequeo de la FK al borrar en la tabla madre).
--   4. `dist_pedir_descuento` y `dist_resolver_descuento` llamaban al push sin
--      EXCEPTION: si el push fallaba, se caía la solicitud entera. 0012 y 0023
--      ya lo envolvían; acá igual.
--
-- Los cuerpos de las tres funciones parten de su definición VIVA.
SET lock_timeout = '5s';

-- ── 2. Privilegios: todo afuera, y de vuelta sólo lo que ya se daba ────────
REVOKE ALL ON public.dist_emisores, public.dist_clientes, public.dist_catalogo, public.dist_dte,
    public.dist_dte_intentos, public.dist_contingencias, public.dist_correlativos, public.dist_mh_token,
    public.dist_pedidos, public.dist_pedido_items, public.dist_pagos, public.dist_listas, public.dist_precios
    FROM anon, authenticated;
REVOKE ALL ON public.dist_correo_vigente FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.dist_emisores, public.dist_clientes, public.dist_catalogo, public.dist_pedidos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dist_pedido_items, public.dist_pagos, public.dist_listas, public.dist_precios TO authenticated;
GRANT SELECT ON public.dist_dte, public.dist_dte_intentos, public.dist_contingencias, public.dist_correo_vigente TO authenticated;
-- dist_correlativos y dist_mh_token: sólo el servidor (service_role), sin
-- policy a propósito — RLS encendido y ningún privilegio para authenticated.

-- ── 3. Índices de FK ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS dist_carga_items_producto  ON public.dist_carga_items (product_id);
CREATE INDEX IF NOT EXISTS dist_cargas_emisor         ON public.dist_cargas (emisor_id);
CREATE INDEX IF NOT EXISTS dist_reservas_vendedor     ON public.dist_reservas (vendedor_id);
CREATE INDEX IF NOT EXISTS dist_reservas_emisor       ON public.dist_reservas (emisor_id);
CREATE INDEX IF NOT EXISTS dist_cxc_vendedor          ON public.dist_cxc (vendedor_id);
CREATE INDEX IF NOT EXISTS dist_cxc_emisor_fk         ON public.dist_cxc (emisor_id);
CREATE INDEX IF NOT EXISTS dist_recibos_emisor_fk     ON public.dist_recibos (emisor_id);
CREATE INDEX IF NOT EXISTS dist_devoluciones_emisor   ON public.dist_devoluciones (emisor_id);
CREATE INDEX IF NOT EXISTS dist_cajas_emisor          ON public.dist_cajas (emisor_id);
CREATE INDEX IF NOT EXISTS dist_depositos_emisor      ON public.dist_depositos (emisor_id);
CREATE INDEX IF NOT EXISTS dist_cierres_dia_emisor    ON public.dist_cierres_dia (emisor_id);
CREATE INDEX IF NOT EXISTS dist_lote_asig_pedido_fk   ON public.dist_lote_asignaciones (pedido_id);
CREATE INDEX IF NOT EXISTS dist_proveedores_emisor_fk ON public.dist_proveedores (emisor_id);
CREATE INDEX IF NOT EXISTS dist_cuarentena_emisor_fk  ON public.dist_cuarentena (emisor_id);
CREATE INDEX IF NOT EXISTS dist_liquidaciones_vend_fk ON public.dist_liquidaciones (vendedor_id);
CREATE INDEX IF NOT EXISTS dist_conteos_emisor_fk     ON public.dist_conteos (emisor_id);
CREATE INDEX IF NOT EXISTS dist_bajas_emisor_fk       ON public.dist_bajas (emisor_id);
CREATE INDEX IF NOT EXISTS dist_lote_mov_creado_por   ON public.dist_lote_movimientos (creado_por);

-- ── 1. Costo en el faltante, la carga y la descarga ────────────────────────
CREATE OR REPLACE FUNCTION public.dist_costo_al_mover()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NEW.costo_unitario IS NOT NULL THEN RETURN NEW; END IF;
    -- Dos IF y no un OR: `NEW.tipo` en una asignación (que no tiene esa
    -- columna) LANZA aunque la otra mitad del OR sea verdadera — plpgsql arma
    -- la expresión entera. Así estuvo diez minutos: nada se podía facturar.
    IF TG_TABLE_NAME = 'dist_lote_movimientos' THEN
        -- 'faltante', 'carga' y 'descarga' desde 0032: sin ellos el faltante del camión
        -- se valorizaba en $0 (la liquidación lo suma desde este costo).
        IF NEW.tipo NOT IN ('venta', 'liberacion', 'devolucion', 'ajuste', 'faltante', 'carga', 'descarga') THEN RETURN NEW; END IF;
    END IF;
    BEGIN
        SELECT c.costo_promedio INTO NEW.costo_unitario
          FROM public.dist_lotes l
          JOIN public.dist_catalogo c ON c.emisor_id = l.emisor_id AND c.product_id = l.product_id
         WHERE l.id = NEW.lote_id;
    END;
    RETURN NEW;
END $function$;

-- ── 4. El push no tumba la solicitud ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_pedir_descuento(p_pedido bigint, p_nota text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
        -- La distribuidora tiene su propia entrada (`/torogoz`, 2026-09-28).
        v_link := '/torogoz/solicitudes?solicitud=' || v_id;
        INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, created_by)
        SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', v_id, 'request_type', 'DIST_DESCUENTO'), v_yo
          FROM unnest(v_dest) d;
        -- El push es un aviso: si falla, la solicitud ya quedó escrita (0032).
        BEGIN
            PERFORM net.http_post(
                url := public.push_function_url(), headers := public.push_function_headers(),
                body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                           'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'dist: push no enviado: %', SQLERRM;
        END;
    END IF;
    RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.dist_resolver_descuento(p_solicitud uuid, p_aprobar boolean, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    VALUES (v_sol.employee_id, 'REQUEST_DECIDED', v_titulo, v_cuerpo, '/torogoz/venta/' || v_pedido,
            jsonb_build_object('request_id', p_solicitud, 'request_type', 'DIST_DESCUENTO', 'pedido_id', v_pedido), v_yo);
    -- El push es un aviso: si falla, la solicitud ya quedó escrita (0032).
    BEGIN
        PERFORM net.http_post(
            url := public.push_function_url(), headers := public.push_function_headers(),
            body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', '/torogoz/venta/' || v_pedido,
                                       'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[v_sol.employee_id])));
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'dist: push no enviado: %', SQLERRM;
    END;

    RETURN json_build_object('pedido_id', v_pedido, 'renglones', v_n, 'aprobado', p_aprobar);
END $function$;

-- Lo que ya se movió sin costo (sólo existe en el entorno de pruebas).
UPDATE public.dist_lote_movimientos m SET costo_unitario = c.costo_promedio
  FROM public.dist_lotes l JOIN public.dist_catalogo c ON c.emisor_id = l.emisor_id AND c.product_id = l.product_id
 WHERE m.lote_id = l.id AND m.costo_unitario IS NULL AND m.tipo IN ('faltante', 'carga', 'descarga');
