-- Resolución de diferencias: pedido_items.resuelta_at / resuelta_por
-- get_pedido_diferencias_stats v2: expone pedido_item_id + resuelta_at en detalle (limit 500)

ALTER TABLE pedido_items
  ADD COLUMN IF NOT EXISTS resuelta_at  timestamptz,
  ADD COLUMN IF NOT EXISTS resuelta_por uuid;

CREATE OR REPLACE FUNCTION public.get_pedido_diferencias_stats(
    p_desde timestamp with time zone DEFAULT NULL,
    p_hasta timestamp with time zone DEFAULT NULL
)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
AS $function$
WITH diffs AS (
    SELECT
        pi.id,
        pi.erp_sucursal_id,
        pi.erp_product_id,
        pi.pedido_id,
        pi.cantidad_asignada,
        pi.cantidad_recibida,
        pi.nota_diferencia,
        pi.received_at,
        pi.resuelta_at,
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
        COUNT(DISTINCT pedido_id)::integer                         AS pedidos_con_diferencia,
        COUNT(*)::integer                                          AS items_con_diferencia,
        SUM(cantidad_asignada)::integer                            AS packs_asignados,
        SUM(cantidad_recibida)::integer                            AS packs_recibidos,
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
        COUNT(*)::integer                                          AS veces_con_diferencia,
        SUM(cantidad_asignada)::integer                            AS packs_asignados,
        SUM(cantidad_recibida)::integer                            AS packs_recibidos,
        (SUM(cantidad_asignada) - SUM(cantidad_recibida))::integer AS packs_faltantes
    FROM diffs
    GROUP BY erp_product_id, product_name, presentacion_tipo
    ORDER BY packs_faltantes DESC
    LIMIT 50
),
detalle AS (
    SELECT
        id                                                         AS pedido_item_id,
        erp_sucursal_id,
        erp_product_id,
        pedido_numero,
        product_name,
        cantidad_asignada,
        cantidad_recibida,
        (cantidad_asignada - cantidad_recibida)                    AS diferencia,
        nota_diferencia,
        received_at,
        resuelta_at
    FROM diffs
    ORDER BY received_at DESC NULLS LAST
    LIMIT 500
),
totales AS (
    SELECT
        COUNT(DISTINCT pedido_id)::integer                         AS pedidos_afectados,
        COUNT(*)::integer                                          AS items_afectados,
        SUM(cantidad_asignada)::integer                            AS total_packs_asignados,
        SUM(cantidad_recibida)::integer                            AS total_packs_recibidos,
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

GRANT EXECUTE ON FUNCTION public.get_pedido_diferencias_stats(timestamptz, timestamptz) TO authenticated, service_role;
