-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0030 — autoventa desde el camión (venta mixta)
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-09-30): «si se venderá desde el camión también,
-- ¿se puede mixto?». Sí: el mismo vendedor, en la misma ruta, toma preventas
-- (bodega despacha después) y vende lo que lleva cargado.
--
-- ── El camión es una UBICACIÓN del lote ─────────────────────────────────────
-- `dist_lotes.en_camion_de` (NULL = bodega). Cargar mueve unidades del lote en
-- bodega al MISMO lote (mismo número y vencimiento) en el camión del vendedor:
-- dos filas de `dist_lotes`, dos movimientos. Se eligió así y no una tabla
-- aparte de «existencia del camión» porque todo lo que ya funciona sobre
-- lotes sigue funcionando sin saber del camión:
--   · la venta asigna por lote (dist_asignar_lotes) — sólo cambia DE DÓNDE;
--   · la reserva aparta por lote_id — el que eligió la pantalla;
--   · invalidar o anular devuelve al lote de la asignación — o sea al camión
--     si salió del camión;
--   · el kardex (dist_lote_movimientos) cuenta la carga y la descarga.
-- La existencia de la EMPRESA es la suma de las filas; la de bodega, las que
-- tienen `en_camion_de IS NULL`.
--
-- ── La ley: Nota de Remisión para circular ──────────────────────────────────
-- Código Tributario art. 109 (y 255 num. 1: circular sin CCF, factura ni NR
-- se presume comercio clandestino). La carga sale amparada por una Nota de
-- Remisión electrónica con `bienTitulo = '04'` (traslado, CAT-025), emitida
-- por `distribucion-dte` (acción `nota_remision`). Queda ligada en
-- `dist_cargas.dte_id`. Cómo llenar el receptor cuando es la misma empresa no
-- lo dice la norma: se usa el NIT propio, y se confirma en el plan de pruebas
-- de Hacienda.
--
-- ── Mixto ──────────────────────────────────────────────────────────────────
-- `dist_pedidos.desde_camion`: false (preventa: bodega) o true (autoventa: el
-- camión de quien vende). Sólo vale true si el vendedor tiene carga abierta.
--
-- ── Al volver ──────────────────────────────────────────────────────────────
-- `dist_descargar_camion` cuenta lo que quedó. Lo contado vuelve a bodega; lo
-- que falta queda como movimiento `faltante` (valorizado al costo por
-- dist_costo_al_mover) y exige nota. La carga se cierra. Una devolución que
-- llegue después a un lote del camión vuelve a la fila del camión, y la
-- siguiente descarga la recoge: la descarga es POR CAMIÓN, no por carga.
SET lock_timeout = '5s';

