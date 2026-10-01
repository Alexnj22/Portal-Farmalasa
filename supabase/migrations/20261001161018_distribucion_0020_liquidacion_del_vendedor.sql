-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0020 — la liquidación diaria del vendedor
-- ═══════════════════════════════════════════════════════════════════════════
-- Al volver de la ruta, el vendedor entrega lo que cobró. Hasta hoy nada decía
-- cuánto tenía que entregar: las ventas, los cobros de cartera y las
-- devoluciones vivían en tres pantallas distintas.
--
-- ── Qué se liquida ───────────────────────────────────────────────────────
-- Por vendedor y día (hora de El Salvador):
--   · las VENTAS del día que él tomó (Factura y Crédito Fiscal vivos), con su
--     desglose por forma de pago;
--   · los COBROS de cartera que él recibió (recibos sin anular);
--   · las DEVOLUCIONES (notas de crédito) sobre sus ventas, con lo que haya que
--     devolverle al cliente;
--   · los CHEQUES, uno por uno, porque se entregan físicos.
-- Efectivo a entregar = lo cobrado en efectivo en ventas + en cobros. Lo que
-- quedó «a favor» de un cliente por una devolución se muestra aparte y NO se
-- resta: el portal no sabe si se le devolvió en efectivo en la ruta, y restarlo
-- a ciegas taparía un faltante.
--
-- ── El cierre ────────────────────────────────────────────────────────────
-- Lo hace quien administra, al contar el efectivo. Guarda una FOTO de la
-- liquidación: lo que se contó se compara contra lo que se esperaba ESE
-- momento. Si después entra otra venta o cobro de ese día, la liquidación lo
-- dice («cambió después del cierre»): es la lección de los cortes de caja de
-- las farmacias — «hay un cierre» y «lo que hay está contado» son preguntas
-- distintas. Una diferencia exige motivo. Reabrir exige motivo y deja rastro.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dist_liquidaciones (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id         smallint NOT NULL REFERENCES public.dist_emisores(id),
    vendedor_id       uuid NOT NULL REFERENCES public.employees(id),
    fecha             date NOT NULL,
    efectivo_esperado numeric(12,2) NOT NULL,
    efectivo_contado  numeric(12,2) NOT NULL CHECK (efectivo_contado >= 0),
    diferencia        numeric(12,2) GENERATED ALWAYS AS (efectivo_contado - efectivo_esperado) STORED,
    resumen           jsonb NOT NULL,
    nota              text,
    estado            text NOT NULL DEFAULT 'cerrada' CHECK (estado IN ('cerrada', 'reabierta')),
    cerrada_por       uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    cerrada_at        timestamptz NOT NULL DEFAULT now(),
    reabierta_por     uuid REFERENCES public.employees(id),
    reabierta_at      timestamptz,
    reabierta_motivo  text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_liquidaciones_diferencia_con_motivo CHECK (efectivo_contado = efectivo_esperado OR btrim(coalesce(nota, '')) <> ''),
    CONSTRAINT dist_liquidaciones_reabierta CHECK (estado = 'cerrada' OR btrim(coalesce(reabierta_motivo, '')) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS dist_liquidaciones_una_por_dia ON public.dist_liquidaciones (vendedor_id, fecha) WHERE estado = 'cerrada';
CREATE INDEX IF NOT EXISTS dist_liquidaciones_fecha ON public.dist_liquidaciones (emisor_id, fecha DESC);
CREATE INDEX IF NOT EXISTS dist_liquidaciones_cerrada_por ON public.dist_liquidaciones (cerrada_por);

ALTER TABLE public.dist_liquidaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_liquidaciones_select ON public.dist_liquidaciones;
-- Cada vendedor ve las suyas; quien administra, todas.
CREATE POLICY dist_liquidaciones_select ON public.dist_liquidaciones FOR SELECT TO authenticated
    USING (vendedor_id = (SELECT public.auth_employee_id()) OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
REVOKE ALL ON public.dist_liquidaciones FROM anon, authenticated;
GRANT SELECT ON public.dist_liquidaciones TO authenticated;
GRANT ALL ON public.dist_liquidaciones TO service_role;

-- Los índices que la liquidación usa para no barrer: cobros por quién y cuándo.
CREATE INDEX IF NOT EXISTS dist_recibos_recibido_por ON public.dist_recibos (recibido_por, created_at);

-- ── La liquidación de un vendedor en un día (un JSON) ─────────────────────
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
    efectivo AS (
        SELECT coalesce((SELECT sum(monto) FROM pagos WHERE forma = '01'), 0) AS ventas,
               coalesce((SELECT sum(monto) FROM cobros WHERE forma = '01'), 0) AS cobros
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
        'efectivo', (SELECT json_build_object('ventas', ventas, 'cobros', cobros, 'esperado', ventas + cobros) FROM efectivo),
        'cierre', (SELECT json_build_object('id', c.id, 'contado', c.efectivo_contado, 'esperado', c.efectivo_esperado,
                       'diferencia', c.diferencia, 'nota', c.nota, 'cerrada_at', c.cerrada_at, 'cerrada_por', c.cerrada_por_nombre,
                       -- Lo que se esperaba al cerrar contra lo que se espera hoy: si difiere, algo entró después.
                       'cambio_despues', c.efectivo_esperado <> (SELECT ventas + cobros FROM efectivo)
                           OR (c.resumen->'ventas'->>'documentos')::int <> (SELECT count(*) FROM ventas)
                           OR (c.resumen->'cobros'->>'total')::numeric <> (SELECT coalesce(sum(monto), 0) FROM cobros))
                     FROM cierre c),
        'puede_cerrar', v_admin
    ) INTO v_res;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_liquidacion(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_liquidacion(uuid, date) TO authenticated, service_role;

-- ── Todos los vendedores de un día (para quien administra) ────────────────
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
        )
        SELECT coalesce(json_agg(x ORDER BY x.name), '[]'::json) FROM (
            SELECT m.vendedor_id AS id, e.name, e.photo_url, sum(m.venta) AS ventas, sum(m.cobro) AS cobros,
                   sum(m.efectivo) AS esperado, l.id AS cierre_id, l.efectivo_contado AS contado, l.diferencia
              FROM mov m
              LEFT JOIN public.employees e ON e.id = m.vendedor_id
              LEFT JOIN public.dist_liquidaciones l ON l.vendedor_id = m.vendedor_id AND l.fecha = p_fecha AND l.estado = 'cerrada'
             WHERE m.vendedor_id IS NOT NULL
             GROUP BY m.vendedor_id, e.name, e.photo_url, l.id, l.efectivo_contado, l.diferencia) x);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_liquidaciones_del_dia(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_liquidaciones_del_dia(date) TO authenticated, service_role;

-- ── Cerrar y reabrir ─────────────────────────────────────────────────────
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
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_reabrir_liquidacion(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_reabrir_liquidacion(bigint, text) TO authenticated, service_role;
