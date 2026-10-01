-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0017 — devoluciones parciales con Nota de Crédito
-- ═══════════════════════════════════════════════════════════════════════════
-- Hasta hoy una devolución sólo se resolvía anulando el documento entero. La
-- tienda devuelve dos cajas dañadas de veinte y había que deshacer la venta.
--
-- ── Qué documento, según el que se emitió ────────────────────────────────
-- La Nota de Crédito (05) corrige un Crédito Fiscal: es la única que la ley
-- permite. A una Factura (01) no se le hace nota: se anula y se emite otra con
-- lo que el cliente se quedó (eso ya existe: «Corregir» en el documento). La
-- base lo exige: sólo un 03 SELLADO y sin invalidación en curso.
--
-- ── Cuánto se puede devolver ────────────────────────────────────────────
-- Por renglón Y POR LOTE: lo que salió de ese lote con ese documento
-- (`dist_lote_asignaciones`) menos lo ya devuelto en otras notas vivas. Una
-- devolución a medio emitir (preparada, sin nota) cuenta durante 15 minutos
-- para que dos personas no devuelvan lo mismo a la vez; después se limpia.
--
-- ── Qué pasa con la mercadería ───────────────────────────────────────────
--   · reingreso  → vuelve al MISMO lote, vendible.
--   · cuarentena → no vuelve a la existencia: queda en `dist_cuarentena`
--     hasta que alguien decida (destruir, devolver al proveedor, reingresar).
-- En la utilidad, lo que reingresa descuenta venta Y costo; lo que va a
-- cuarentena descuenta la venta y el costo se queda: es una pérdida, y
-- esconderla sería inflar el margen.
--
-- ── Qué pasa con la cuenta del cliente ───────────────────────────────────
-- Si el Crédito Fiscal se fió y todavía se debe, la nota se ACREDITA a esa
-- cuenta (`dist_cxc.acreditado`), hasta su saldo. Lo que sobra —se devolvió
-- algo ya pagado— queda en `a_favor` y la pantalla dice cuánto hay que
-- devolverle al cliente.
--
-- ── Si la nota se invalida o se descarta ─────────────────────────────────
-- Se deshace todo: la mercadería que reingresó vuelve a salir (hasta lo que
-- haya), la de cuarentena se da por anulada y la cuenta recupera su saldo. Un
-- RECHAZO de Hacienda no deshace nada: se corrige y se reenvía (misma regla
-- que la venta, decisión del usuario 2026-09-29).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dist_devoluciones (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id        smallint NOT NULL REFERENCES public.dist_emisores(id),
    cliente_id       bigint NOT NULL REFERENCES public.dist_clientes(id),
    dte_origen_id    bigint NOT NULL REFERENCES public.dist_dte(id),
    nota_id          bigint UNIQUE REFERENCES public.dist_dte(id),
    client_uuid      uuid NOT NULL UNIQUE,
    motivo           text NOT NULL CHECK (btrim(motivo) <> ''),
    estado           text NOT NULL DEFAULT 'preparada' CHECK (estado IN ('preparada', 'emitida', 'anulada')),
    total            numeric(12,2),
    cxc_id           bigint REFERENCES public.dist_cxc(id),
    credito_aplicado numeric(12,2) NOT NULL DEFAULT 0 CHECK (credito_aplicado >= 0),
    a_favor          numeric(12,2) NOT NULL DEFAULT 0 CHECK (a_favor >= 0),
    creado_por       uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    emitida_at       timestamptz,
    anulada_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dist_devoluciones_origen ON public.dist_devoluciones (dte_origen_id);
CREATE INDEX IF NOT EXISTS dist_devoluciones_cliente ON public.dist_devoluciones (cliente_id);
CREATE INDEX IF NOT EXISTS dist_devoluciones_cxc ON public.dist_devoluciones (cxc_id) WHERE cxc_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dist_devolucion_items (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    devolucion_id   bigint NOT NULL REFERENCES public.dist_devoluciones(id) ON DELETE CASCADE,
    item_id         bigint NOT NULL REFERENCES public.dist_pedido_items(id),
    product_id      integer NOT NULL REFERENCES public.products(id),
    lote_id         bigint REFERENCES public.dist_lotes(id),
    unidades        integer NOT NULL CHECK (unidades > 0),
    precio_unitario numeric(14,6) NOT NULL CHECK (precio_unitario >= 0),   -- con IVA, por unidad
    descuento       numeric(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0), -- con IVA, del renglón devuelto
    destino         text NOT NULL CHECK (destino IN ('reingreso', 'cuarentena')),
    costo_unitario  numeric(14,6),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dist_devolucion_items_devolucion ON public.dist_devolucion_items (devolucion_id);
CREATE INDEX IF NOT EXISTS dist_devolucion_items_item ON public.dist_devolucion_items (item_id);
CREATE INDEX IF NOT EXISTS dist_devolucion_items_producto ON public.dist_devolucion_items (product_id);
CREATE INDEX IF NOT EXISTS dist_devolucion_items_lote ON public.dist_devolucion_items (lote_id) WHERE lote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dist_cuarentena (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id      smallint NOT NULL REFERENCES public.dist_emisores(id),
    product_id     integer NOT NULL REFERENCES public.products(id),
    lote_id        bigint REFERENCES public.dist_lotes(id),
    unidades       integer NOT NULL CHECK (unidades > 0),
    devolucion_id  bigint REFERENCES public.dist_devoluciones(id),
    motivo         text NOT NULL,
    estado         text NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'destruida', 'devuelta_proveedor', 'reingresada', 'anulada')),
    nota           text,
    resuelta_por   uuid REFERENCES public.employees(id),
    resuelta_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_cuarentena_resuelta CHECK (estado IN ('pendiente', 'anulada') OR resuelta_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS dist_cuarentena_pendiente ON public.dist_cuarentena (emisor_id) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS dist_cuarentena_producto ON public.dist_cuarentena (product_id);
CREATE INDEX IF NOT EXISTS dist_cuarentena_lote ON public.dist_cuarentena (lote_id) WHERE lote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dist_cuarentena_devolucion ON public.dist_cuarentena (devolucion_id) WHERE devolucion_id IS NOT NULL;

ALTER TABLE public.dist_devoluciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_devolucion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_cuarentena ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['dist_devoluciones', 'dist_devolucion_items', 'dist_cuarentena'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission(''distribucion'', ''can_view'')))', t || '_select', t);
    END LOOP;
END $$;
REVOKE ALL ON public.dist_devoluciones, public.dist_devolucion_items, public.dist_cuarentena FROM anon, authenticated;
GRANT SELECT ON public.dist_devoluciones, public.dist_devolucion_items, public.dist_cuarentena TO authenticated;
GRANT ALL ON public.dist_devoluciones, public.dist_devolucion_items, public.dist_cuarentena TO service_role;

-- ── La cuenta por cobrar: lo acreditado por notas ─────────────────────────
ALTER TABLE public.dist_cxc ADD COLUMN IF NOT EXISTS acreditado numeric(12,2) NOT NULL DEFAULT 0 CHECK (acreditado >= 0);
DO $$
BEGIN
    IF pg_get_expr((SELECT adbin FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                     WHERE d.adrelid = 'public.dist_cxc'::regclass AND a.attname = 'saldo'), 'public.dist_cxc'::regclass) NOT LIKE '%acreditado%' THEN
        ALTER TABLE public.dist_cxc DROP COLUMN saldo;
        ALTER TABLE public.dist_cxc ADD COLUMN saldo numeric(12,2) GENERATED ALWAYS AS (monto - abonado - acreditado) STORED;
        ALTER TABLE public.dist_cxc DROP CONSTRAINT IF EXISTS dist_cxc_sin_sobrepago;
        ALTER TABLE public.dist_cxc ADD CONSTRAINT dist_cxc_sin_sobrepago CHECK (abonado + acreditado <= monto);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.dist_cxc_recalcular(p_cxc bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_abonado numeric; v_acreditado numeric;
BEGIN
    SELECT coalesce(sum(a.monto), 0) INTO v_abonado
      FROM public.dist_cxc_abonos a JOIN public.dist_recibos r ON r.id = a.recibo_id
     WHERE a.cxc_id = p_cxc AND r.anulado_at IS NULL;
    SELECT coalesce(sum(credito_aplicado), 0) INTO v_acreditado
      FROM public.dist_devoluciones WHERE cxc_id = p_cxc AND estado = 'emitida';
    UPDATE public.dist_cxc
       SET abonado = v_abonado, acreditado = v_acreditado,
           estado = CASE WHEN estado = 'anulada' THEN 'anulada' WHEN v_abonado + v_acreditado >= monto THEN 'pagada' ELSE 'abierta' END,
           pagada_at = CASE WHEN estado <> 'anulada' AND v_abonado + v_acreditado >= monto THEN coalesce(pagada_at, now()) ELSE NULL END
     WHERE id = p_cxc;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cxc_recalcular(bigint) FROM PUBLIC, anon, authenticated;

-- ── Qué se puede devolver de un documento ─────────────────────────────────
-- Por renglón y lote. Un renglón sin asignaciones (datos anteriores a los
-- lotes) sale con lote NULL y todas sus unidades.
CREATE OR REPLACE FUNCTION public.dist_devolucion_disponible(p_dte bigint)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
DECLARE d record; v_items json; v_motivo text;
BEGIN
    SELECT x.id, x.tipo, x.estado, x.numero_control, x.fec_emi, x.pedido_id, x.cliente_id, x.total_pagar, x.invalidacion_estado, c.nombre AS cliente
      INTO d FROM public.dist_dte x JOIN public.dist_clientes c ON c.id = x.cliente_id WHERE x.id = p_dte;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_DEVOLUCION: no existe ese documento'; END IF;
    v_motivo := CASE
        WHEN d.tipo = '01' THEN 'A una Factura no se le hace Nota de Crédito: para una devolución se corrige el documento (se anula y se emite otro con lo que el cliente se quedó).'
        WHEN d.tipo <> '03' THEN 'Sólo un Crédito Fiscal admite Nota de Crédito.'
        WHEN d.estado <> 'sellado' THEN 'El Crédito Fiscal tiene que estar sellado por Hacienda antes de hacerle una nota.'
        WHEN d.invalidacion_estado IN ('pendiente', 'procesada') THEN 'El documento tiene una invalidación en curso.'
    END;
    WITH vendidas AS (
        SELECT i.id AS item_id, i.product_id, i.descripcion, i.presentacion, a.lote_id,
               coalesce(sum(a.unidades), max(i.cantidad * greatest(coalesce(i.unidades, 1), 1)))::integer AS vendidas,
               i.precio_con_iva / greatest(coalesce(i.unidades, 1), 1) AS precio_unitario,
               CASE WHEN i.cantidad > 0 THEN i.descuento / (i.cantidad * greatest(coalesce(i.unidades, 1), 1)) ELSE 0 END AS descuento_unitario
          FROM public.dist_pedido_items i
          LEFT JOIN public.dist_lote_asignaciones a ON a.item_id = i.id AND a.dte_id = p_dte AND a.devuelta_at IS NULL
         WHERE i.pedido_id = d.pedido_id
         GROUP BY i.id, a.lote_id
    ),
    devueltas AS (
        SELECT di.item_id, di.lote_id, sum(di.unidades)::integer AS devueltas
          FROM public.dist_devolucion_items di JOIN public.dist_devoluciones dv ON dv.id = di.devolucion_id
         WHERE dv.dte_origen_id = p_dte
           AND (dv.estado = 'emitida' OR (dv.estado = 'preparada' AND dv.created_at > now() - interval '15 minutes'))
         GROUP BY di.item_id, di.lote_id
    )
    SELECT coalesce(json_agg(json_build_object(
            'item_id', v.item_id, 'product_id', v.product_id, 'descripcion', v.descripcion, 'presentacion', v.presentacion,
            'lote_id', v.lote_id, 'lote', l.lote, 'vence', l.vence,
            'vendidas', v.vendidas, 'devueltas', coalesce(dv.devueltas, 0),
            'disponibles', greatest(0, v.vendidas - coalesce(dv.devueltas, 0)),
            'precio_unitario', round(v.precio_unitario, 6), 'descuento_unitario', round(v.descuento_unitario, 6))
          ORDER BY v.item_id, l.vence NULLS LAST), '[]'::json)
      INTO v_items
      FROM vendidas v
      LEFT JOIN public.dist_lotes l ON l.id = v.lote_id
      LEFT JOIN devueltas dv ON dv.item_id = v.item_id AND dv.lote_id IS NOT DISTINCT FROM v.lote_id;
    RETURN json_build_object(
        'documento', json_build_object('id', d.id, 'tipo', d.tipo, 'numero_control', d.numero_control, 'fec_emi', d.fec_emi,
                                       'cliente', d.cliente, 'total', d.total_pagar),
        'puede', v_motivo IS NULL, 'motivo', v_motivo, 'items', v_items,
        'notas', (SELECT coalesce(json_agg(json_build_object('id', dv.id, 'nota_id', dv.nota_id, 'total', dv.total,
                                   'motivo', dv.motivo, 'fecha', dv.emitida_at, 'a_favor', dv.a_favor, 'credito_aplicado', dv.credito_aplicado)
                                   ORDER BY dv.id), '[]'::json)
                    FROM public.dist_devoluciones dv WHERE dv.dte_origen_id = p_dte AND dv.estado = 'emitida'));
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_devolucion_disponible(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_devolucion_disponible(bigint) TO authenticated, service_role;

-- ── Preparar: valida y aparta, sin tocar inventario todavía ───────────────
-- `p_renglones`: [{ item_id, lote_id|null, unidades, destino }]. Devuelve lo
-- que la edge function necesita para armar la nota.
CREATE OR REPLACE FUNCTION public.dist_preparar_devolucion(p_dte bigint, p_client_uuid uuid, p_motivo text, p_renglones jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    d       record;
    v_disp  json;
    v_id    bigint;
    v_prev  record;
    r       jsonb;
    x       json;
    v_n     integer := 0;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no tienes permiso para registrar devoluciones';
    END IF;
    IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'DIST_DEVOLUCION_MOTIVO: escribe por qué devuelve el cliente'; END IF;
    -- Un reintento con el mismo identificador: si ya se emitió, es ésa.
    SELECT id, estado, nota_id INTO v_prev FROM public.dist_devoluciones WHERE client_uuid = p_client_uuid;
    IF FOUND AND v_prev.estado = 'emitida' THEN
        RETURN json_build_object('devolucion_id', v_prev.id, 'nota_id', v_prev.nota_id, 'ya_emitida', true);
    END IF;
    -- El documento se bloquea: dos devoluciones a la vez no pueden pasar de lo vendido.
    SELECT * INTO d FROM public.dist_dte WHERE id = p_dte FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_DEVOLUCION: no existe ese documento'; END IF;
    DELETE FROM public.dist_devoluciones WHERE dte_origen_id = p_dte AND estado = 'preparada'
       AND (client_uuid = p_client_uuid OR created_at <= now() - interval '15 minutes');
    v_disp := public.dist_devolucion_disponible(p_dte);
    IF NOT (v_disp->>'puede')::boolean THEN RAISE EXCEPTION 'DIST_DEVOLUCION_NO: %', v_disp->>'motivo'; END IF;
    IF jsonb_array_length(coalesce(p_renglones, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'DIST_DEVOLUCION_VACIA: elige qué productos devuelve';
    END IF;

    INSERT INTO public.dist_devoluciones (emisor_id, cliente_id, dte_origen_id, client_uuid, motivo)
    VALUES (d.emisor_id, d.cliente_id, p_dte, p_client_uuid, btrim(p_motivo)) RETURNING id INTO v_id;

    FOR r IN SELECT * FROM jsonb_array_elements(p_renglones) LOOP
        IF coalesce((r->>'unidades')::integer, 0) <= 0 THEN CONTINUE; END IF;
        IF r->>'destino' NOT IN ('reingreso', 'cuarentena') THEN
            RAISE EXCEPTION 'DIST_DEVOLUCION_DESTINO: cada producto va a bodega o a cuarentena';
        END IF;
        SELECT e INTO x FROM json_array_elements(v_disp->'items') e
         WHERE (e->>'item_id')::bigint = (r->>'item_id')::bigint
           AND (e->>'lote_id') IS NOT DISTINCT FROM nullif(r->>'lote_id', '');
        IF x IS NULL THEN RAISE EXCEPTION 'DIST_DEVOLUCION_RENGLON: ese producto no salió con este documento'; END IF;
        IF (r->>'unidades')::integer > (x->>'disponibles')::integer THEN
            RAISE EXCEPTION 'DIST_DEVOLUCION_EXCESO: de «%»% sólo se pueden devolver % unidades',
                x->>'descripcion', CASE WHEN x->>'lote' IS NULL THEN '' ELSE ' (lote ' || (x->>'lote') || ')' END, x->>'disponibles';
        END IF;
        INSERT INTO public.dist_devolucion_items (devolucion_id, item_id, product_id, lote_id, unidades, precio_unitario, descuento, destino, costo_unitario)
        SELECT v_id, (x->>'item_id')::bigint, (x->>'product_id')::integer, nullif(x->>'lote_id', '')::bigint, (r->>'unidades')::integer,
               (x->>'precio_unitario')::numeric, round((x->>'descuento_unitario')::numeric * (r->>'unidades')::integer, 2), r->>'destino',
               -- El costo con el que salió (el de la asignación); si no hay, el promedio de hoy.
               coalesce((SELECT sum(a.unidades * a.costo_unitario) / nullif(sum(a.unidades), 0) FROM public.dist_lote_asignaciones a
                          WHERE a.item_id = (x->>'item_id')::bigint AND a.dte_id = p_dte AND a.costo_unitario IS NOT NULL
                            AND a.lote_id IS NOT DISTINCT FROM nullif(x->>'lote_id', '')::bigint),
                        (SELECT costo_promedio FROM public.dist_catalogo WHERE emisor_id = d.emisor_id AND product_id = (x->>'product_id')::integer));
        v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN RAISE EXCEPTION 'DIST_DEVOLUCION_VACIA: elige qué productos devuelve'; END IF;

    RETURN json_build_object(
        'devolucion_id', v_id, 'ya_emitida', false,
        'origen', json_build_object('id', d.id, 'codigo_generacion', d.codigo_generacion, 'fec_emi', d.fec_emi,
                                    'cliente_id', d.cliente_id, 'emisor_id', d.emisor_id, 'ambiente', d.ambiente,
                                    'condicion', coalesce((d.json->'resumen'->>'condicionOperacion')::integer, 1)),
        'renglones', (SELECT json_agg(json_build_object('id', di.id, 'product_id', di.product_id, 'descripcion', i.descripcion,
                                        'unidades', di.unidades, 'precio_unitario', di.precio_unitario, 'descuento', di.descuento) ORDER BY di.id)
                        FROM public.dist_devolucion_items di JOIN public.dist_pedido_items i ON i.id = di.item_id
                       WHERE di.devolucion_id = v_id));
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_preparar_devolucion(bigint, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_preparar_devolucion(bigint, uuid, text, jsonb) TO authenticated, service_role;

-- ── Aplicar: la nota ya existe; se mueve inventario y cuenta ──────────────
-- Sólo la llama la edge function (service_role), justo después de guardar la nota.
CREATE OR REPLACE FUNCTION public.dist_aplicar_devolucion(p_devolucion bigint, p_nota bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    dv      public.dist_devoluciones%ROWTYPE;
    it      record;
    v_lote  bigint;
    v_mov   bigint;
    v_total numeric;
    c       record;
    v_cred  numeric := 0;
BEGIN
    SELECT * INTO dv FROM public.dist_devoluciones WHERE id = p_devolucion FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'no existe la devolución %', p_devolucion; END IF;
    IF dv.estado = 'emitida' THEN
        RETURN json_build_object('devolucion_id', dv.id, 'credito_aplicado', dv.credito_aplicado, 'a_favor', dv.a_favor);
    END IF;
    SELECT total_pagar INTO v_total FROM public.dist_dte WHERE id = p_nota AND tipo = '05' AND relacionado_id = dv.dte_origen_id;
    IF v_total IS NULL THEN RAISE EXCEPTION 'la nota % no corresponde a esta devolución', p_nota; END IF;

    FOR it IN SELECT di.*, p.nombre FROM public.dist_devolucion_items di LEFT JOIN public.products p ON p.id = di.product_id
               WHERE di.devolucion_id = dv.id ORDER BY di.id LOOP
        -- Sin lote (venta anterior a los lotes): al lote vivo que vence más tarde.
        v_lote := coalesce(it.lote_id, (SELECT id FROM public.dist_lotes WHERE emisor_id = dv.emisor_id AND product_id = it.product_id
                                          ORDER BY vence DESC NULLS LAST, id DESC LIMIT 1));
        IF it.destino = 'reingreso' AND v_lote IS NOT NULL THEN
            PERFORM public.dist_mover_lote(v_lote, it.unidades, 'devolucion', NULL, p_nota, format('Nota de crédito · %s', dv.motivo));
            SELECT max(id) INTO v_mov FROM public.dist_lote_movimientos WHERE lote_id = v_lote AND tipo = 'devolucion' AND dte_id = p_nota;
            UPDATE public.dist_lote_movimientos SET costo_unitario = coalesce(it.costo_unitario, costo_unitario), creado_por = dv.creado_por WHERE id = v_mov;
        ELSE
            INSERT INTO public.dist_cuarentena (emisor_id, product_id, lote_id, unidades, devolucion_id, motivo)
            VALUES (dv.emisor_id, it.product_id, v_lote, it.unidades, dv.id, dv.motivo);
            IF it.destino = 'reingreso' THEN   -- no había lote al cual volver
                UPDATE public.dist_devolucion_items SET destino = 'cuarentena' WHERE id = it.id;
            END IF;
        END IF;
    END LOOP;

    -- A la cuenta del Crédito Fiscal, si se fió y se debe.
    SELECT id, saldo INTO c FROM public.dist_cxc WHERE dte_id = dv.dte_origen_id AND estado = 'abierta' FOR UPDATE;
    IF FOUND THEN v_cred := least(v_total, c.saldo); END IF;
    UPDATE public.dist_devoluciones
       SET nota_id = p_nota, estado = 'emitida', emitida_at = now(), total = v_total,
           cxc_id = CASE WHEN v_cred > 0 THEN c.id END, credito_aplicado = v_cred, a_favor = round(v_total - v_cred, 2)
     WHERE id = dv.id;
    IF v_cred > 0 THEN PERFORM public.dist_cxc_recalcular(c.id); END IF;
    RETURN json_build_object('devolucion_id', dv.id, 'credito_aplicado', v_cred, 'a_favor', round(v_total - v_cred, 2));
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_aplicar_devolucion(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_aplicar_devolucion(bigint, bigint) TO service_role;

-- ── Si la nota se invalida o se descarta, se deshace ──────────────────────
CREATE OR REPLACE FUNCTION public.dist_devolucion_al_anular_nota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE dv record; it record; v_hay integer; v_saca integer;
BEGIN
    IF NEW.tipo <> '05' OR NEW.estado NOT IN ('invalidado', 'descartado') OR OLD.estado IS NOT DISTINCT FROM NEW.estado THEN
        RETURN NEW;
    END IF;
    SELECT * INTO dv FROM public.dist_devoluciones WHERE nota_id = NEW.id AND estado = 'emitida' FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    FOR it IN SELECT m.lote_id, m.cantidad FROM public.dist_lote_movimientos m
               WHERE m.dte_id = NEW.id AND m.tipo = 'devolucion' LOOP
        SELECT existencia INTO v_hay FROM public.dist_lotes WHERE id = it.lote_id FOR UPDATE;
        v_saca := least(it.cantidad, greatest(v_hay, 0));
        IF v_saca > 0 THEN
            PERFORM public.dist_mover_lote(it.lote_id, -v_saca, 'ajuste', NULL, NEW.id,
                format('Se anuló la nota de crédito%s', CASE WHEN v_saca < it.cantidad THEN format(' (faltaban %s unidades: ya se habían vendido)', it.cantidad - v_saca) ELSE '' END));
        END IF;
    END LOOP;
    UPDATE public.dist_cuarentena SET estado = 'anulada' WHERE devolucion_id = dv.id AND estado = 'pendiente';
    UPDATE public.dist_devoluciones SET estado = 'anulada', anulada_at = now() WHERE id = dv.id;
    IF dv.cxc_id IS NOT NULL THEN PERFORM public.dist_cxc_recalcular(dv.cxc_id); END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_devolucion_al_anular_nota() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dist_devolucion_al_anular_nota ON public.dist_dte;
CREATE TRIGGER dist_devolucion_al_anular_nota AFTER UPDATE OF estado ON public.dist_dte
    FOR EACH ROW EXECUTE FUNCTION public.dist_devolucion_al_anular_nota();

-- ── Cuarentena: decidir qué se hace con lo devuelto ──────────────────────
CREATE OR REPLACE FUNCTION public.dist_resolver_cuarentena(p_id bigint, p_estado text, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE q public.dist_cuarentena%ROWTYPE; v_yo uuid := public.auth_employee_id();
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: la cuarentena la resuelve quien administra la distribuidora';
    END IF;
    IF p_estado NOT IN ('destruida', 'devuelta_proveedor', 'reingresada') THEN
        RAISE EXCEPTION 'DIST_CUARENTENA: elige destruir, devolver al proveedor o reingresar';
    END IF;
    SELECT * INTO q FROM public.dist_cuarentena WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR q.estado <> 'pendiente' THEN RAISE EXCEPTION 'DIST_CUARENTENA: ya se resolvió'; END IF;
    IF p_estado = 'reingresada' THEN
        IF q.lote_id IS NULL THEN RAISE EXCEPTION 'DIST_CUARENTENA: no hay lote al cual reingresarla'; END IF;
        IF (SELECT vence FROM public.dist_lotes WHERE id = q.lote_id) <= current_date THEN
            RAISE EXCEPTION 'DIST_CUARENTENA: el lote está vencido: no se puede volver a vender';
        END IF;
        PERFORM public.dist_mover_lote(q.lote_id, q.unidades, 'devolucion', NULL, NULL,
            format('Sale de cuarentena%s', coalesce(': ' || nullif(btrim(p_nota), ''), '')));
    END IF;
    UPDATE public.dist_cuarentena SET estado = p_estado, nota = nullif(btrim(coalesce(p_nota, '')), ''),
           resuelta_por = v_yo, resuelta_at = now() WHERE id = p_id;
    RETURN json_build_object('id', p_id, 'estado', p_estado);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_resolver_cuarentena(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_resolver_cuarentena(bigint, text, text) TO authenticated, service_role;

-- ── La utilidad resta lo devuelto ──────────────────────────────────────────
-- Misma función de 0016 con un segundo origen de renglones: las devoluciones
-- emitidas en el período (por la fecha de la NOTA), con unidades y venta en
-- negativo. Lo que reingresa lleva su costo (se resta); lo de cuarentena lleva
-- costo 0 (el costo de lo vendido se queda: es pérdida).
CREATE OR REPLACE FUNCTION public.dist_utilidad(p_desde date, p_hasta date, p_ruta text DEFAULT NULL, p_vendedor uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v_res json;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: la utilidad la ve quien administra la distribuidora';
    END IF;
    WITH ventas AS (
        SELECT d.id AS dte_id, d.fec_emi AS fecha, p.id AS pedido_id, p.emisor_id, p.vendedor_id,
               c.id AS cliente_id, c.nombre AS cliente, coalesce(c.ruta, 'Sin ruta') AS ruta
          FROM public.dist_dte d
          JOIN public.dist_pedidos p ON p.id = d.pedido_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
         WHERE d.tipo IN ('01', '03')
           AND d.estado NOT IN ('descartado', 'invalidado', 'rechazado')
           AND d.fec_emi BETWEEN p_desde AND p_hasta
           AND (p_ruta IS NULL OR coalesce(c.ruta, 'Sin ruta') = p_ruta)
           AND (p_vendedor IS NULL OR p.vendedor_id = p_vendedor)
    ),
    asig AS (
        SELECT a.item_id, sum(a.unidades * a.costo_unitario) / nullif(sum(a.unidades), 0) AS costo
          FROM public.dist_lote_asignaciones a
         WHERE a.devuelta_at IS NULL AND a.costo_unitario IS NOT NULL
           AND a.pedido_id IN (SELECT pedido_id FROM ventas)
         GROUP BY a.item_id
    ),
    devoluciones AS (
        SELECT n.id AS dte_id, n.fec_emi AS fecha, p.id AS pedido_id, p.emisor_id, p.vendedor_id,
               c.id AS cliente_id, c.nombre AS cliente, coalesce(c.ruta, 'Sin ruta') AS ruta,
               di.product_id, pr.nombre AS producto,
               -di.unidades::numeric AS unidades,
               -(di.unidades * di.precio_unitario - di.descuento) / 1.13 AS venta,
               CASE WHEN di.destino = 'reingreso' THEN coalesce(di.costo_unitario, cat.costo_promedio) ELSE 0 END AS costo_u,
               false AS estimado
          FROM public.dist_devoluciones dv
          JOIN public.dist_dte n ON n.id = dv.nota_id AND n.estado NOT IN ('descartado', 'invalidado')
          JOIN public.dist_dte o ON o.id = dv.dte_origen_id
          JOIN public.dist_pedidos p ON p.id = o.pedido_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
          JOIN public.dist_devolucion_items di ON di.devolucion_id = dv.id
          LEFT JOIN public.products pr ON pr.id = di.product_id
          LEFT JOIN public.dist_catalogo cat ON cat.emisor_id = p.emisor_id AND cat.product_id = di.product_id
         WHERE dv.estado = 'emitida' AND n.fec_emi BETWEEN p_desde AND p_hasta
           AND (p_ruta IS NULL OR coalesce(c.ruta, 'Sin ruta') = p_ruta)
           AND (p_vendedor IS NULL OR p.vendedor_id = p_vendedor)
    ),
    renglones AS (
        SELECT v.*, i.product_id, pr.nombre AS producto,
               (i.cantidad * greatest(coalesce(i.unidades, 1), 1))::numeric AS unidades,
               (round(i.cantidad * i.precio_con_iva, 2) - i.descuento) / 1.13 AS venta,
               coalesce(a.costo, cat.costo_promedio) AS costo_u,
               a.costo IS NULL AND cat.costo_promedio IS NOT NULL AS estimado
          FROM ventas v
          JOIN public.dist_pedido_items i ON i.pedido_id = v.pedido_id
          LEFT JOIN public.products pr ON pr.id = i.product_id
          LEFT JOIN asig a ON a.item_id = i.id
          LEFT JOIN public.dist_catalogo cat ON cat.emisor_id = v.emisor_id AND cat.product_id = i.product_id
        UNION ALL
        SELECT dte_id, fecha, pedido_id, emisor_id, vendedor_id, cliente_id, cliente, ruta,
               product_id, producto, unidades, venta, costo_u, estimado
          FROM devoluciones
    ),
    r AS (
        SELECT *, CASE WHEN costo_u IS NULL THEN NULL ELSE unidades * costo_u END AS costo FROM renglones
    ),
    g AS (
        SELECT 'producto' AS por, product_id::text AS clave, max(producto) AS nombre, sum(unidades) AS unidades,
               sum(venta) FILTER (WHERE costo IS NOT NULL) AS venta, sum(costo) AS costo,
               sum(venta) FILTER (WHERE costo IS NULL) AS sin_costo, bool_or(estimado) AS estimado
          FROM r GROUP BY product_id
        UNION ALL
        SELECT 'cliente', cliente_id::text, max(cliente), sum(unidades),
               sum(venta) FILTER (WHERE costo IS NOT NULL), sum(costo), sum(venta) FILTER (WHERE costo IS NULL), bool_or(estimado)
          FROM r GROUP BY cliente_id
        UNION ALL
        SELECT 'ruta', ruta, ruta, sum(unidades),
               sum(venta) FILTER (WHERE costo IS NOT NULL), sum(costo), sum(venta) FILTER (WHERE costo IS NULL), bool_or(estimado)
          FROM r GROUP BY ruta
        UNION ALL
        SELECT 'vendedor', coalesce(r.vendedor_id::text, '—'), max(e.name), sum(unidades),
               sum(venta) FILTER (WHERE costo IS NOT NULL), sum(costo), sum(venta) FILTER (WHERE costo IS NULL), bool_or(estimado)
          FROM r LEFT JOIN public.employees e ON e.id = r.vendedor_id GROUP BY r.vendedor_id
    )
    SELECT json_build_object(
        'resumen', (SELECT json_build_object(
            'venta', round(coalesce(sum(venta) FILTER (WHERE costo IS NOT NULL), 0), 2),
            'costo', round(coalesce(sum(costo), 0), 2),
            'sin_costo', round(coalesce(sum(venta) FILTER (WHERE costo IS NULL), 0), 2),
            'productos_sin_costo', count(DISTINCT product_id) FILTER (WHERE costo IS NULL),
            'estimado', round(coalesce(sum(venta) FILTER (WHERE estimado), 0), 2),
            'devuelto', round(coalesce(-(SELECT sum(venta) FROM devoluciones), 0), 2),
            'documentos', count(DISTINCT dte_id) FILTER (WHERE unidades > 0)) FROM r),
        'grupos', (SELECT coalesce(json_agg(json_build_object(
                'por', por, 'clave', clave, 'nombre', coalesce(nombre, '—'), 'unidades', unidades,
                'venta', round(coalesce(venta, 0), 2), 'costo', round(coalesce(costo, 0), 2),
                'sin_costo', round(coalesce(sin_costo, 0), 2), 'estimado', coalesce(estimado, false))
              ORDER BY coalesce(venta, 0) - coalesce(costo, 0) DESC), '[]'::json) FROM g),
        'por_dia', (SELECT coalesce(json_agg(x ORDER BY x.fecha), '[]'::json) FROM (
            SELECT fecha, round(sum(venta) FILTER (WHERE costo IS NOT NULL), 2) AS venta, round(sum(costo), 2) AS costo
              FROM r GROUP BY fecha) x)
    ) INTO v_res;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_utilidad(date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_utilidad(date, date, text, uuid) TO authenticated, service_role;
