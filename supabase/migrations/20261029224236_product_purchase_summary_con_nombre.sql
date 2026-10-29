SET lock_timeout = '5s';

-- La pestaña «Productos» de Compras mostraba sólo el número del producto:
-- nadie sabía qué era. Se agregan al FINAL (CREATE OR REPLACE VIEW exige
-- conservar las columnas existentes en su orden y tipo): el nombre, el
-- proveedor de la última compra y el costo de la compra anterior, para decir
-- si subió o bajó. `latest_cost` sale ahora del mismo LATERAL que los dos
-- nuevos: una búsqueda por producto en vez de dos. Medido: 302 ms vs 261 ms.
CREATE OR REPLACE VIEW public.product_purchase_summary
WITH (security_invoker = true) AS
WITH a AS (
  SELECT pri.erp_product_id,
         min(pr.fecha) AS first_purchase_date,
         max(pr.fecha) AS last_purchase_date,
         (CURRENT_DATE - min(pr.fecha)) AS days_since_first_purchase,
         count(DISTINCT pr.id) AS total_receipts,
         sum(pri.cantidad) AS total_units_received,
         round(avg(pri.precio_unitario), 4) AS avg_cost,
         count(DISTINCT pr.supplier_id) AS distinct_suppliers
    FROM public.purchase_receipt_items pri
    JOIN public.purchase_receipts pr ON pr.id = pri.receipt_id
   WHERE pri.erp_product_id IS NOT NULL
   GROUP BY pri.erp_product_id
)
SELECT a.erp_product_id, a.first_purchase_date, a.last_purchase_date,
       a.days_since_first_purchase, a.total_receipts, a.total_units_received,
       a.avg_cost, u.latest_cost::numeric(12,4) AS latest_cost, a.distinct_suppliers,
       p.nombre, u.ultimo_proveedor, u.costo_anterior::numeric(12,4) AS costo_anterior
  FROM a
  LEFT JOIN public.products p ON p.id = a.erp_product_id
  LEFT JOIN LATERAL (
    SELECT (array_agg(x.precio))[1]    AS latest_cost,
           (array_agg(x.proveedor))[1] AS ultimo_proveedor,
           (array_agg(x.precio))[2]    AS costo_anterior
      FROM (SELECT coalesce(s.nombre, pr2.proveedor) AS proveedor, pri2.precio_unitario AS precio
              FROM public.purchase_receipt_items pri2
              JOIN public.purchase_receipts pr2 ON pr2.id = pri2.receipt_id
              LEFT JOIN public.suppliers s ON s.id = pr2.supplier_id
             WHERE pri2.erp_product_id = a.erp_product_id AND pri2.precio_unitario > 0
             ORDER BY pr2.fecha DESC, pr2.id DESC
             LIMIT 2) x
  ) u ON true;
