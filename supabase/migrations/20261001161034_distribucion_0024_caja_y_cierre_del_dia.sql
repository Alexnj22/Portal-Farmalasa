-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0024 — la caja del vendedor y el cierre del día
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-09-30): «debemos dejar la distribuidora completa
-- como un punto de venta… los cortes, apertura, cierre del día, si lleva
-- efectivo de cambio».
--
-- Con factura electrónica no hay «corte Z» fiscal: Hacienda recibe cada
-- documento en línea, y el Z de las máquinas registradoras era para eso. Lo que
-- queda es el control INTERNO del efectivo, que es esto:
--
--   · APERTURA — quien administra le entrega al vendedor su fondo de cambio.
--     Una caja por vendedor y día; queda quién la abrió y con cuánto.
--   · DURANTE EL DÍA — gastos de ruta pagados con ese efectivo (con concepto),
--     ENTREGAS PARCIALES (el «corte» a media jornada: se cuenta, se compara con
--     lo esperado en ese momento y se recibe) e ingresos que no son venta.
--   · LIQUIDACIÓN (0020) — el esperado ahora es
--       fondo + ventas en efectivo + cobros en efectivo + ingresos
--       − gastos − entregas parciales,
--     o sea TODO el efectivo en mano, fondo incluido: el fondo vuelve.
--     Liquidar cierra la caja; reabrir la liquidación la reabre.
--   · CIERRE DEL DÍA — la empresa entera: lo vendido por forma de pago, el
--     efectivo recibido de las liquidaciones y sus diferencias, los depósitos
--     al banco, y la conciliación (recibido − depositado = queda en caja
--     fuerte). No se cierra con cajas sin liquidar. Cerrado, las liquidaciones
--     de ese día no se reabren sin reabrir antes el cierre.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dist_cajas (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id      smallint NOT NULL REFERENCES public.dist_emisores(id),
    vendedor_id    uuid NOT NULL REFERENCES public.employees(id),
    fecha          date NOT NULL,
    fondo          numeric(12,2) NOT NULL DEFAULT 0 CHECK (fondo >= 0),
    nota           text,
    estado         text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
    abierta_por    uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    abierta_at     timestamptz NOT NULL DEFAULT now(),
    cerrada_at     timestamptz,
    liquidacion_id bigint REFERENCES public.dist_liquidaciones(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (vendedor_id, fecha)
);
CREATE INDEX IF NOT EXISTS dist_cajas_fecha ON public.dist_cajas (fecha);
CREATE INDEX IF NOT EXISTS dist_cajas_abierta_por ON public.dist_cajas (abierta_por);
CREATE INDEX IF NOT EXISTS dist_cajas_liquidacion ON public.dist_cajas (liquidacion_id) WHERE liquidacion_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dist_caja_movimientos (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    caja_id        bigint NOT NULL REFERENCES public.dist_cajas(id),
    tipo           text NOT NULL CHECK (tipo IN ('gasto', 'entrega', 'ingreso')),
    monto          numeric(12,2) NOT NULL CHECK (monto > 0),
    concepto       text NOT NULL CHECK (btrim(concepto) <> ''),
    -- Una entrega parcial es un corte: se cuenta lo que hay en mano y se compara.
    contado        numeric(12,2),
    esperado       numeric(12,2),
    comprobante_url text,
    creado_por     uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    anulado_at     timestamptz,
    anulado_por    uuid REFERENCES public.employees(id),
    anulado_motivo text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_caja_mov_anulado CHECK (anulado_at IS NULL OR btrim(coalesce(anulado_motivo, '')) <> '')
);
CREATE INDEX IF NOT EXISTS dist_caja_movimientos_caja ON public.dist_caja_movimientos (caja_id);
CREATE INDEX IF NOT EXISTS dist_caja_movimientos_creado_por ON public.dist_caja_movimientos (creado_por);

CREATE TABLE IF NOT EXISTS public.dist_depositos (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id      smallint NOT NULL REFERENCES public.dist_emisores(id),
    fecha          date NOT NULL,
    monto          numeric(12,2) NOT NULL CHECK (monto > 0),
    banco          text NOT NULL CHECK (btrim(banco) <> ''),
    referencia     text NOT NULL CHECK (btrim(referencia) <> ''),
    comprobante_url text,
    creado_por     uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    anulado_at     timestamptz,
    anulado_motivo text,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dist_depositos_fecha ON public.dist_depositos (fecha);
CREATE INDEX IF NOT EXISTS dist_depositos_creado_por ON public.dist_depositos (creado_por);

CREATE TABLE IF NOT EXISTS public.dist_cierres_dia (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id      smallint NOT NULL REFERENCES public.dist_emisores(id),
    fecha          date NOT NULL,
    resumen        jsonb NOT NULL,
    nota           text,
    estado         text NOT NULL DEFAULT 'cerrado' CHECK (estado IN ('cerrado', 'reabierto')),
    cerrado_por    uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    cerrado_at     timestamptz NOT NULL DEFAULT now(),
    reabierto_por  uuid REFERENCES public.employees(id),
    reabierto_at   timestamptz,
    reabierto_motivo text,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dist_cierres_dia_uno ON public.dist_cierres_dia (fecha) WHERE estado = 'cerrado';
CREATE INDEX IF NOT EXISTS dist_cierres_dia_cerrado_por ON public.dist_cierres_dia (cerrado_por);

ALTER TABLE public.dist_cajas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_caja_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_depositos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_cierres_dia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_cajas_select ON public.dist_cajas;
CREATE POLICY dist_cajas_select ON public.dist_cajas FOR SELECT TO authenticated
    USING (vendedor_id = (SELECT public.auth_employee_id()) OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
DROP POLICY IF EXISTS dist_caja_movimientos_select ON public.dist_caja_movimientos;
CREATE POLICY dist_caja_movimientos_select ON public.dist_caja_movimientos FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.dist_cajas k WHERE k.id = caja_id
                    AND (k.vendedor_id = (SELECT public.auth_employee_id()) OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])))));
