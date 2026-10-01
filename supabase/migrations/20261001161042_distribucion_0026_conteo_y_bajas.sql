-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0026 — conteo físico y bajas con aprobación
-- ═══════════════════════════════════════════════════════════════════════════
-- Lo que dice el sistema y lo que hay en la bodega se separan solos: una caja
-- que se rompió, un lote que venció, una venta mal escrita. Hasta hoy la única
-- forma de corregirlo era el ajuste suelto por lote (0006). Esto lo ordena.
--
-- ── Conteo físico ────────────────────────────────────────────────────────
--   · Quien administra lo INICIA: se toma la foto del sistema de cada lote con
--     existencia (o de los productos elegidos).
--   · Se cuenta A CIEGAS: quien cuenta no ve lo que dice el sistema —si lo
--     ve, tiende a «encontrarlo»—. Quien administra sí lo ve, con la
--     diferencia y su valor al costo.
--   · Al CERRAR, el ajuste es RELATIVO: existencia de ahora + (contado −
--     foto). Si mientras se contaba se vendió, esa venta no se pisa. Lo no
--     contado no se ajusta (se dice cuánto quedó sin contar).
--   · Uno abierto a la vez.
--
-- ── Bajas ────────────────────────────────────────────────────────────────
-- Vencido, dañado, muestra: alguien la PIDE (quien vende o cuenta) y quien
-- administra la APRUEBA o la rechaza. Recién aprobada sale del lote, con su
-- costo. La destrucción de mercadería se documenta además con acta para que
-- sea deducible (lo confirma el contador); acá queda el registro.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dist_conteos (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id    smallint NOT NULL REFERENCES public.dist_emisores(id),
    estado       text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado', 'anulado')),
    nota         text,
    resumen      jsonb,
    creado_por   uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    cerrado_por  uuid REFERENCES public.employees(id),
    cerrado_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dist_conteos_uno_abierto ON public.dist_conteos (emisor_id) WHERE estado = 'abierto';
CREATE INDEX IF NOT EXISTS dist_conteos_creado_por ON public.dist_conteos (creado_por);
CREATE INDEX IF NOT EXISTS dist_conteos_cerrado_por ON public.dist_conteos (cerrado_por) WHERE cerrado_por IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dist_conteo_items (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conteo_id    bigint NOT NULL REFERENCES public.dist_conteos(id) ON DELETE CASCADE,
    lote_id      bigint NOT NULL REFERENCES public.dist_lotes(id),
    product_id   integer NOT NULL REFERENCES public.products(id),
    sistema      integer NOT NULL,
    contado      integer CHECK (contado >= 0),
    nota         text,
    contado_por  uuid REFERENCES public.employees(id),
    contado_at   timestamptz,
    costo_unitario numeric(14,6),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conteo_id, lote_id)
);
CREATE INDEX IF NOT EXISTS dist_conteo_items_lote ON public.dist_conteo_items (lote_id);
CREATE INDEX IF NOT EXISTS dist_conteo_items_producto ON public.dist_conteo_items (product_id);
CREATE INDEX IF NOT EXISTS dist_conteo_items_contado_por ON public.dist_conteo_items (contado_por) WHERE contado_por IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dist_bajas (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id      smallint NOT NULL REFERENCES public.dist_emisores(id),
    lote_id        bigint NOT NULL REFERENCES public.dist_lotes(id),
    product_id     integer NOT NULL REFERENCES public.products(id),
    unidades       integer NOT NULL CHECK (unidades > 0),
    motivo         text NOT NULL CHECK (motivo IN ('vencido', 'danado', 'muestra', 'otro')),
    detalle        text NOT NULL CHECK (btrim(detalle) <> ''),
    estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
    costo_unitario numeric(14,6),
    solicitado_por uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    resuelto_por   uuid REFERENCES public.employees(id),
    resuelto_at    timestamptz,
    nota_resolucion text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_bajas_rechazo_con_motivo CHECK (estado <> 'rechazada' OR btrim(coalesce(nota_resolucion, '')) <> '')
);
CREATE INDEX IF NOT EXISTS dist_bajas_pendientes ON public.dist_bajas (emisor_id) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS dist_bajas_lote ON public.dist_bajas (lote_id);
CREATE INDEX IF NOT EXISTS dist_bajas_producto ON public.dist_bajas (product_id);
CREATE INDEX IF NOT EXISTS dist_bajas_solicitado_por ON public.dist_bajas (solicitado_por);
CREATE INDEX IF NOT EXISTS dist_bajas_resuelto_por ON public.dist_bajas (resuelto_por) WHERE resuelto_por IS NOT NULL;

ALTER TABLE public.dist_conteos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_conteo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_bajas ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['dist_conteos', 'dist_bajas'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission(''distribucion'', ''can_view'')))', t || '_select', t);
    END LOOP;
