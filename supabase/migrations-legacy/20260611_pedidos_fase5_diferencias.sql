-- ============================================================
-- Pedidos FASE 5 — Reporte de Diferencias (v2.2.53)
--
-- RPC get_pedido_diferencias_stats: agrega ítems donde
-- cantidad_recibida < cantidad_asignada, por sucursal y producto.
-- Filtrable por rango de fechas (received_at del ítem).
-- ============================================================

CREATE OR REPLACE FUNCTION get_pedido_diferencias_stats(
    p_desde timestamptz DEFAULT NULL,
    p_hasta timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
AS $function$
WITH diffs AS (
    SELECT
        pi.erp_sucursal_id,
        pi.erp_product_id,
        pi.pedido_id,
        pi.cantidad_asignada,
        pi.cantidad_recibida,
        pi.nota_diferencia,
        pi.received_at,
        p.nombre                 AS product_name,
        pr.tipo                  AS presentacion_tipo,
        pd.numero                AS pedido_numero
    FROM pedido_items pi
    JOIN pedidos pd      ON pd.id = pi.pedido_id
    JOIN products p      ON p.id  = pi.erp_product_id
    LEFT JOIN presentaciones pr ON pr.id = pi.erp_presentacion_id
    WHERE pi.cantidad_recibida IS NOT NULL
      AND pi.cantidad_recibida < pi.cantidad_asignada
      AND (p_desde IS NULL OR pi.received_at >= p_desde)
      AND (p_hasta IS NULL OR pi.received_at <= p_hasta)
),
por_sucursal AS (
    SELECT
        erp_sucursal_id,
        COUNT(DISTINCT pedido_id)::integer                       AS pedidos_con_diferencia,
        COUNT(*)::integer                                        AS items_con_diferencia,
        SUM(cantidad_asignada)::integer                          AS packs_asignados,
        SUM(cantidad_recibida)::integer                          AS packs_recibidos,
        (SUM(cantidad_asignada) - SUM(cantidad_recibida))::integer AS packs_faltantes
    FROM diffs
    GROUP BY erp_sucursal_id
    ORDER BY packs_faltantes DESC
),
por_producto AS (
    SELECT
        erp_product_id,
        product_name,
        presentacion_tipo,
        COUNT(*)::integer                                         AS veces_con_diferencia,
        SUM(cantidad_asignada)::integer                          AS packs_asignados,
        SUM(cantidad_recibida)::integer                          AS packs_recibidos,
        (SUM(cantidad_asignada) - SUM(cantidad_recibida))::integer AS packs_faltantes
    FROM diffs
    GROUP BY erp_product_id, product_name, presentacion_tipo
    ORDER BY packs_faltantes DESC
    LIMIT 50
),
detalle AS (
    SELECT
        erp_sucursal_id,
        pedido_numero,
        product_name,
        cantidad_asignada,
        cantidad_recibida,
        (cantidad_asignada - cantidad_recibida) AS diferencia,
        nota_diferencia,
        received_at
    FROM diffs
    ORDER BY received_at DESC NULLS LAST
    LIMIT 200
),
totales AS (
    SELECT
        COUNT(DISTINCT pedido_id)::integer                        AS pedidos_afectados,
        COUNT(*)::integer                                         AS items_afectados,
        SUM(cantidad_asignada)::integer                           AS total_packs_asignados,
        SUM(cantidad_recibida)::integer                           AS total_packs_recibidos,
        (SUM(cantidad_asignada) - SUM(cantidad_recibida))::integer AS total_packs_faltantes
    FROM diffs
)
SELECT json_build_object(
    'por_sucursal', (SELECT COALESCE(json_agg(row_to_json(s)), '[]'::json) FROM por_sucursal s),
    'por_producto', (SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json) FROM por_producto p),
    'detalle',      (SELECT COALESCE(json_agg(row_to_json(d)), '[]'::json) FROM detalle d),
    'totales',      (SELECT row_to_json(t) FROM totales t)
);
$function$;

GRANT EXECUTE ON FUNCTION get_pedido_diferencias_stats(timestamptz, timestamptz) TO authenticated;
