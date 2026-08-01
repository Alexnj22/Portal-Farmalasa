SET lock_timeout = '5s';

-- El libro de compras (Art. 86 RCT) necesita cuatro datos por documento que el
-- ERP SÍ manda en `descargar_compras_json.php` y que el sync venía tirando:
-- la clase y el número del documento, y la percepción/retención de IVA.
--
-- Sin ellos `purchase_receipts` sirve para saber CUÁNTO se compró, pero no para
-- declarar: un libro sin número de documento no identifica la operación, y sin
-- la percepción no se puede armar su anexo (que en junio 2026 son 226 filas y
-- $1,531.44 — el subconjunto exacto de las compras con percepcion_iva > 0).
--
-- **Nullable y sin DEFAULT a propósito.** Un `default 0` diría "el ERP informó
-- cero" en las 4,403 filas ya sincronizadas, que es distinto de "todavía no lo
-- sabemos". En un libro fiscal esa diferencia importa: NULL = sin sincronizar
-- (la vista lo marca), 0 = el ERP dijo cero.

ALTER TABLE public.purchase_receipts
    ADD COLUMN IF NOT EXISTS documento_tipo   text,
    ADD COLUMN IF NOT EXISTS documento_numero text,
    ADD COLUMN IF NOT EXISTS percepcion_iva   numeric,
    ADD COLUMN IF NOT EXISTS retencion_iva    numeric;

COMMENT ON COLUMN public.purchase_receipts.documento_tipo IS
    'Clase de documento del ERP (CCF, FC, NC, ND). Origen: documento.tipo.';
COMMENT ON COLUMN public.purchase_receipts.documento_numero IS
    'Número del documento. El ERP lo trunca a 20 caracteres — es lo que hay, y es lo que imprime en su propio libro.';
COMMENT ON COLUMN public.purchase_receipts.percepcion_iva IS
    'IVA percibido por el proveedor (Art. 163 CT). NULL = no sincronizado; 0 = el ERP informó cero.';
COMMENT ON COLUMN public.purchase_receipts.retencion_iva IS
    'IVA retenido (Art. 162 CT). NULL = no sincronizado; 0 = el ERP informó cero.';