END $$;
-- Los renglones del conteo NO se leen directo: el `sistema` es justo lo que
-- quien cuenta no debe ver. Se leen por `dist_conteo()`, que lo oculta.
DROP POLICY IF EXISTS dist_conteo_items_select ON public.dist_conteo_items;
CREATE POLICY dist_conteo_items_select ON public.dist_conteo_items FOR SELECT TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
REVOKE ALL ON public.dist_conteos, public.dist_conteo_items, public.dist_bajas FROM anon, authenticated;
GRANT SELECT ON public.dist_conteos, public.dist_conteo_items, public.dist_bajas TO authenticated;
GRANT ALL ON public.dist_conteos, public.dist_conteo_items, public.dist_bajas TO service_role;

-- ── Conteo ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_iniciar_conteo(p_productos integer[] DEFAULT NULL, p_nota text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
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
     WHERE l.emisor_id = v_emisor
       AND (CASE WHEN p_productos IS NULL THEN l.existencia > 0 ELSE l.product_id = ANY (p_productos) END);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'DIST_CONTEO: no hay lotes que contar'; END IF;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_iniciar_conteo(integer[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_iniciar_conteo(integer[], text) TO authenticated, service_role;

-- El conteo con sus renglones. A quien no administra se le oculta el sistema.
CREATE OR REPLACE FUNCTION public.dist_conteo(p_id bigint)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_admin boolean := (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])); v_res json;
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('distribucion', 'can_view')) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no tienes acceso a la distribuidora';
    END IF;
    SELECT json_build_object(
        'id', c.id, 'estado', c.estado, 'nota', c.nota, 'created_at', c.created_at, 'resumen', c.resumen,
        'creado_por', (SELECT name FROM public.employees WHERE id = c.creado_por), 've_sistema', v_admin,
        'items', (SELECT coalesce(json_agg(json_build_object(
                    'id', i.id, 'lote_id', i.lote_id, 'lote', l.lote, 'vence', l.vence, 'product_id', i.product_id, 'nombre', pr.nombre,
                    'sistema', CASE WHEN v_admin THEN i.sistema END, 'contado', i.contado, 'nota', i.nota,
                    'costo', CASE WHEN v_admin THEN i.costo_unitario END,
                    'contado_por', (SELECT name FROM public.employees WHERE id = i.contado_por))
                  ORDER BY pr.nombre, l.vence NULLS LAST), '[]'::json)
                  FROM public.dist_conteo_items i JOIN public.dist_lotes l ON l.id = i.lote_id JOIN public.products pr ON pr.id = i.product_id
                 WHERE i.conteo_id = c.id))
      INTO v_res FROM public.dist_conteos c WHERE c.id = p_id;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_conteo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_conteo(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_contar(p_item bigint, p_contado integer, p_nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion', 'distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no tienes permiso para contar';
    END IF;
    IF p_contado IS NULL OR p_contado < 0 THEN RAISE EXCEPTION 'DIST_CONTEO: escribe cuántas unidades hay (puede ser 0)'; END IF;
    UPDATE public.dist_conteo_items i SET contado = p_contado, nota = nullif(btrim(coalesce(p_nota, '')), ''),
           contado_por = public.auth_employee_id(), contado_at = now()
      FROM public.dist_conteos c WHERE i.id = p_item AND c.id = i.conteo_id AND c.estado = 'abierto';
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_CONTEO: ese conteo ya no está abierto'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_contar(bigint, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_contar(bigint, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_cerrar_conteo(p_id bigint, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE c public.dist_conteos%ROWTYPE; it record; v_actual int; v_delta int; v_ajustados int := 0; v_sin_contar int;
        v_faltante numeric := 0; v_sobrante numeric := 0; v_res json;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el conteo lo cierra quien administra';
    END IF;
    SELECT * INTO c FROM public.dist_conteos WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR c.estado <> 'abierto' THEN RAISE EXCEPTION 'DIST_CONTEO: ese conteo no está abierto'; END IF;
    SELECT count(*) INTO v_sin_contar FROM public.dist_conteo_items WHERE conteo_id = p_id AND contado IS NULL;
    FOR it IN SELECT i.*, pr.nombre FROM public.dist_conteo_items i JOIN public.products pr ON pr.id = i.product_id
               WHERE i.conteo_id = p_id AND i.contado IS NOT NULL AND i.contado <> i.sistema ORDER BY i.id LOOP
        -- Relativo: lo que se vendió o entró mientras se contaba se respeta.
        SELECT existencia INTO v_actual FROM public.dist_lotes WHERE id = it.lote_id FOR UPDATE;
        v_delta := greatest(it.contado - it.sistema, -v_actual);
        IF v_delta <> 0 THEN
            PERFORM public.dist_mover_lote(it.lote_id, v_delta, 'ajuste', NULL, NULL,
                format('Conteo #%s: el sistema decía %s y se contaron %s%s', p_id, it.sistema, it.contado, coalesce(' · ' || it.nota, '')));
            v_ajustados := v_ajustados + 1;
        END IF;
        IF it.contado < it.sistema THEN v_faltante := v_faltante + (it.sistema - it.contado) * coalesce(it.costo_unitario, 0);
        ELSE v_sobrante := v_sobrante + (it.contado - it.sistema) * coalesce(it.costo_unitario, 0); END IF;
    END LOOP;
    v_res := json_build_object('ajustados', v_ajustados, 'sin_contar', v_sin_contar,
                               'faltante', round(v_faltante, 2), 'sobrante', round(v_sobrante, 2));
    UPDATE public.dist_conteos SET estado = 'cerrado', cerrado_por = public.auth_employee_id(), cerrado_at = now(),
           resumen = v_res::jsonb, nota = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), nota)
     WHERE id = p_id;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cerrar_conteo(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_cerrar_conteo(bigint, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_anular_conteo(p_id bigint, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: anular un conteo es de quien administra';
    END IF;
    IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'DIST_CONTEO: escribe por qué se anula'; END IF;
    UPDATE public.dist_conteos SET estado = 'anulado', nota = btrim(p_motivo), cerrado_por = public.auth_employee_id(), cerrado_at = now()
     WHERE id = p_id AND estado = 'abierto';
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_CONTEO: ese conteo no está abierto'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_anular_conteo(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_anular_conteo(bigint, text) TO authenticated, service_role;

-- ── Bajas ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_solicitar_baja(p_lote bigint, p_unidades integer, p_motivo text, p_detalle text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE l public.dist_lotes%ROWTYPE; v_id bigint; v_pend int;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion', 'distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no tienes permiso para pedir bajas';
    END IF;
    SELECT * INTO l FROM public.dist_lotes WHERE id = p_lote;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_BAJA: no existe ese lote'; END IF;
    IF p_motivo NOT IN ('vencido', 'danado', 'muestra', 'otro') THEN RAISE EXCEPTION 'DIST_BAJA: elige el motivo'; END IF;
    IF btrim(coalesce(p_detalle, '')) = '' THEN RAISE EXCEPTION 'DIST_BAJA: describe qué pasó'; END IF;
    SELECT coalesce(sum(unidades), 0) INTO v_pend FROM public.dist_bajas WHERE lote_id = p_lote AND estado = 'pendiente';
    IF p_unidades IS NULL OR p_unidades <= 0 OR p_unidades + v_pend > l.existencia THEN
        RAISE EXCEPTION 'DIST_BAJA: del lote % hay % unidades%', l.lote, l.existencia,
            CASE WHEN v_pend > 0 THEN format(' y %s ya pedidas de baja', v_pend) ELSE '' END;
    END IF;
    INSERT INTO public.dist_bajas (emisor_id, lote_id, product_id, unidades, motivo, detalle, costo_unitario)
    SELECT l.emisor_id, l.id, l.product_id, p_unidades, p_motivo, btrim(p_detalle), cat.costo_promedio
      FROM public.dist_catalogo cat WHERE cat.emisor_id = l.emisor_id AND cat.product_id = l.product_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        INSERT INTO public.dist_bajas (emisor_id, lote_id, product_id, unidades, motivo, detalle)
        VALUES (l.emisor_id, l.id, l.product_id, p_unidades, p_motivo, btrim(p_detalle)) RETURNING id INTO v_id;
    END IF;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_solicitar_baja(bigint, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_solicitar_baja(bigint, integer, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_resolver_baja(p_id bigint, p_aprobar boolean, p_nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE b public.dist_bajas%ROWTYPE; v_hay int;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: las bajas las aprueba quien administra';
    END IF;
    SELECT * INTO b FROM public.dist_bajas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR b.estado <> 'pendiente' THEN RAISE EXCEPTION 'DIST_BAJA: esa baja ya se resolvió'; END IF;
    IF NOT p_aprobar AND btrim(coalesce(p_nota, '')) = '' THEN RAISE EXCEPTION 'DIST_BAJA: escribe por qué se rechaza'; END IF;
    IF p_aprobar THEN
        SELECT existencia INTO v_hay FROM public.dist_lotes WHERE id = b.lote_id FOR UPDATE;
        IF v_hay < b.unidades THEN
            RAISE EXCEPTION 'DIST_BAJA: del lote ya sólo quedan % unidades: rechaza esta y pide la baja de nuevo', v_hay;
        END IF;
        PERFORM public.dist_mover_lote(b.lote_id, -b.unidades, 'ajuste', NULL, NULL,
            format('Baja #%s (%s): %s', b.id, b.motivo, b.detalle));
    END IF;
    UPDATE public.dist_bajas SET estado = CASE WHEN p_aprobar THEN 'aprobada' ELSE 'rechazada' END,
           resuelto_por = public.auth_employee_id(), resuelto_at = now(), nota_resolucion = nullif(btrim(coalesce(p_nota, '')), '')
     WHERE id = p_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_resolver_baja(bigint, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_resolver_baja(bigint, boolean, text) TO authenticated, service_role;
