-- Fix: precio_unitario en purchase_receipt_items siempre era el precio actual
-- del catálogo ERP, no el precio histórico real de cada recibo.
-- Fuente de verdad: total_linea / cantidad = precio real pagado en esa compra.

-- 1. Corregir 18,405 registros históricos donde precio_unitario ≠ total_linea/cantidad
UPDATE purchase_receipt_items
SET precio_unitario = ROUND(total_linea / cantidad, 4)
WHERE cantidad > 0
  AND total_linea > 0
  AND ABS(precio_unitario - (total_linea / cantidad)) > 0.001;

-- 2. Reconstruir la vista product_cost_history para derivar precio_unitario
--    siempre de total_linea/cantidad (fallback al campo crudo si alguno es 0).
DROP VIEW IF EXISTS product_cost_history;

CREATE VIEW product_cost_history AS
SELECT
    pri.erp_product_id,
    pr.fecha,
    pr.proveedor,
    pr.supplier_id,
    pri.descripcion,
    CASE
        WHEN pri.cantidad > 0 AND pri.total_linea > 0
        THEN ROUND(pri.total_linea / pri.cantidad, 4)::numeric(12,4)
        ELSE pri.precio_unitario
    END AS precio_unitario,
    pri.cantidad,
    pri.total_linea,
    pri.lote,
    pri.fecha_vencimiento
FROM purchase_receipt_items pri
JOIN purchase_receipts pr ON pr.id = pri.receipt_id
WHERE pri.erp_product_id IS NOT NULL
  AND (pri.total_linea > 0 OR pri.precio_unitario > 0)
ORDER BY pri.erp_product_id, pr.fecha DESC;
