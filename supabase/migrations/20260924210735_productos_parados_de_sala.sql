SET lock_timeout = '5s';

-- Productos con existencia en una sala que llevan seis meses sin venderse AHÍ,
-- y adónde mandarlos. Es el juez del aviso semanal y de la pestaña «Stock
-- retenido»: uno solo, para que el aviso y la lista no puedan contestar
-- distinto.
--
-- ── El reloj ────────────────────────────────────────────────────────────────
-- Los seis meses NO se cuentan desde la última venta a secas. Se cuentan desde
-- la fecha más reciente de tres:
--   1. la última venta en esta sala;
--   2. la última vez que el producto ENTRÓ a esta sala — traslado del sistema
--      (`traslados_erp_linea`), renglón de pedido, envío o compra directa;
--   3. el último REINGRESO a la empresa: la primera compra, o una compra
--      después de ≥120 días sin comprarlo.
-- Sin (2) y (3), un producto que Bodega volvió a comprar el mes pasado y mandó
-- a las salas se leería como «medio año parado» (usuario, 2026-09-24).
--
-- ── El destino ──────────────────────────────────────────────────────────────
-- La sala que más unidades vendió en seis meses, si vendió al menos 3. Si
-- ninguna llega, Bodega. El vencimiento NO decide: hoy la fecha no es
-- confiable (usuario, 2026-09-24).
--
-- Un producto que ya está en un envío pendiente desde esta sala no aparece:
-- avisarlo otra vez sería pedir que se mande dos veces.
CREATE OR REPLACE FUNCTION public.productos_parados_de_sala(p_erp_sucursal_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $function$
DECLARE
    v_costos boolean := true;
    v_res    json;
BEGIN
    IF coalesce(current_setting('request.jwt.claims', true), '') <> ''
       AND (SELECT auth.role()) <> 'service_role' THEN
        IF NOT (coalesce((SELECT public.auth_no_bloqueado()), false)
                AND (coalesce((SELECT public.auth_has_module_permission('gestion_stock', 'can_view')), false)
                  OR coalesce((SELECT public.auth_has_module_permission('minmax', 'can_view')), false))) THEN
            RETURN '[]'::json;
        END IF;
        v_costos := public.auth_ve_costos();
    END IF;

    IF p_erp_sucursal_id IS NULL OR p_erp_sucursal_id = 6 THEN
        RETURN '[]'::json;   -- Bodega no vende al público: «sin venta» no dice nada ahí
    END IF;

    WITH branch_map(bid, esid) AS (
        VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),(28::bigint,4),(2::bigint,5),(29::bigint,7)
    ),
    inv AS MATERIALIZED (
        SELECT i.erp_product_id AS pid,
               SUM(i.cantidad * COALESCE((regexp_match(i.detalle,'\d+[xX](\d+)'))[1]::int,1))::bigint AS unidades
          FROM inventory i
         WHERE i.erp_sucursal_id = p_erp_sucursal_id
           AND i.is_vencidos = false AND i.cantidad > 0
         GROUP BY i.erp_product_id
    ),
    ventas AS MATERIALIZED (
        SELECT bm.esid, ii.erp_product_id AS pid,
               SUM(ii.cantidad::numeric * ii.factor_unidades) AS unidades,
               SUM(ii.total_linea) AS monto
          FROM sales_invoice_items ii
          JOIN sales_invoices si ON si.id = ii.invoice_id
          JOIN branch_map bm     ON bm.bid = si.branch_id
         WHERE si.fecha >= CURRENT_DATE - 180
           AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
           AND ii.cantidad > 0
           AND ii.erp_product_id IN (SELECT pid FROM inv)
         GROUP BY bm.esid, ii.erp_product_id
    ),
    candidatos AS MATERIALIZED (
        SELECT inv.* FROM inv
         WHERE NOT EXISTS (SELECT 1 FROM ventas v WHERE v.esid = p_erp_sucursal_id AND v.pid = inv.pid)
    ),
    ultima_venta AS (
        SELECT pls.erp_product_id AS pid, MAX(pls.last_sale_date) AS f
          FROM product_last_sale pls
         WHERE pls.erp_sucursal_id = p_erp_sucursal_id
           AND pls.erp_product_id IN (SELECT pid FROM candidatos)
         GROUP BY 1
    ),
    entradas AS (
        SELECT t.erp_product_id AS pid, t.fecha AS f, 'traslado' AS via
          FROM traslados_erp_linea t
         WHERE t.erp_sucursal_destino = p_erp_sucursal_id
           AND t.erp_product_id IN (SELECT pid FROM candidatos)
        UNION ALL
        SELECT l.erp_product_id, (l.enviado_at AT TIME ZONE 'America/El_Salvador')::date, 'pedido'
          FROM pedido_traslado_linea l
         WHERE l.erp_sucursal_id = p_erp_sucursal_id
           AND l.estado IN ('enviada', 'recibida') AND l.enviado_at IS NOT NULL
           AND l.erp_product_id IN (SELECT pid FROM candidatos)
        UNION ALL
        SELECT pi.erp_product_id, (COALESCE(pi.received_at, pi.enviado_at) AT TIME ZONE 'America/El_Salvador')::date, 'pedido'
          FROM pedido_items pi
         WHERE pi.erp_sucursal_id = p_erp_sucursal_id
           AND COALESCE(pi.cantidad_recibida, pi.cantidad_enviada, 0) > 0
           AND COALESCE(pi.received_at, pi.enviado_at) IS NOT NULL
           AND pi.erp_product_id IN (SELECT pid FROM candidatos)
        UNION ALL
        SELECT el.erp_product_id, (el.enviado_at AT TIME ZONE 'America/El_Salvador')::date, 'envio'
          FROM envio_linea el
          JOIN approval_requests ar ON ar.id = el.request_id
         WHERE (ar.metadata->>'erp_sucursal_id')::int = p_erp_sucursal_id
           AND el.enviado_at IS NOT NULL
           AND el.erp_product_id IN (SELECT pid FROM candidatos)
        UNION ALL
        SELECT pri.erp_product_id, pr.fecha, 'compra'
          FROM purchase_receipts pr
          JOIN purchase_receipt_items pri ON pri.receipt_id = pr.id
         WHERE pr.erp_sucursal_id = p_erp_sucursal_id AND pri.cantidad > 0
           AND pri.erp_product_id IN (SELECT pid FROM candidatos)
    ),
    ultima_entrada AS (
        SELECT DISTINCT ON (pid) pid, f, via FROM entradas ORDER BY pid, f DESC
    ),
    compras AS (
        SELECT DISTINCT pri.erp_product_id AS pid, pr.fecha
          FROM purchase_receipts pr
          JOIN purchase_receipt_items pri ON pri.receipt_id = pr.id
         WHERE pri.cantidad > 0
           AND pri.erp_product_id IN (SELECT pid FROM candidatos)
    ),
    reingreso AS (
        SELECT pid, MAX(fecha) FILTER (WHERE prev IS NULL OR fecha - prev >= 120) AS f
          FROM (SELECT pid, fecha, lag(fecha) OVER (PARTITION BY pid ORDER BY fecha) AS prev FROM compras) c
         GROUP BY pid
    ),
    reloj AS (
        SELECT c.pid, c.unidades,
               uv.f AS ultima_venta, ue.f AS ultima_entrada, ue.via AS entrada_via, rg.f AS reingreso,
               GREATEST(uv.f, ue.f, rg.f) AS desde
          FROM candidatos c
          LEFT JOIN ultima_venta   uv ON uv.pid = c.pid
          LEFT JOIN ultima_entrada ue ON ue.pid = c.pid
          LEFT JOIN reingreso      rg ON rg.pid = c.pid
    ),
    en_envio AS (
        SELECT DISTINCT (it->>'erp_product_id')::int AS pid
          FROM approval_requests ar, jsonb_array_elements(ar.metadata->'items') it
         WHERE ar.type = 'INVENTORY_TRANSFER_PUSH' AND ar.status = 'PENDING'
           AND (ar.metadata->>'origen_erp_sucursal_id')::int = p_erp_sucursal_id
    ),
    parados AS (
        SELECT r.* FROM reloj r
         WHERE (r.desde IS NULL OR r.desde < CURRENT_DATE - 180)
           AND r.pid NOT IN (SELECT pid FROM en_envio WHERE pid IS NOT NULL)
    ),
    destino AS (
        SELECT DISTINCT ON (v.pid) v.pid, v.esid, v.unidades
          FROM ventas v
         WHERE v.esid <> p_erp_sucursal_id AND v.unidades >= 3
           AND v.pid IN (SELECT pid FROM parados)
         ORDER BY v.pid, v.unidades DESC, v.monto DESC, v.esid
    ),
    vendido_en AS (
        SELECT v.pid, json_agg(json_build_object('esid', v.esid, 'unidades', v.unidades)
                               ORDER BY v.unidades DESC, v.esid) AS otras
          FROM ventas v
         WHERE v.esid <> p_erp_sucursal_id AND v.pid IN (SELECT pid FROM parados)
         GROUP BY v.pid
    ),
    minmax AS (
        SELECT psp.erp_product_id AS pid,
               COALESCE(psp.manual_min, psp.min_units) AS min_qty,
               COALESCE(psp.manual_max, psp.max_units) AS max_qty
          FROM product_stock_params psp
         WHERE psp.erp_sucursal_id = p_erp_sucursal_id
           AND psp.erp_product_id IN (SELECT pid FROM parados)
    ),
    costo AS (
        SELECT DISTINCT ON (product_id) product_id AS pid, (costo / factor::numeric) AS unitario
          FROM product_precios
         WHERE activo AND costo > 0 AND factor > 0
           AND product_id IN (SELECT pid FROM parados)
         ORDER BY product_id, factor ASC, costo ASC, id ASC
    ),
    filas AS (
        SELECT p.pid                          AS erp_product_id,
               pr.nombre                      AS producto,
               COALESCE(l.nombre, '—')        AS laboratorio,
               p.unidades                     AS existencia,
               CASE WHEN v_costos THEN ROUND(p.unidades * COALESCE(c.unitario, 0), 2) END AS costo,
               p.ultima_venta, p.ultima_entrada, p.entrada_via, p.reingreso, p.desde,
               CASE WHEN p.desde IS NULL THEN NULL ELSE CURRENT_DATE - p.desde END AS dias,
               COALESCE(d.esid, 6)            AS destino,
               d.unidades                     AS destino_unidades,
               COALESCE(ve.otras, '[]'::json) AS vendido_en,
               COALESCE(mm.max_qty, 0) > 0    AS en_minmax,
               mm.min_qty, mm.max_qty,
               ROUND(p.unidades * COALESCE(c.unitario, 0), 2) AS _orden
          FROM parados p
          JOIN products pr         ON pr.id = p.pid AND pr.activo
          LEFT JOIN laboratorios l ON l.id = pr.laboratorio_id
          LEFT JOIN destino d      ON d.pid = p.pid
          LEFT JOIN vendido_en ve  ON ve.pid = p.pid
          LEFT JOIN minmax mm      ON mm.pid = p.pid
          LEFT JOIN costo c        ON c.pid = p.pid
    )
    SELECT COALESCE(json_agg(to_json(f)::jsonb - '_orden' ORDER BY f._orden DESC, f.erp_product_id), '[]'::json)
      INTO v_res
      FROM filas f;

    RETURN v_res;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.productos_parados_de_sala(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.productos_parados_de_sala(integer) TO authenticated, service_role;
