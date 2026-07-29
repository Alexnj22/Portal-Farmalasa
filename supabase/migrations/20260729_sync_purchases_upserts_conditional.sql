-- Upserts condicionales para sync-erp-purchases (auditoría 2026-07-29, P1)
--
-- purchase_receipt_items es el peor caso de amplificación de escritura de la
-- base: 185,228 updates sobre 35,840 filas y solo 29.7% HOT — o sea el 71% de
-- esos updates reescribe también los índices. La causa es el upsert
-- incondicional de todas las líneas del rango sincronizado cada 10 minutos,
-- aunque el ERP no haya cambiado una sola línea.
--
-- suppliers: 6,133 updates sobre 78 filas, por el updated_at en el payload.
--
-- NO se toca purchase_receipts acá: su .upsert().select() alimenta el mapa
-- erp_purchase_id→id del que dependen los items. Hacerlo condicional cambia qué
-- filas vuelven en el RETURNING, y la ganancia (18,869 updates) no justifica ese
-- riesgo. Queda anotado como deuda menor.

SET lock_timeout = '5s';

-- ── suppliers ────────────────────────────────────────────────────────────────
-- Devuelve solo el conteo escrito. El mapa erp_supplier_id→id lo sigue leyendo
-- la edge function en un SELECT aparte: dentro de un mismo statement los CTE ven
-- el snapshot previo, así que un proveedor recién insertado no aparecería.
CREATE OR REPLACE FUNCTION public.sync_suppliers_batch(p_rows json)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH incoming AS (
  SELECT DISTINCT ON (r.erp_supplier_id) r.erp_supplier_id, r.nombre, r.nrc
  FROM json_to_recordset(p_rows) AS r(erp_supplier_id integer, nombre text, nrc text)
  WHERE r.erp_supplier_id IS NOT NULL AND r.nombre IS NOT NULL
  ORDER BY r.erp_supplier_id
),
written AS (
  INSERT INTO public.suppliers AS s (erp_supplier_id, nombre, nrc, updated_at)
  SELECT i.erp_supplier_id, i.nombre, i.nrc, now() FROM incoming i
  ON CONFLICT (erp_supplier_id) DO UPDATE
    SET nombre     = EXCLUDED.nombre,
        nrc        = EXCLUDED.nrc,
        updated_at = EXCLUDED.updated_at
    WHERE (s.nombre, s.nrc) IS DISTINCT FROM (EXCLUDED.nombre, EXCLUDED.nrc)
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_suppliers_batch(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_suppliers_batch(json) TO service_role;

-- ── purchase_receipt_items ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_purchase_receipt_items_batch(p_rows json)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH incoming AS (
  SELECT DISTINCT ON (r.receipt_id, r.linea_num)
         r.receipt_id, r.linea_num, r.erp_product_id, r.descripcion,
         r.cantidad, r.precio_unitario, r.total_linea, r.lote, r.fecha_vencimiento
  FROM json_to_recordset(p_rows) AS r(
    receipt_id        integer,
    linea_num         integer,
    erp_product_id    integer,
    descripcion       text,
    cantidad          numeric,
    precio_unitario   numeric,
    total_linea       numeric,
    lote              text,
    fecha_vencimiento date
  )
  WHERE r.receipt_id IS NOT NULL AND r.linea_num IS NOT NULL
  ORDER BY r.receipt_id, r.linea_num
),
written AS (
  INSERT INTO public.purchase_receipt_items AS pri
    (receipt_id, linea_num, erp_product_id, descripcion, cantidad,
     precio_unitario, total_linea, lote, fecha_vencimiento)
  SELECT i.receipt_id, i.linea_num, i.erp_product_id, i.descripcion, i.cantidad,
         i.precio_unitario, i.total_linea, i.lote, i.fecha_vencimiento
  FROM incoming i
  ON CONFLICT (receipt_id, linea_num) DO UPDATE
    SET erp_product_id    = EXCLUDED.erp_product_id,
        descripcion       = EXCLUDED.descripcion,
        cantidad          = EXCLUDED.cantidad,
        precio_unitario   = EXCLUDED.precio_unitario,
        total_linea       = EXCLUDED.total_linea,
        lote              = EXCLUDED.lote,
        fecha_vencimiento = EXCLUDED.fecha_vencimiento
    WHERE (pri.erp_product_id, pri.descripcion, pri.cantidad, pri.precio_unitario,
           pri.total_linea, pri.lote, pri.fecha_vencimiento)
          IS DISTINCT FROM
          (EXCLUDED.erp_product_id, EXCLUDED.descripcion, EXCLUDED.cantidad,
           EXCLUDED.precio_unitario, EXCLUDED.total_linea, EXCLUDED.lote,
           EXCLUDED.fecha_vencimiento)
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_purchase_receipt_items_batch(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_purchase_receipt_items_batch(json) TO service_role;
