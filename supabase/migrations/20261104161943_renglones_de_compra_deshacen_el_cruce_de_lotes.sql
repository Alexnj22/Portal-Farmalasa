SET lock_timeout = '5s';
-- La lista de compras del sistema cruza los k renglones de un producto con sus
-- k lotes (k×k filas). `sync-erp-purchases` lo deshace (`_shared/cruceDeLotes.ts`).
-- Las cantidades salen exactas; QUÉ lote va con QUÉ cantidad no se puede saber
-- cuando hay varias de cada una, y eso se dice en la fila en vez de inventarlo.
ALTER TABLE public.purchase_receipt_items
  ADD COLUMN IF NOT EXISTS lote_aproximado boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.purchase_receipt_items.lote_aproximado IS
  'true = el lote es uno de los de este producto en esta compra, pero la lista del sistema no dice si es el de ESTA cantidad (varias cantidades y varios lotes).';

CREATE OR REPLACE FUNCTION public.sync_purchase_receipt_items_batch(p_rows json)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT DISTINCT ON (r.receipt_id, r.linea_num)
         r.receipt_id, r.linea_num, r.erp_product_id, r.descripcion,
         r.cantidad::numeric(10,3)        AS cantidad,
         r.precio_unitario::numeric(12,4) AS precio_unitario,
         r.total_linea::numeric(12,2)     AS total_linea,
         r.lote, r.fecha_vencimiento,
         coalesce(r.lote_aproximado, false) AS lote_aproximado
  FROM json_to_recordset(p_rows) AS r(
    receipt_id        integer,
    linea_num         integer,
    erp_product_id    integer,
    descripcion       text,
    cantidad          numeric,
    precio_unitario   numeric,
    total_linea       numeric,
    lote              text,
    fecha_vencimiento date,
    lote_aproximado   boolean
  )
  WHERE r.receipt_id IS NOT NULL AND r.linea_num IS NOT NULL
  ORDER BY r.receipt_id, r.linea_num
),
written AS (
  INSERT INTO public.purchase_receipt_items AS pri
    (receipt_id, linea_num, erp_product_id, descripcion, cantidad,
     precio_unitario, total_linea, lote, fecha_vencimiento, lote_aproximado)
  SELECT i.receipt_id, i.linea_num, i.erp_product_id, i.descripcion, i.cantidad,
         i.precio_unitario, i.total_linea, i.lote, i.fecha_vencimiento, i.lote_aproximado
  FROM incoming i
  ON CONFLICT (receipt_id, linea_num) DO UPDATE
    SET erp_product_id    = EXCLUDED.erp_product_id,
        descripcion       = EXCLUDED.descripcion,
        cantidad          = EXCLUDED.cantidad,
        precio_unitario   = EXCLUDED.precio_unitario,
        total_linea       = EXCLUDED.total_linea,
        lote              = EXCLUDED.lote,
        fecha_vencimiento = EXCLUDED.fecha_vencimiento,
        lote_aproximado   = EXCLUDED.lote_aproximado
    WHERE (pri.erp_product_id, pri.descripcion, pri.cantidad, pri.precio_unitario,
           pri.total_linea, pri.lote, pri.fecha_vencimiento, pri.lote_aproximado)
          IS DISTINCT FROM
          (EXCLUDED.erp_product_id, EXCLUDED.descripcion, EXCLUDED.cantidad,
           EXCLUDED.precio_unitario, EXCLUDED.total_linea, EXCLUDED.lote,
           EXCLUDED.fecha_vencimiento, EXCLUDED.lote_aproximado)
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$function$;

-- Borra los renglones que sobran al final de cada compra (antes k×k, ahora k).
-- Lo llama el sync DESPUÉS de todas sus tandas, con cuántos renglones tiene
-- cada compra que leyó. n < 1 no borra nada: una lectura vacía no autoriza.
CREATE OR REPLACE FUNCTION public.podar_renglones_de_compra(p_rows json)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v integer;
BEGIN
  WITH r AS (
    SELECT x.receipt_id, x.n FROM json_to_recordset(p_rows) AS x(receipt_id integer, n integer)
     WHERE x.receipt_id IS NOT NULL AND x.n >= 1
  ), d AS (
    DELETE FROM public.purchase_receipt_items i USING r
     WHERE i.receipt_id = r.receipt_id AND i.linea_num >= r.n
    RETURNING 1
  )
  SELECT count(*) INTO v FROM d;
  RETURN v;
END $function$;
REVOKE EXECUTE ON FUNCTION public.podar_renglones_de_compra(json) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.podar_renglones_de_compra(json) TO service_role;
