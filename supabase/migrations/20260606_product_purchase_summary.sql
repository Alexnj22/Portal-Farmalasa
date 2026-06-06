-- Vistas de resumen de compras para denominator dinámico en MinMax y UI de costos.

CREATE OR REPLACE VIEW product_purchase_summary AS
SELECT
  pri.erp_product_id,
  MIN(pr.fecha)                                    AS first_purchase_date,
  MAX(pr.fecha)                                    AS last_purchase_date,
  (CURRENT_DATE - MIN(pr.fecha))                   AS days_since_first_purchase,
  COUNT(DISTINCT pr.id)                            AS total_receipts,
  SUM(pri.cantidad)                                AS total_units_received,
  ROUND(AVG(pri.precio_unitario)::numeric, 4)      AS avg_cost,
  (
    SELECT pri2.precio_unitario
    FROM purchase_receipt_items pri2
    JOIN purchase_receipts pr2 ON pr2.id = pri2.receipt_id
    WHERE pri2.erp_product_id = pri.erp_product_id
      AND pri2.precio_unitario > 0
    ORDER BY pr2.fecha DESC, pr2.id DESC
    LIMIT 1
  )                                                AS latest_cost,
  COUNT(DISTINCT pr.supplier_id)                   AS distinct_suppliers
FROM purchase_receipt_items pri
JOIN purchase_receipts pr ON pr.id = pri.receipt_id
WHERE pri.erp_product_id IS NOT NULL
GROUP BY pri.erp_product_id;

CREATE OR REPLACE VIEW product_cost_history AS
SELECT
  pri.erp_product_id,
  pr.fecha,
  pr.proveedor,
  pr.supplier_id,
  pri.descripcion,
  pri.precio_unitario,
  pri.cantidad,
  pri.total_linea,
  pri.lote,
  pri.fecha_vencimiento
FROM purchase_receipt_items pri
JOIN purchase_receipts pr ON pr.id = pri.receipt_id
WHERE pri.erp_product_id IS NOT NULL
  AND pri.precio_unitario > 0
ORDER BY pri.erp_product_id, pr.fecha DESC;
