SET lock_timeout = '5s';

-- Las cabeceras de compra sólo se escriben cuando cambió un dato.
--
-- ── Medido antes de tocarlo ──────────────────────────────────────────────────
-- Una corrida controlada: **14 escrituras, 0 inserciones**. Las 14 cabeceras del
-- rango se reescribían enteras cada 10 minutos —144 veces al día— porque el
-- payload traía `updated_at: now()`, así que TODA fila «cambiaba» siempre. Es el
-- patrón que ya costó caro en `inventory` y que los proveedores y los productos
-- de este mismo archivo ya tenían resuelto por RPC; la cabecera se quedó atrás.
--
-- ── Dos cosas que esta función NO toca, a propósito ──────────────────────────
-- `sello_recibido` lo escribe el circuito de documentos, no el sync — si esta
-- función lo tocara, borraría el sello en cada corrida. Y `id` es la llave que
-- los renglones usan para colgarse: por eso el llamador vuelve a leer los ids de
-- las cabeceras NUEVAS en vez de esperarlos de acá (una escritura condicional no
-- devuelve lo que no escribió, y ése es justo el detalle que rompe si se olvida).
--
-- ── Las escalas van antes de comparar ────────────────────────────────────────
-- Misma lección que los renglones: `subtotal`, `iva` y `total` son
-- `numeric(12,2)`. Comparar con más decimales de los que la columna guarda hace
-- que la guarda nunca pueda decir «son iguales».
CREATE OR REPLACE FUNCTION public.sync_purchase_receipts_batch(p_rows json)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT DISTINCT ON (r.erp_purchase_id, r.erp_sucursal_id)
         r.erp_purchase_id, r.branch_id, r.erp_sucursal_id, r.erp_supplier_id,
         r.supplier_id, r.fecha, r.proveedor, r.estado,
         r.subtotal::numeric(12,2) AS subtotal,
         r.iva::numeric(12,2)      AS iva,
         r.total::numeric(12,2)    AS total,
         r.documento_tipo, r.documento_numero, r.percepcion_iva, r.retencion_iva
  FROM json_to_recordset(p_rows) AS r(
    erp_purchase_id  integer,
    branch_id        integer,
    erp_sucursal_id  integer,
    erp_supplier_id  integer,
    supplier_id      integer,
    fecha            date,
    proveedor        text,
    estado           text,
    subtotal         numeric,
    iva              numeric,
    total            numeric,
    documento_tipo   text,
    documento_numero text,
    percepcion_iva   numeric,
    retencion_iva    numeric
  )
  WHERE r.erp_purchase_id IS NOT NULL AND r.erp_sucursal_id IS NOT NULL
    AND r.branch_id IS NOT NULL AND r.fecha IS NOT NULL
  ORDER BY r.erp_purchase_id, r.erp_sucursal_id
),
written AS (
  INSERT INTO public.purchase_receipts AS pr
    (erp_purchase_id, branch_id, erp_sucursal_id, erp_supplier_id, supplier_id,
     fecha, proveedor, estado, subtotal, iva, total,
     documento_tipo, documento_numero, percepcion_iva, retencion_iva, updated_at)
  SELECT i.erp_purchase_id, i.branch_id, i.erp_sucursal_id, i.erp_supplier_id, i.supplier_id,
         i.fecha, i.proveedor, i.estado, i.subtotal, i.iva, i.total,
         i.documento_tipo, i.documento_numero, i.percepcion_iva, i.retencion_iva, now()
  FROM incoming i
  ON CONFLICT (erp_purchase_id, erp_sucursal_id) DO UPDATE
    SET branch_id        = EXCLUDED.branch_id,
        erp_supplier_id  = EXCLUDED.erp_supplier_id,
        supplier_id      = EXCLUDED.supplier_id,
        fecha            = EXCLUDED.fecha,
        proveedor        = EXCLUDED.proveedor,
        estado           = EXCLUDED.estado,
        subtotal         = EXCLUDED.subtotal,
        iva              = EXCLUDED.iva,
        total            = EXCLUDED.total,
        documento_tipo   = EXCLUDED.documento_tipo,
        documento_numero = EXCLUDED.documento_numero,
        percepcion_iva   = EXCLUDED.percepcion_iva,
        retencion_iva    = EXCLUDED.retencion_iva,
        updated_at       = now()
    WHERE (pr.branch_id, pr.erp_supplier_id, pr.supplier_id, pr.fecha, pr.proveedor,
           pr.estado, pr.subtotal, pr.iva, pr.total, pr.documento_tipo,
           pr.documento_numero, pr.percepcion_iva, pr.retencion_iva)
          IS DISTINCT FROM
          (EXCLUDED.branch_id, EXCLUDED.erp_supplier_id, EXCLUDED.supplier_id, EXCLUDED.fecha,
           EXCLUDED.proveedor, EXCLUDED.estado, EXCLUDED.subtotal, EXCLUDED.iva, EXCLUDED.total,
           EXCLUDED.documento_tipo, EXCLUDED.documento_numero, EXCLUDED.percepcion_iva,
           EXCLUDED.retencion_iva)
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$function$;

REVOKE EXECUTE ON FUNCTION public.sync_purchase_receipts_batch(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_purchase_receipts_batch(json) TO service_role;