DROP POLICY IF EXISTS dist_depositos_select ON public.dist_depositos;
CREATE POLICY dist_depositos_select ON public.dist_depositos FOR SELECT TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
DROP POLICY IF EXISTS dist_cierres_dia_select ON public.dist_cierres_dia;
CREATE POLICY dist_cierres_dia_select ON public.dist_cierres_dia FOR SELECT TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
REVOKE ALL ON public.dist_cajas, public.dist_caja_movimientos, public.dist_depositos, public.dist_cierres_dia FROM anon, authenticated;
GRANT SELECT ON public.dist_cajas, public.dist_caja_movimientos, public.dist_depositos, public.dist_cierres_dia TO authenticated;
GRANT ALL ON public.dist_cajas, public.dist_caja_movimientos, public.dist_depositos, public.dist_cierres_dia TO service_role;

-- ── Abrir la caja (quien administra entrega el fondo) ──────────────────────
CREATE OR REPLACE FUNCTION public.dist_abrir_caja(p_vendedor uuid, p_fecha date, p_fondo numeric, p_nota text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_id bigint; v_emisor smallint;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: la caja la abre quien entrega el fondo de cambio';
    END IF;
    IF p_fondo IS NULL OR p_fondo < 0 THEN RAISE EXCEPTION 'DIST_CAJA: escribe el fondo de cambio (puede ser 0)'; END IF;
    IF p_fecha <> (now() AT TIME ZONE 'America/El_Salvador')::date THEN
        RAISE EXCEPTION 'DIST_CAJA: la caja se abre el mismo día';
    END IF;
    IF EXISTS (SELECT 1 FROM public.dist_cierres_dia WHERE fecha = p_fecha AND estado = 'cerrado') THEN
        RAISE EXCEPTION 'DIST_CIERRE_DIA: ese día ya está cerrado';
    END IF;
    IF EXISTS (SELECT 1 FROM public.dist_cajas WHERE vendedor_id = p_vendedor AND fecha = p_fecha) THEN
        RAISE EXCEPTION 'DIST_CAJA: ese vendedor ya tiene caja hoy';
    END IF;
    SELECT id INTO v_emisor FROM public.dist_emisores ORDER BY id LIMIT 1;
    INSERT INTO public.dist_cajas (emisor_id, vendedor_id, fecha, fondo, nota)
    VALUES (v_emisor, p_vendedor, p_fecha, round(p_fondo, 2), nullif(btrim(coalesce(p_nota, '')), '')) RETURNING id INTO v_id;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_abrir_caja(uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_abrir_caja(uuid, date, numeric, text) TO authenticated, service_role;

-- ── Un movimiento: gasto, entrega parcial (corte) o ingreso ────────────────
-- El vendedor anota sus gastos; una ENTREGA la registra quien recibe el
-- efectivo, con el conteo: lo esperado en ese momento se calcula acá, no se
-- escribe.
CREATE OR REPLACE FUNCTION public.dist_movimiento_caja(p_caja bigint, p_tipo text, p_monto numeric, p_concepto text, p_contado numeric DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE k public.dist_cajas%ROWTYPE; v_admin boolean := (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])); v_esp numeric; v_id bigint;
BEGIN
    SELECT * INTO k FROM public.dist_cajas WHERE id = p_caja FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_CAJA: no existe esa caja'; END IF;
    IF k.estado <> 'abierta' THEN RAISE EXCEPTION 'DIST_CAJA: la caja ya se liquidó'; END IF;
    IF p_tipo NOT IN ('gasto', 'entrega', 'ingreso') THEN RAISE EXCEPTION 'DIST_CAJA: movimiento desconocido'; END IF;
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'DIST_CAJA: escribe el monto'; END IF;
    IF btrim(coalesce(p_concepto, '')) = '' THEN RAISE EXCEPTION 'DIST_CAJA: escribe el concepto'; END IF;
    IF p_tipo = 'entrega' AND NOT v_admin THEN RAISE EXCEPTION 'DIST_SIN_PERMISO: una entrega la registra quien recibe el efectivo'; END IF;
    IF NOT v_admin AND k.vendedor_id IS DISTINCT FROM public.auth_employee_id() THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: cada vendedor anota en su propia caja';
    END IF;
    IF p_tipo = 'entrega' THEN
        v_esp := ((public.dist_liquidacion(k.vendedor_id, k.fecha))->'efectivo'->>'esperado')::numeric;
        IF p_monto > v_esp THEN
            RAISE EXCEPTION 'DIST_CAJA: no puede entregar $% si en mano tiene $%', to_char(p_monto, 'FM999,990.00'), to_char(v_esp, 'FM999,990.00');
        END IF;
    END IF;
    INSERT INTO public.dist_caja_movimientos (caja_id, tipo, monto, concepto, contado, esperado)
    VALUES (p_caja, p_tipo, round(p_monto, 2), btrim(p_concepto), round(p_contado, 2), round(v_esp, 2)) RETURNING id INTO v_id;
    RETURN json_build_object('id', v_id, 'esperado', round(v_esp, 2), 'contado', round(p_contado, 2));
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_movimiento_caja(bigint, text, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_movimiento_caja(bigint, text, numeric, text, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_anular_movimiento_caja(p_id bigint, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: anular un movimiento de caja es de quien administra';
    END IF;
    IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'DIST_CAJA: escribe por qué se anula'; END IF;
    UPDATE public.dist_caja_movimientos m SET anulado_at = now(), anulado_por = public.auth_employee_id(), anulado_motivo = btrim(p_motivo)
      FROM public.dist_cajas k
     WHERE m.id = p_id AND k.id = m.caja_id AND k.estado = 'abierta' AND m.anulado_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_CAJA: ese movimiento no se puede anular (caja liquidada o ya anulado)'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_anular_movimiento_caja(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_anular_movimiento_caja(bigint, text) TO authenticated, service_role;

-- ── La liquidación, las del día, cerrar y reabrir: ahora con la caja ───────
CREATE OR REPLACE FUNCTION public.dist_liquidacion(p_vendedor uuid, p_fecha date)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE
    v_admin boolean := (SELECT public.auth_can_edit_any(ARRAY['distribucion_config']));
    v_res   json;
BEGIN
    IF NOT v_admin AND p_vendedor IS DISTINCT FROM (SELECT public.auth_employee_id()) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: cada vendedor ve su propia liquidación';
    END IF;
    WITH ventas AS (
        SELECT d.id, d.tipo, d.numero_control, d.hor_emi, d.total_pagar, d.estado, p.id AS pedido_id, p.condicion, c.nombre AS cliente
          FROM public.dist_dte d
          JOIN public.dist_pedidos p ON p.id = d.pedido_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
         WHERE p.vendedor_id = p_vendedor AND d.fec_emi = p_fecha
           AND d.tipo IN ('01', '03') AND d.estado NOT IN ('descartado', 'invalidado', 'rechazado')
    ),
    pagos AS (
        SELECT pg.forma, pg.monto, pg.referencia, v.numero_control, v.cliente
          FROM public.dist_pagos pg JOIN ventas v ON v.pedido_id = pg.pedido_id
    ),
    cobros AS (
        SELECT r.id, r.forma, r.monto, r.referencia, r.created_at, c.nombre AS cliente
          FROM public.dist_recibos r JOIN public.dist_clientes c ON c.id = r.cliente_id
         WHERE r.recibido_por = p_vendedor AND r.anulado_at IS NULL
           AND r.created_at >= (p_fecha::timestamp AT TIME ZONE 'America/El_Salvador')
           AND r.created_at <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/El_Salvador')
    ),
    devoluciones AS (
        SELECT dv.id, n.numero_control, dv.total, dv.a_favor, dv.credito_aplicado, dv.motivo, c.nombre AS cliente
          FROM public.dist_devoluciones dv
          JOIN public.dist_dte n ON n.id = dv.nota_id AND n.estado NOT IN ('descartado', 'invalidado')
          JOIN public.dist_dte o ON o.id = dv.dte_origen_id
          JOIN public.dist_pedidos p ON p.id = o.pedido_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
         WHERE dv.estado = 'emitida' AND p.vendedor_id = p_vendedor AND n.fec_emi = p_fecha
    ),
    caja AS (
        SELECT k.* FROM public.dist_cajas k WHERE k.vendedor_id = p_vendedor AND k.fecha = p_fecha
    ),
    movs AS (
        SELECT m.* FROM public.dist_caja_movimientos m JOIN caja k ON k.id = m.caja_id WHERE m.anulado_at IS NULL
    ),
    efectivo AS (
        SELECT coalesce((SELECT sum(monto) FROM pagos WHERE forma = '01'), 0) AS ventas,
               coalesce((SELECT sum(monto) FROM cobros WHERE forma = '01'), 0) AS cobros,
               coalesce((SELECT fondo FROM caja), 0) AS fondo,
               coalesce((SELECT sum(monto) FROM movs WHERE tipo = 'gasto'), 0) AS gastos,
               coalesce((SELECT sum(monto) FROM movs WHERE tipo = 'entrega'), 0) AS entregas,
               coalesce((SELECT sum(monto) FROM movs WHERE tipo = 'ingreso'), 0) AS ingresos
    ),
    cierre AS (
        SELECT l.*, e.name AS cerrada_por_nombre FROM public.dist_liquidaciones l
          LEFT JOIN public.employees e ON e.id = l.cerrada_por
         WHERE l.vendedor_id = p_vendedor AND l.fecha = p_fecha AND l.estado = 'cerrada'
    )
    SELECT json_build_object(
        'vendedor', (SELECT json_build_object('id', id, 'name', name) FROM public.employees WHERE id = p_vendedor),
        'fecha', p_fecha,
        'ventas', json_build_object(
            'total', (SELECT coalesce(sum(total_pagar), 0) FROM ventas),
            'documentos', (SELECT count(*) FROM ventas),
            'lista', (SELECT coalesce(json_agg(json_build_object('id', id, 'tipo', tipo, 'numero_control', numero_control,
                          'hora', hor_emi, 'cliente', cliente, 'total', total_pagar, 'estado', estado) ORDER BY hor_emi), '[]'::json) FROM ventas)),
        'por_forma', (SELECT coalesce(json_agg(json_build_object('forma', forma, 'monto', monto, 'origen', origen) ORDER BY forma, origen), '[]'::json) FROM (
            SELECT forma, sum(monto) AS monto, 'ventas' AS origen FROM pagos GROUP BY forma
            UNION ALL SELECT forma, sum(monto), 'cobros' FROM cobros GROUP BY forma) f),
        'cobros', json_build_object(
            'total', (SELECT coalesce(sum(monto), 0) FROM cobros),
            'lista', (SELECT coalesce(json_agg(json_build_object('id', id, 'cliente', cliente, 'forma', forma, 'monto', monto,
                          'referencia', referencia, 'hora', created_at) ORDER BY created_at), '[]'::json) FROM cobros)),
        'devoluciones', json_build_object(
            'total', (SELECT coalesce(sum(total), 0) FROM devoluciones),
            'a_favor', (SELECT coalesce(sum(a_favor), 0) FROM devoluciones),
            'lista', (SELECT coalesce(json_agg(json_build_object('id', id, 'numero_control', numero_control, 'cliente', cliente,
                          'total', total, 'a_favor', a_favor, 'motivo', motivo)), '[]'::json) FROM devoluciones)),
        'cheques', (SELECT coalesce(json_agg(json_build_object('monto', monto, 'referencia', referencia, 'cliente', cliente, 'origen', origen)), '[]'::json) FROM (
            SELECT monto, referencia, cliente, 'venta ' || numero_control AS origen FROM pagos WHERE forma = '04'
            UNION ALL SELECT monto, referencia, cliente, 'cobro' FROM cobros WHERE forma = '04') ch),
        'credito', (SELECT coalesce(sum(monto), 0) FROM pagos WHERE forma = '13'),
        -- A entregar al cerrar: el fondo vuelve con todo lo demás. Lo entregado
        -- en un corte parcial ya se recibió, y lo gastado en ruta ya salió.
        'efectivo', (SELECT json_build_object('ventas', ventas, 'cobros', cobros, 'fondo', fondo, 'gastos', gastos,
                         'entregas', entregas, 'ingresos', ingresos,
                         'esperado', fondo + ventas + cobros + ingresos - gastos - entregas) FROM efectivo),
        'caja', (SELECT json_build_object('id', k.id, 'fondo', k.fondo, 'estado', k.estado, 'abierta_at', k.abierta_at,
                         'abierta_por', (SELECT name FROM public.employees WHERE id = k.abierta_por), 'nota', k.nota) FROM caja k),
        'movimientos', (SELECT coalesce(json_agg(json_build_object('id', m.id, 'tipo', m.tipo, 'monto', m.monto, 'concepto', m.concepto,
                          'contado', m.contado, 'esperado', m.esperado, 'hora', m.created_at,
                          'quien', (SELECT name FROM public.employees WHERE id = m.creado_por)) ORDER BY m.created_at), '[]'::json) FROM movs m),
        'cierre', (SELECT json_build_object('id', c.id, 'contado', c.efectivo_contado, 'esperado', c.efectivo_esperado,
                       'diferencia', c.diferencia, 'nota', c.nota, 'cerrada_at', c.cerrada_at, 'cerrada_por', c.cerrada_por_nombre,
                       -- Lo que se esperaba al cerrar contra lo que se espera hoy: si difiere, algo entró después.
                       'cambio_despues', c.efectivo_esperado <> (SELECT fondo + ventas + cobros + ingresos - gastos - entregas FROM efectivo)
                           OR (c.resumen->'ventas'->>'documentos')::int <> (SELECT count(*) FROM ventas)
                           OR (c.resumen->'cobros'->>'total')::numeric <> (SELECT coalesce(sum(monto), 0) FROM cobros))
                     FROM cierre c),
        'puede_cerrar', v_admin
    ) INTO v_res;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_liquidacion(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_liquidacion(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_liquidaciones_del_dia(p_fecha date)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: las liquidaciones de todos las ve quien administra';
    END IF;
    RETURN (
        WITH mov AS (
            SELECT p.vendedor_id, d.total_pagar AS venta, 0::numeric AS cobro,
                   coalesce((SELECT sum(pg.monto) FROM public.dist_pagos pg WHERE pg.pedido_id = p.id AND pg.forma = '01'), 0) AS efectivo
              FROM public.dist_dte d JOIN public.dist_pedidos p ON p.id = d.pedido_id
             WHERE d.fec_emi = p_fecha AND d.tipo IN ('01', '03') AND d.estado NOT IN ('descartado', 'invalidado', 'rechazado')
            UNION ALL
            SELECT r.recibido_por, 0, r.monto, CASE WHEN r.forma = '01' THEN r.monto ELSE 0 END
              FROM public.dist_recibos r
             WHERE r.anulado_at IS NULL
               AND r.created_at >= (p_fecha::timestamp AT TIME ZONE 'America/El_Salvador')
               AND r.created_at <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/El_Salvador')
            UNION ALL
            -- La caja del día: el fondo y sus movimientos cuentan en el efectivo, y
            -- un vendedor con caja abierta aparece aunque todavía no venda.
            SELECT k.vendedor_id, 0, 0, k.fondo + coalesce((SELECT sum(CASE m.tipo WHEN 'ingreso' THEN m.monto ELSE -m.monto END)
                                                   FROM public.dist_caja_movimientos m WHERE m.caja_id = k.id AND m.anulado_at IS NULL), 0)
              FROM public.dist_cajas k WHERE k.fecha = p_fecha
        )
        SELECT coalesce(json_agg(x ORDER BY x.name), '[]'::json) FROM (
            SELECT m.vendedor_id AS id, e.name, e.photo_url, sum(m.venta) AS ventas, sum(m.cobro) AS cobros,
                   sum(m.efectivo) AS esperado, l.id AS cierre_id, l.efectivo_contado AS contado, l.diferencia,
                   (SELECT k.estado FROM public.dist_cajas k WHERE k.vendedor_id = m.vendedor_id AND k.fecha = p_fecha) AS caja
              FROM mov m
              LEFT JOIN public.employees e ON e.id = m.vendedor_id
              LEFT JOIN public.dist_liquidaciones l ON l.vendedor_id = m.vendedor_id AND l.fecha = p_fecha AND l.estado = 'cerrada'
             WHERE m.vendedor_id IS NOT NULL
             GROUP BY m.vendedor_id, e.name, e.photo_url, l.id, l.efectivo_contado, l.diferencia) x);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_liquidaciones_del_dia(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_liquidaciones_del_dia(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_cerrar_liquidacion(p_vendedor uuid, p_fecha date, p_contado numeric, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_liq json; v_esperado numeric; v_id bigint; v_emisor smallint;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: la liquidación la cierra quien recibe el efectivo';
    END IF;
    IF p_contado IS NULL OR p_contado < 0 THEN RAISE EXCEPTION 'DIST_LIQUIDACION: escribe cuánto efectivo se contó'; END IF;
    IF p_fecha > (now() AT TIME ZONE 'America/El_Salvador')::date THEN
        RAISE EXCEPTION 'DIST_LIQUIDACION: no se liquida un día que todavía no llega';
    END IF;
    -- Un cierre a la vez por vendedor y día.
    PERFORM pg_advisory_xact_lock(hashtext('dist_liquidacion:' || p_vendedor::text || ':' || p_fecha::text));
    IF EXISTS (SELECT 1 FROM public.dist_liquidaciones WHERE vendedor_id = p_vendedor AND fecha = p_fecha AND estado = 'cerrada') THEN
        RAISE EXCEPTION 'DIST_LIQUIDACION_CERRADA: ese día ya está liquidado: reábrelo si hay que volver a contar';
    END IF;
    v_liq := public.dist_liquidacion(p_vendedor, p_fecha);
    v_esperado := (v_liq->'efectivo'->>'esperado')::numeric;
    IF round(p_contado, 2) <> round(v_esperado, 2) AND btrim(coalesce(p_nota, '')) = '' THEN
        RAISE EXCEPTION 'DIST_LIQUIDACION_MOTIVO: hay % de diferencia: escribe el motivo',
            to_char(round(p_contado - v_esperado, 2), 'FMS999,999,990.00');
    END IF;
    SELECT id INTO v_emisor FROM public.dist_emisores ORDER BY id LIMIT 1;
    INSERT INTO public.dist_liquidaciones (emisor_id, vendedor_id, fecha, efectivo_esperado, efectivo_contado, resumen, nota)
    VALUES (v_emisor, p_vendedor, p_fecha, round(v_esperado, 2), round(p_contado, 2), v_liq::jsonb, nullif(btrim(coalesce(p_nota, '')), ''))
    RETURNING id INTO v_id;
    -- Liquidar cierra la caja del día.
    UPDATE public.dist_cajas SET estado = 'cerrada', cerrada_at = now(), liquidacion_id = v_id
     WHERE vendedor_id = p_vendedor AND fecha = p_fecha AND estado = 'abierta';
    RETURN json_build_object('id', v_id, 'esperado', round(v_esperado, 2), 'contado', round(p_contado, 2), 'diferencia', round(p_contado - v_esperado, 2));
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cerrar_liquidacion(uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_cerrar_liquidacion(uuid, date, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_reabrir_liquidacion(p_id bigint, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: reabrir una liquidación es de quien administra';
    END IF;
    IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'DIST_LIQUIDACION_MOTIVO: escribe por qué se reabre'; END IF;
    UPDATE public.dist_liquidaciones SET estado = 'reabierta', reabierta_por = public.auth_employee_id(), reabierta_at = now(),
           reabierta_motivo = btrim(p_motivo)
     WHERE id = p_id AND estado = 'cerrada';
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_LIQUIDACION: esa liquidación no está cerrada'; END IF;
    IF EXISTS (SELECT 1 FROM public.dist_cierres_dia d JOIN public.dist_liquidaciones l ON l.fecha = d.fecha
                WHERE l.id = p_id AND d.estado = 'cerrado') THEN
        RAISE EXCEPTION 'DIST_CIERRE_DIA: ese día ya está cerrado: reabre primero el cierre del día';
    END IF;
    UPDATE public.dist_cajas SET estado = 'abierta', cerrada_at = NULL, liquidacion_id = NULL WHERE liquidacion_id = p_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_reabrir_liquidacion(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_reabrir_liquidacion(bigint, text) TO authenticated, service_role;

-- ── El cierre del día de la empresa ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_cierre_dia(p_fecha date)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v_res json;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el cierre del día lo ve quien administra';
    END IF;
    WITH vendedores AS (SELECT * FROM json_to_recordset(public.dist_liquidaciones_del_dia(p_fecha))
            AS x(id uuid, name text, ventas numeric, cobros numeric, esperado numeric, cierre_id bigint, contado numeric, diferencia numeric, caja text)),
    ventas AS (
        SELECT d.id, d.tipo, d.total_pagar, p.id AS pedido_id FROM public.dist_dte d JOIN public.dist_pedidos p ON p.id = d.pedido_id
         WHERE d.fec_emi = p_fecha AND d.tipo IN ('01', '03') AND d.estado NOT IN ('descartado', 'invalidado', 'rechazado')
    ),
    formas AS (
        SELECT forma, sum(monto) AS monto, 'ventas' AS origen FROM public.dist_pagos WHERE pedido_id IN (SELECT pedido_id FROM ventas) GROUP BY forma
        UNION ALL
        SELECT forma, sum(monto), 'cobros' FROM public.dist_recibos WHERE anulado_at IS NULL
           AND created_at >= (p_fecha::timestamp AT TIME ZONE 'America/El_Salvador')
           AND created_at <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/El_Salvador') GROUP BY forma
    ),
    liq AS (SELECT * FROM public.dist_liquidaciones WHERE fecha = p_fecha AND estado = 'cerrada'),
    dep AS (SELECT * FROM public.dist_depositos WHERE fecha = p_fecha AND anulado_at IS NULL),
    gastos AS (SELECT m.* FROM public.dist_caja_movimientos m JOIN public.dist_cajas k ON k.id = m.caja_id
                WHERE k.fecha = p_fecha AND m.anulado_at IS NULL)
    SELECT json_build_object(
        'fecha', p_fecha,
        'vendedores', (SELECT coalesce(json_agg(v ORDER BY v.name), '[]'::json) FROM vendedores v),
        'pendientes', (SELECT count(*) FROM vendedores WHERE cierre_id IS NULL),
        'ventas', json_build_object('total', (SELECT coalesce(sum(total_pagar), 0) FROM ventas), 'documentos', (SELECT count(*) FROM ventas)),
        'por_forma', (SELECT coalesce(json_agg(json_build_object('forma', forma, 'monto', monto, 'origen', origen) ORDER BY forma, origen), '[]'::json) FROM formas),
        'devoluciones', (SELECT coalesce(sum(dv.total), 0) FROM public.dist_devoluciones dv JOIN public.dist_dte n ON n.id = dv.nota_id
                          WHERE dv.estado = 'emitida' AND n.fec_emi = p_fecha AND n.estado NOT IN ('descartado', 'invalidado')),
        'gastos', (SELECT coalesce(sum(monto), 0) FROM gastos WHERE tipo = 'gasto'),
        'gastos_lista', (SELECT coalesce(json_agg(json_build_object('monto', monto, 'concepto', concepto) ORDER BY created_at), '[]'::json) FROM gastos WHERE tipo = 'gasto'),
        -- Lo que entró a la oficina: entregas parciales + lo contado al liquidar.
        'efectivo_recibido', (SELECT coalesce(sum(efectivo_contado), 0) FROM liq) + (SELECT coalesce(sum(monto), 0) FROM gastos WHERE tipo = 'entrega'),
        'fondos', (SELECT coalesce(sum(fondo), 0) FROM public.dist_cajas WHERE fecha = p_fecha),
        'diferencias', (SELECT coalesce(sum(diferencia), 0) FROM liq),
        'depositos', (SELECT coalesce(json_agg(json_build_object('id', id, 'monto', monto, 'banco', banco, 'referencia', referencia) ORDER BY created_at), '[]'::json) FROM dep),
        'depositado', (SELECT coalesce(sum(monto), 0) FROM dep),
        'cierre', (SELECT json_build_object('id', c.id, 'cerrado_at', c.cerrado_at, 'nota', c.nota,
                        'cerrado_por', (SELECT name FROM public.employees WHERE id = c.cerrado_por))
                     FROM public.dist_cierres_dia c WHERE c.fecha = p_fecha AND c.estado = 'cerrado')
    ) INTO v_res;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cierre_dia(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_cierre_dia(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_registrar_deposito(p_fecha date, p_monto numeric, p_banco text, p_referencia text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_id bigint; v_emisor smallint;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: los depósitos los registra quien administra';
    END IF;
    IF EXISTS (SELECT 1 FROM public.dist_cierres_dia WHERE fecha = p_fecha AND estado = 'cerrado') THEN
        RAISE EXCEPTION 'DIST_CIERRE_DIA: ese día ya está cerrado';
    END IF;
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'DIST_DEPOSITO: escribe el monto'; END IF;
    IF btrim(coalesce(p_banco, '')) = '' OR btrim(coalesce(p_referencia, '')) = '' THEN
        RAISE EXCEPTION 'DIST_DEPOSITO: escribe el banco y el número de la boleta';
    END IF;
    SELECT id INTO v_emisor FROM public.dist_emisores ORDER BY id LIMIT 1;
    INSERT INTO public.dist_depositos (emisor_id, fecha, monto, banco, referencia)
    VALUES (v_emisor, p_fecha, round(p_monto, 2), btrim(p_banco), btrim(p_referencia)) RETURNING id INTO v_id;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_registrar_deposito(date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_registrar_deposito(date, numeric, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_cerrar_dia(p_fecha date, p_nota text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_res json; v_id bigint; v_emisor smallint; v_pend int;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el día lo cierra quien administra';
    END IF;
    IF p_fecha > (now() AT TIME ZONE 'America/El_Salvador')::date THEN RAISE EXCEPTION 'DIST_CIERRE_DIA: ese día todavía no llega'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('dist_cierre_dia:' || p_fecha::text));
    IF EXISTS (SELECT 1 FROM public.dist_cierres_dia WHERE fecha = p_fecha AND estado = 'cerrado') THEN
        RAISE EXCEPTION 'DIST_CIERRE_DIA: ese día ya está cerrado';
    END IF;
    v_res := public.dist_cierre_dia(p_fecha);
    v_pend := (v_res->>'pendientes')::int;
    IF v_pend > 0 THEN
        RAISE EXCEPTION 'DIST_CIERRE_DIA_PENDIENTES: % % liquidación%: se cierra el día cuando todos entregaron',
            CASE WHEN v_pend = 1 THEN 'falta' ELSE 'faltan' END, v_pend, CASE WHEN v_pend = 1 THEN '' ELSE 'es' END;
    END IF;
    -- Lo recibido que no se depositó tiene que tener explicación.
    IF round((v_res->>'efectivo_recibido')::numeric - (v_res->>'depositado')::numeric, 2) <> 0 AND btrim(coalesce(p_nota, '')) = '' THEN
        RAISE EXCEPTION 'DIST_CIERRE_DIA_MOTIVO: quedan $% sin depositar: escribe dónde quedan (caja fuerte, fondo de mañana…)',
            to_char((v_res->>'efectivo_recibido')::numeric - (v_res->>'depositado')::numeric, 'FM999,999,990.00');
    END IF;
    SELECT id INTO v_emisor FROM public.dist_emisores ORDER BY id LIMIT 1;
    INSERT INTO public.dist_cierres_dia (emisor_id, fecha, resumen, nota)
    VALUES (v_emisor, p_fecha, v_res::jsonb, nullif(btrim(coalesce(p_nota, '')), '')) RETURNING id INTO v_id;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cerrar_dia(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_cerrar_dia(date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_reabrir_dia(p_id bigint, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: reabrir el día es de quien administra';
    END IF;
    IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'DIST_CIERRE_DIA: escribe por qué se reabre'; END IF;
    UPDATE public.dist_cierres_dia SET estado = 'reabierto', reabierto_por = public.auth_employee_id(), reabierto_at = now(),
           reabierto_motivo = btrim(p_motivo) WHERE id = p_id AND estado = 'cerrado';
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_CIERRE_DIA: ese cierre no está vigente'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_reabrir_dia(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_reabrir_dia(bigint, text) TO authenticated, service_role;

-- ── Quién puede vender (para abrirle la caja en la mañana) ─────────────────
-- Antes de su primera venta un vendedor no aparece en las liquidaciones del
-- día, y es justo cuando hay que abrirle la caja.
CREATE OR REPLACE FUNCTION public.dist_vendedores()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
    SELECT coalesce(json_agg(json_build_object('id', e.id, 'name', e.name, 'photo_url', e.photo_url) ORDER BY e.name), '[]'::json)
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = e.role_id AND rp.module_key = 'distribucion' AND rp.can_edit)
       AND (SELECT public.auth_can_edit_any(ARRAY['distribucion_config']));
$$;
REVOKE EXECUTE ON FUNCTION public.dist_vendedores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_vendedores() TO authenticated, service_role;
