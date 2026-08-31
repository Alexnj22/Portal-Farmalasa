SET lock_timeout = '5s';

-- Tres columnas que nunca se escribieron, y el reporte que las leía.
--
-- `pedido_items` llevaba DOS juegos casi homónimos de columnas para «quién
-- resolvió esta diferencia y cuándo», separados por una sola letra:
--
--   vivas:   resuelto_por / resuelto_at   ← las escriben las RPC de decisión
--   muertas: resuelta_por / resuelta_at / nota_resolucion
--
-- Medido el 2026-08-31 sobre las 58,018 filas de la tabla: las tres muertas
-- tienen CERO valores. Nunca las escribió nadie, ni el portal, ni una función
-- de la nube, ni una migración viva.
--
-- ── Y no era una trampa a futuro: ya estaba disparada ──────────────────────
-- `get_pedido_diferencias_stats` devolvía `resuelta_at` en su detalle y en su
-- CTE. O sea que el reporte de diferencias de pedidos publicaba una columna que
-- vale `null` en el 100% de las filas — no por falta de resoluciones, sino
-- porque leía la gemela equivocada. Medido sobre los 125 renglones que el
-- reporte muestra hoy: **6 están resueltos y el reporte decía 0.**
--
-- Es la familia de `recibido_mh`: una consulta que devuelve `null` no falla, y
-- un `null` se lee igual que «todavía nadie lo resolvió».
--
-- El orden importa: primero se reemplaza la función —si no, el DROP la deja
-- rota— y recién después se van las columnas.
--
-- Probado antes en el branch de pruebas con `execute_sql` (nunca con
-- `apply_migration`, que le dejaría una fila que producción no va a tener).
-- Verificado en producción antes y después: totales idénticos —33 pedidos, 125
-- renglones, 517/93/424 paquetes— y el detalle pasó de mostrar 0 resoluciones
-- a mostrar las 6 que existen.

CREATE OR REPLACE FUNCTION public.get_pedido_diferencias_stats(
    p_desde timestamptz DEFAULT NULL, p_hasta timestamptz DEFAULT NULL)
RETURNS json
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
WITH diffs AS (
    SELECT pi.id, pi.erp_sucursal_id, pi.erp_product_id, pi.pedido_id,
           pi.cantidad_asignada, pi.cantidad_recibida, pi.nota_diferencia,
           pi.received_at,
           -- `resuelto_at`, la que sí se escribe. Antes decía `resuelta_at`.
           pi.resuelto_at,
           p.nombre AS product_name, pr.tipo AS presentacion_tipo, pd.numero AS pedido_numero
    FROM pedido_items pi
    JOIN pedidos pd ON pd.id = pi.pedido_id
    JOIN products p ON p.id = pi.erp_product_id
    LEFT JOIN presentaciones pr ON pr.id = pi.erp_presentacion_id
    WHERE pi.cantidad_recibida IS NOT NULL
      AND pi.cantidad_recibida < pi.cantidad_asignada
      AND (p_desde IS NULL OR pi.received_at >= p_desde)
      AND (p_hasta IS NULL OR pi.received_at <= p_hasta)
),
por_sucursal AS (
    SELECT erp_sucursal_id,
           COUNT(DISTINCT pedido_id)::integer AS pedidos_con_diferencia,
           COUNT(*)::integer AS items_con_diferencia,
           SUM(cantidad_asignada)::integer AS packs_asignados,
           SUM(cantidad_recibida)::integer AS packs_recibidos,
           (SUM(cantidad_asignada) - SUM(cantidad_recibida))::integer AS packs_faltantes
    FROM diffs GROUP BY erp_sucursal_id ORDER BY packs_faltantes DESC
),
por_producto AS (
    SELECT erp_product_id, product_name, presentacion_tipo,
           COUNT(*)::integer AS veces_con_diferencia,
           SUM(cantidad_asignada)::integer AS packs_asignados,
           SUM(cantidad_recibida)::integer AS packs_recibidos,
           (SUM(cantidad_asignada) - SUM(cantidad_recibida))::integer AS packs_faltantes
    FROM diffs GROUP BY erp_product_id, product_name, presentacion_tipo
    ORDER BY packs_faltantes DESC LIMIT 50
),
detalle AS (
    SELECT id AS pedido_item_id, erp_sucursal_id, erp_product_id, pedido_numero,
           product_name, cantidad_asignada, cantidad_recibida,
           (cantidad_asignada - cantidad_recibida) AS diferencia,
           nota_diferencia, received_at, resuelto_at
    FROM diffs ORDER BY received_at DESC NULLS LAST LIMIT 500
),
totales AS (
    SELECT COUNT(DISTINCT pedido_id)::integer AS pedidos_afectados,
           COUNT(*)::integer AS items_afectados,
           SUM(cantidad_asignada)::integer AS total_packs_asignados,
           SUM(cantidad_recibida)::integer AS total_packs_recibidos,
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

-- Ahora sí. `IF EXISTS` para que reaplicarla no falle, no para tapar una
-- sorpresa: las tres estaban, y se verificó que ningún índice, policy,
-- constraint, trigger ni vista las nombra.
ALTER TABLE public.pedido_items DROP COLUMN IF EXISTS resuelta_at;
ALTER TABLE public.pedido_items DROP COLUMN IF EXISTS resuelta_por;
ALTER TABLE public.pedido_items DROP COLUMN IF EXISTS nota_resolucion;