-- ── Ubicación del lote ─────────────────────────────────────────────────────
ALTER TABLE public.dist_lotes ADD COLUMN IF NOT EXISTS en_camion_de uuid REFERENCES public.employees(id);
CREATE INDEX IF NOT EXISTS dist_lotes_camion ON public.dist_lotes (en_camion_de) WHERE en_camion_de IS NOT NULL;
-- La clave era producto + lote; ahora producto + lote + ubicación.
DROP INDEX IF EXISTS public.dist_lotes_unico;
CREATE UNIQUE INDEX dist_lotes_unico ON public.dist_lotes
    (emisor_id, product_id, upper(btrim(lote)), coalesce(en_camion_de, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.dist_lote_movimientos DROP CONSTRAINT IF EXISTS dist_lote_movimientos_tipo_check;
ALTER TABLE public.dist_lote_movimientos ADD CONSTRAINT dist_lote_movimientos_tipo_check
    CHECK (tipo IN ('entrada','ajuste','venta','liberacion','devolucion','compra','compra_anulada','carga','descarga','faltante'));

-- ── Cargas ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dist_cargas (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id     smallint NOT NULL REFERENCES public.dist_emisores(id),
    vendedor_id   uuid NOT NULL REFERENCES public.employees(id),
    estado        text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
    dte_id        bigint REFERENCES public.dist_dte(id),
    nota          text,
    cargado_por   uuid REFERENCES public.employees(id),
    cerrada_por   uuid REFERENCES public.employees(id),
    cerrada_at    timestamptz,
    nota_cierre   text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
-- Un camión, una carga abierta.
CREATE UNIQUE INDEX IF NOT EXISTS dist_cargas_una_abierta ON public.dist_cargas (vendedor_id) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS dist_cargas_vendedor ON public.dist_cargas (vendedor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dist_cargas_dte ON public.dist_cargas (dte_id) WHERE dte_id IS NOT NULL;

-- Lo que entró al camión en cada carga, y cómo volvió. `en camión` no se
-- guarda: es la existencia de la fila del camión en dist_lotes.
CREATE TABLE IF NOT EXISTS public.dist_carga_items (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    carga_id       bigint NOT NULL REFERENCES public.dist_cargas(id),
    lote_camion_id bigint NOT NULL REFERENCES public.dist_lotes(id),
    product_id     integer NOT NULL REFERENCES public.products(id),
    cargado        integer NOT NULL DEFAULT 0 CHECK (cargado >= 0),
    devuelto       integer NOT NULL DEFAULT 0 CHECK (devuelto >= 0),
    faltante       integer NOT NULL DEFAULT 0 CHECK (faltante >= 0),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (carga_id, lote_camion_id)
);
CREATE INDEX IF NOT EXISTS dist_carga_items_lote ON public.dist_carga_items (lote_camion_id);

ALTER TABLE public.dist_cargas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_carga_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_cargas_select ON public.dist_cargas;
CREATE POLICY dist_cargas_select ON public.dist_cargas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
DROP POLICY IF EXISTS dist_carga_items_select ON public.dist_carga_items;
CREATE POLICY dist_carga_items_select ON public.dist_carga_items FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
REVOKE ALL ON public.dist_cargas, public.dist_carga_items FROM anon, authenticated;
GRANT SELECT ON public.dist_cargas, public.dist_carga_items TO authenticated;
GRANT ALL ON public.dist_cargas, public.dist_carga_items TO service_role;

-- ── Pedido: preventa o autoventa ───────────────────────────────────────────
ALTER TABLE public.dist_pedidos ADD COLUMN IF NOT EXISTS desde_camion boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.dist_validar_desde_camion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.desde_camion AND NOT EXISTS (
        SELECT 1 FROM public.dist_cargas WHERE vendedor_id = NEW.vendedor_id AND estado = 'abierta') THEN
        RAISE EXCEPTION 'DIST_SIN_CARGA: no tienes el camión cargado; véndelo como preventa';
    END IF;
    -- Con documento ya emitido, el origen de la mercadería no cambia.
    IF TG_OP = 'UPDATE' AND NEW.desde_camion IS DISTINCT FROM OLD.desde_camion AND OLD.dte_id IS NOT NULL THEN
        RAISE EXCEPTION 'DIST_PEDIDO_CERRADO: ya tiene documento; no se cambia de dónde sale';
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_validar_desde_camion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dist_pedidos_desde_camion ON public.dist_pedidos;
CREATE TRIGGER dist_pedidos_desde_camion
    BEFORE INSERT OR UPDATE OF desde_camion ON public.dist_pedidos
    FOR EACH ROW WHEN (NEW.desde_camion) EXECUTE FUNCTION public.dist_validar_desde_camion();

-- ── Las cuatro funciones que leían «todos los lotes» ───────────────────────
-- Cuerpos partidos de la definición VIVA (pg_get_functiondef, 2026-09-30).

-- Asignar: de la ubicación del pedido.
CREATE OR REPLACE FUNCTION public.dist_asignar_lotes(p_pedido bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_emisor   smallint;
    v_sesion   uuid;
    v_camion   uuid;        -- NULL = bodega (preventa); el vendedor = su camión (0030)
    it         record;
    l          record;
    v_por      integer;     -- unidades por presentación
    v_falta    integer;     -- unidades que faltan asignar
    v_toma     integer;
    v_faltas   text[] := '{}';
BEGIN
    SELECT emisor_id, client_uuid, CASE WHEN desde_camion THEN vendedor_id END
      INTO v_emisor, v_sesion, v_camion FROM public.dist_pedidos WHERE id = p_pedido FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'no existe el pedido %', p_pedido; END IF;

    -- Lo reservado por un intento anterior (sin documento, o con uno
    -- descartado o rechazado) vuelve primero al inventario.
    PERFORM public.dist_mover_lote(a.lote_id, a.unidades, 'liberacion', p_pedido, a.dte_id, 'reasignación al facturar')
       FROM public.dist_lote_asignaciones a
       LEFT JOIN public.dist_dte d ON d.id = a.dte_id
      WHERE a.pedido_id = p_pedido AND a.devuelta_at IS NULL
        AND (a.dte_id IS NULL OR d.estado IN ('descartado','rechazado'));
    UPDATE public.dist_lote_asignaciones a SET devuelta_at = now()
      FROM public.dist_lote_asignaciones x LEFT JOIN public.dist_dte d ON d.id = x.dte_id
     WHERE a.id = x.id AND a.pedido_id = p_pedido AND a.devuelta_at IS NULL
       AND (x.dte_id IS NULL OR d.estado IN ('descartado','rechazado'));

    FOR it IN
        SELECT i.id, i.product_id, i.cantidad, i.descripcion, i.lote_id, greatest(coalesce(i.unidades, 1), 1) AS por
          FROM public.dist_pedido_items i WHERE i.pedido_id = p_pedido ORDER BY i.id
    LOOP
        v_por := it.por;
        v_falta := ceil(it.cantidad * v_por)::integer;
        -- 1ª pasada: presentaciones enteras; el lote del renglón primero, y
        -- después primero vence primero sale. Lo apartado por OTRA venta no está.
        FOR l IN
            SELECT dl.id, dl.existencia - coalesce((SELECT sum(r.unidades) FROM public.dist_reservas r
                                                    WHERE r.lote_id = dl.id AND r.vence_at > now()
                                                      AND r.sesion IS DISTINCT FROM v_sesion), 0) AS existencia
              FROM public.dist_lotes dl
             WHERE dl.emisor_id = v_emisor AND dl.product_id = it.product_id AND dl.existencia > 0
               AND dl.en_camion_de IS NOT DISTINCT FROM v_camion
             ORDER BY (dl.id = it.lote_id) DESC NULLS LAST, dl.vence NULLS LAST, dl.id FOR UPDATE OF dl
        LOOP
            EXIT WHEN v_falta <= 0;
            CONTINUE WHEN l.existencia <= 0;
            v_toma := least(v_falta - (v_falta % v_por), (l.existencia / v_por) * v_por);
            IF v_toma > 0 THEN
                PERFORM public.dist_mover_lote(l.id, -v_toma, 'venta', p_pedido, NULL, NULL);
                INSERT INTO public.dist_lote_asignaciones (pedido_id, item_id, lote_id, unidades, cantidad)
                VALUES (p_pedido, it.id, l.id, v_toma, round(v_toma::numeric / v_por, 4));
                v_falta := v_falta - v_toma;
            END IF;
        END LOOP;
        -- 2ª pasada: lo que no llena una presentación (venta fraccionada).
        IF v_falta > 0 THEN
            FOR l IN
                SELECT dl.id, dl.existencia - coalesce((SELECT sum(r.unidades) FROM public.dist_reservas r
                                                        WHERE r.lote_id = dl.id AND r.vence_at > now()
                                                          AND r.sesion IS DISTINCT FROM v_sesion), 0) AS existencia
                  FROM public.dist_lotes dl
                 WHERE dl.emisor_id = v_emisor AND dl.product_id = it.product_id AND dl.existencia > 0
                   AND dl.en_camion_de IS NOT DISTINCT FROM v_camion
                 ORDER BY (dl.id = it.lote_id) DESC NULLS LAST, dl.vence NULLS LAST, dl.id FOR UPDATE OF dl
            LOOP
                EXIT WHEN v_falta <= 0;
                CONTINUE WHEN l.existencia <= 0;
                v_toma := least(v_falta, l.existencia);
                PERFORM public.dist_mover_lote(l.id, -v_toma, 'venta', p_pedido, NULL, NULL);
                INSERT INTO public.dist_lote_asignaciones (pedido_id, item_id, lote_id, unidades, cantidad)
                VALUES (p_pedido, it.id, l.id, v_toma, round(v_toma::numeric / v_por, 4));
                v_falta := v_falta - v_toma;
            END LOOP;
        END IF;
        IF v_falta > 0 THEN
            v_faltas := v_faltas || format('%s (faltan %s unidades%s)', it.descripcion, v_falta,
                                           CASE WHEN v_camion IS NOT NULL THEN ' en el camión' ELSE '' END);
        END IF;
    END LOOP;

    IF cardinality(v_faltas) > 0 THEN
        -- La excepción deshace TODO lo de arriba: no queda nada reservado a medias.
        RAISE EXCEPTION 'Sin existencia suficiente: %', array_to_string(v_faltas, '; ')
            USING ERRCODE = 'P0001';
    END IF;

    -- La existencia ya salió de verdad: la reserva de esta venta sobra.
    DELETE FROM public.dist_reservas WHERE sesion = v_sesion OR pedido_id = p_pedido;

    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'id', a.id, 'item_id', a.item_id, 'lote', dl.lote, 'vence', dl.vence,
                   'unidades', a.unidades, 'cantidad', a.cantidad) ORDER BY a.item_id, dl.vence NULLS LAST, a.id), '[]'::json)
          FROM public.dist_lote_asignaciones a JOIN public.dist_lotes dl ON dl.id = a.lote_id
         WHERE a.pedido_id = p_pedido AND a.devuelta_at IS NULL AND a.dte_id IS NULL
    );
END $function$;

-- El lote elegido en el renglón tiene que estar donde sale el pedido.
CREATE OR REPLACE FUNCTION public.dist_validar_lote_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ok boolean;
BEGIN
    IF NEW.lote_id IS NULL THEN RETURN NEW; END IF;
    SELECT EXISTS (
        SELECT 1 FROM public.dist_lotes l JOIN public.dist_pedidos p ON p.id = NEW.pedido_id
         WHERE l.id = NEW.lote_id AND l.product_id = NEW.product_id AND l.emisor_id = p.emisor_id
           AND l.en_camion_de IS NOT DISTINCT FROM CASE WHEN p.desde_camion THEN p.vendedor_id END
    ) INTO v_ok;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'DIST_LOTE_AJENO: el lote % no es de ese producto o no está donde sale la venta', NEW.lote_id;
    END IF;
    RETURN NEW;
END $function$;

-- Una entrada (compra, ajuste a mano) siempre es a bodega.
CREATE OR REPLACE FUNCTION public.dist_lote_entrada(p_emisor smallint, p_producto integer, p_lote text, p_vence date, p_unidades integer, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; v_vence date; v_queda integer;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_unidades IS NULL OR p_unidades <= 0 THEN RAISE EXCEPTION 'La cantidad tiene que ser mayor que cero.'; END IF;
    IF btrim(coalesce(p_lote, '')) = '' THEN RAISE EXCEPTION 'Falta el número de lote.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.dist_catalogo WHERE emisor_id = p_emisor AND product_id = p_producto) THEN
        RAISE EXCEPTION 'Ese producto no está en el catálogo de la distribuidora.';
    END IF;

    SELECT id, vence INTO v_id, v_vence FROM public.dist_lotes
     WHERE emisor_id = p_emisor AND product_id = p_producto AND upper(btrim(lote)) = upper(btrim(p_lote))
       AND en_camion_de IS NULL
     FOR UPDATE;
    IF v_id IS NULL THEN
        INSERT INTO public.dist_lotes (emisor_id, product_id, lote, vence)
        VALUES (p_emisor, p_producto, upper(btrim(p_lote)), p_vence) RETURNING id INTO v_id;
    ELSIF v_vence IS DISTINCT FROM p_vence THEN
        RAISE EXCEPTION 'El lote % ya existe con vencimiento %. Si está mal, corrígelo con un ajuste.',
            upper(btrim(p_lote)), coalesce(to_char(v_vence, 'DD/MM/YYYY'), 'sin fecha');
    END IF;
    v_queda := public.dist_mover_lote(v_id, p_unidades, 'entrada', NULL, NULL, nullif(btrim(coalesce(p_nota, '')), ''));
    RETURN json_build_object('lote_id', v_id, 'existencia', v_queda);
END $function$;

-- El conteo físico es de la bodega: lo que va en un camión se cuenta al descargarlo.
CREATE OR REPLACE FUNCTION public.dist_iniciar_conteo(p_productos integer[] DEFAULT NULL::integer[], p_nota text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; v_emisor smallint; v_n int;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el conteo lo inicia quien administra';
    END IF;
    SELECT id INTO v_emisor FROM public.dist_emisores ORDER BY id LIMIT 1;
    IF EXISTS (SELECT 1 FROM public.dist_conteos WHERE emisor_id = v_emisor AND estado = 'abierto') THEN
        RAISE EXCEPTION 'DIST_CONTEO: ya hay un conteo abierto: ciérralo o anúlalo antes';
    END IF;
    INSERT INTO public.dist_conteos (emisor_id, nota) VALUES (v_emisor, nullif(btrim(coalesce(p_nota, '')), '')) RETURNING id INTO v_id;
    INSERT INTO public.dist_conteo_items (conteo_id, lote_id, product_id, sistema, costo_unitario)
    SELECT v_id, l.id, l.product_id, l.existencia, cat.costo_promedio
      FROM public.dist_lotes l LEFT JOIN public.dist_catalogo cat ON cat.emisor_id = l.emisor_id AND cat.product_id = l.product_id
     WHERE l.emisor_id = v_emisor AND l.en_camion_de IS NULL
       AND (CASE WHEN p_productos IS NULL THEN l.existencia > 0 ELSE l.product_id = ANY (p_productos) END);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'DIST_CONTEO: no hay lotes que contar'; END IF;
    RETURN v_id;
END $function$;

-- ── Cargar el camión ───────────────────────────────────────────────────────
-- p_items: [{ "lote_id": <lote en bodega>, "unidades": n }]. Abre la carga del
-- vendedor o suma a la abierta. Todo o nada: si un lote no alcanza, no carga.
CREATE OR REPLACE FUNCTION public.dist_cargar_camion(p_vendedor uuid, p_items jsonb, p_nota text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_carga bigint; v_emisor smallint; it record; b record; v_camion bigint; v_n int := 0;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el camión lo carga quien administra la bodega';
    END IF;
    IF p_vendedor IS NULL THEN RAISE EXCEPTION 'DIST_CARGA: falta el vendedor'; END IF;
    SELECT id INTO v_emisor FROM public.dist_emisores ORDER BY id LIMIT 1;

    SELECT id INTO v_carga FROM public.dist_cargas WHERE vendedor_id = p_vendedor AND estado = 'abierta' FOR UPDATE;
    IF v_carga IS NULL THEN
        INSERT INTO public.dist_cargas (emisor_id, vendedor_id, nota, cargado_por)
        VALUES (v_emisor, p_vendedor, nullif(btrim(coalesce(p_nota, '')), ''), public.auth_employee_id())
        RETURNING id INTO v_carga;
    ELSIF EXISTS (SELECT 1 FROM public.dist_cargas c JOIN public.dist_dte d ON d.id = c.dte_id
                   WHERE c.id = v_carga AND d.estado NOT IN ('descartado','rechazado','invalidado')) THEN
        -- La Nota de Remisión ampara lo que dice: sumarle mercadería después
        -- dejaría unidades circulando sin documento.
        RAISE EXCEPTION 'DIST_CARGA: esta carga ya tiene Nota de Remisión; descarga el camión y carga de nuevo';
    END IF;

    FOR it IN
        SELECT (x->>'lote_id')::bigint AS lote_id, sum((x->>'unidades')::int)::int AS unidades
          FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
         WHERE (x->>'unidades')::int > 0 GROUP BY 1 ORDER BY 1
    LOOP
        SELECT * INTO b FROM public.dist_lotes WHERE id = it.lote_id AND en_camion_de IS NULL FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'DIST_CARGA: el lote % no está en bodega', it.lote_id; END IF;
        IF b.existencia - coalesce((SELECT sum(r.unidades) FROM public.dist_reservas r
                                     WHERE r.lote_id = b.id AND r.vence_at > now()), 0) < it.unidades THEN
            RAISE EXCEPTION 'DIST_CARGA: del lote % hay % libres y se pidieron %', b.lote, b.existencia, it.unidades;
        END IF;
        -- La fila del camión: el mismo lote, la misma fecha, en el camión.
        SELECT id INTO v_camion FROM public.dist_lotes
         WHERE emisor_id = b.emisor_id AND product_id = b.product_id AND upper(btrim(lote)) = upper(btrim(b.lote))
           AND en_camion_de = p_vendedor FOR UPDATE;
        IF v_camion IS NULL THEN
            INSERT INTO public.dist_lotes (emisor_id, product_id, lote, vence, en_camion_de)
            VALUES (b.emisor_id, b.product_id, b.lote, b.vence, p_vendedor) RETURNING id INTO v_camion;
        END IF;
        PERFORM public.dist_mover_lote(b.id, -it.unidades, 'carga', NULL, NULL, format('carga %s al camión', v_carga));
        PERFORM public.dist_mover_lote(v_camion, it.unidades, 'carga', NULL, NULL, format('carga %s desde bodega', v_carga));
        INSERT INTO public.dist_carga_items (carga_id, lote_camion_id, product_id, cargado)
        VALUES (v_carga, v_camion, b.product_id, it.unidades)
        ON CONFLICT (carga_id, lote_camion_id) DO UPDATE SET cargado = public.dist_carga_items.cargado + EXCLUDED.cargado;
        v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN RAISE EXCEPTION 'DIST_CARGA: no hay nada que cargar'; END IF;
    RETURN v_carga;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cargar_camion(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_cargar_camion(uuid, jsonb, text) TO authenticated, service_role;

-- ── Descargar el camión ────────────────────────────────────────────────────
-- p_contado: [{ "lote_id": <lote del camión>, "contado": n }]. Un lote del
-- camión que no viene en la lista se toma como contado en cero. Lo contado
-- vuelve a bodega; lo que falta queda como `faltante` y exige nota.
CREATE OR REPLACE FUNCTION public.dist_descargar_camion(p_vendedor uuid, p_contado jsonb, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_carga bigint; l record; v_contado int; v_bodega bigint; v_falt_u int := 0; v_falt_v numeric := 0; v_dev int := 0;
    v_pend int;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el camión lo descarga quien administra la bodega';
    END IF;
    SELECT id INTO v_carga FROM public.dist_cargas WHERE vendedor_id = p_vendedor AND estado = 'abierta' FOR UPDATE;
    -- Una autoventa sin facturar se quedaría sin mercadería: primero se factura o se anula.
    SELECT count(*) INTO v_pend FROM public.dist_pedidos
     WHERE vendedor_id = p_vendedor AND desde_camion AND estado = 'confirmado' AND dte_id IS NULL;
    IF v_pend > 0 THEN
        RAISE EXCEPTION 'DIST_CARGA: hay % venta(s) del camión sin facturar; factúralas o anúlalas antes de descargar', v_pend;
    END IF;

    FOR l IN
        SELECT dl.*, cat.costo_promedio FROM public.dist_lotes dl
          LEFT JOIN public.dist_catalogo cat ON cat.emisor_id = dl.emisor_id AND cat.product_id = dl.product_id
         WHERE dl.en_camion_de = p_vendedor AND dl.existencia > 0 ORDER BY dl.id FOR UPDATE OF dl
    LOOP
        SELECT (x->>'contado')::int INTO v_contado FROM jsonb_array_elements(coalesce(p_contado, '[]'::jsonb)) x
         WHERE (x->>'lote_id')::bigint = l.id LIMIT 1;
        v_contado := coalesce(v_contado, 0);
        IF v_contado < 0 OR v_contado > l.existencia THEN
            RAISE EXCEPTION 'DIST_CARGA: del lote % hay % en el camión; se contaron %', l.lote, l.existencia, v_contado;
        END IF;
        IF v_contado > 0 THEN
            SELECT id INTO v_bodega FROM public.dist_lotes
             WHERE emisor_id = l.emisor_id AND product_id = l.product_id AND upper(btrim(lote)) = upper(btrim(l.lote))
               AND en_camion_de IS NULL FOR UPDATE;
            IF v_bodega IS NULL THEN
                INSERT INTO public.dist_lotes (emisor_id, product_id, lote, vence)
                VALUES (l.emisor_id, l.product_id, l.lote, l.vence) RETURNING id INTO v_bodega;
            END IF;
            PERFORM public.dist_mover_lote(l.id, -v_contado, 'descarga', NULL, NULL, format('descarga carga %s', coalesce(v_carga::text, '—')));
            PERFORM public.dist_mover_lote(v_bodega, v_contado, 'descarga', NULL, NULL, format('vuelve del camión (carga %s)', coalesce(v_carga::text, '—')));
            v_dev := v_dev + v_contado;
        END IF;
        IF l.existencia - v_contado > 0 THEN
            PERFORM public.dist_mover_lote(l.id, -(l.existencia - v_contado), 'faltante', NULL, NULL,
                                           nullif(btrim(coalesce(p_nota, '')), ''));
            v_falt_u := v_falt_u + (l.existencia - v_contado);
            v_falt_v := v_falt_v + (l.existencia - v_contado) * coalesce(l.costo_promedio, 0);
        END IF;
        IF v_carga IS NOT NULL THEN
            INSERT INTO public.dist_carga_items (carga_id, lote_camion_id, product_id, devuelto, faltante)
            VALUES (v_carga, l.id, l.product_id, v_contado, l.existencia - v_contado)
            ON CONFLICT (carga_id, lote_camion_id) DO UPDATE
               SET devuelto = public.dist_carga_items.devuelto + EXCLUDED.devuelto,
                   faltante = public.dist_carga_items.faltante + EXCLUDED.faltante;
        END IF;
    END LOOP;

    IF v_falt_u > 0 AND btrim(coalesce(p_nota, '')) = '' THEN
        RAISE EXCEPTION 'DIST_CARGA: faltan % unidades en el camión: escribe qué pasó', v_falt_u;
    END IF;
    IF v_carga IS NOT NULL THEN
        UPDATE public.dist_cargas SET estado = 'cerrada', cerrada_por = public.auth_employee_id(), cerrada_at = now(),
               nota_cierre = nullif(btrim(coalesce(p_nota, '')), '')
         WHERE id = v_carga;
    END IF;
    RETURN json_build_object('carga_id', v_carga, 'devuelto', v_dev, 'faltante', v_falt_u, 'faltante_costo', round(v_falt_v, 2));
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_descargar_camion(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_descargar_camion(uuid, jsonb, text) TO authenticated, service_role;

-- ── Lo que lleva cada camión, para la pantalla ─────────────────────────────
-- Por camión con carga abierta o con mercadería: la carga, y por lote lo
-- cargado, lo que queda y lo vendido (cargado − queda − devuelto). INVOKER.
CREATE OR REPLACE FUNCTION public.dist_camiones()
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    WITH camion AS (
        SELECT DISTINCT v FROM (
            SELECT vendedor_id AS v FROM public.dist_cargas WHERE estado = 'abierta'
            UNION SELECT en_camion_de FROM public.dist_lotes WHERE en_camion_de IS NOT NULL AND existencia > 0) s)
    SELECT coalesce(json_agg(json_build_object(
        'vendedor_id', c.v,
        'vendedor', (SELECT json_build_object('id', e.id, 'name', e.name) FROM public.employees e WHERE e.id = c.v),
        'carga', (SELECT json_build_object('id', g.id, 'created_at', g.created_at, 'dte_id', g.dte_id, 'nota', g.nota,
                         'dte', (SELECT json_build_object('numero_control', d.numero_control, 'estado', d.estado)
                                   FROM public.dist_dte d WHERE d.id = g.dte_id))
                    FROM public.dist_cargas g WHERE g.vendedor_id = c.v AND g.estado = 'abierta'),
        'lotes', (SELECT coalesce(json_agg(json_build_object(
                        'lote_id', l.id, 'product_id', l.product_id, 'nombre', p.nombre, 'lote', l.lote, 'vence', l.vence,
                        'queda', l.existencia,
                        'cargado', coalesce(ci.cargado, 0),
                        'vendido', greatest(coalesce(ci.cargado, 0) - l.existencia - coalesce(ci.devuelto, 0), 0))
                        ORDER BY p.nombre, l.vence NULLS LAST), '[]'::json)
                    FROM public.dist_lotes l
                    JOIN public.products p ON p.id = l.product_id
                    LEFT JOIN public.dist_carga_items ci ON ci.lote_camion_id = l.id
                         AND ci.carga_id = (SELECT g.id FROM public.dist_cargas g WHERE g.vendedor_id = c.v AND g.estado = 'abierta')
                   WHERE l.en_camion_de = c.v AND (l.existencia > 0 OR ci.id IS NOT NULL))
    ) ORDER BY c.v), '[]'::json)
      FROM camion c;
$$;
REVOKE EXECUTE ON FUNCTION public.dist_camiones() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_camiones() TO authenticated, service_role;
