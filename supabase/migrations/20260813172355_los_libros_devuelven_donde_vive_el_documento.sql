SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Que desde el libro se pueda ABRIR el documento, como en Facturas de compra.
--
-- El visor del portal (`viewPurchaseDte` → `FormPurchaseDteViewer`) necesita
-- `json_path` para leer el DTE y `pdf_path` para mostrar el original. Ninguno de
-- los dos libros los devolvía, así que la fila sabía qué documento era pero no
-- dónde estaba.
--
-- LAS DOS FUNCIONES SE RECREAN, no se reemplazan en su lógica: cambia sólo lo
-- que devuelven. `CREATE OR REPLACE` no puede cambiar el tipo de retorno, así
-- que hace falta DROP + CREATE — va en una transacción, o sea que quien lea
-- durante la migración ve la versión vieja o la nueva, nunca un hueco.
--
-- NO TODAS LAS FILAS TIENEN DOCUMENTO. Medido en julio 2026: de 467 compras
-- registradas, **380 tienen documento** con PDF y JSON, y 87 no — son compras
-- que el sistema registró y cuyo DTE nunca llegó por correo. Esas filas vuelven
-- con `json_path` en NULL, y la pantalla NO las hace clicables: un clic que no
-- abre nada es peor que una fila que se ve quieta.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_libro_compras_completo(date, date, bigint);

CREATE FUNCTION public.get_libro_compras_completo(
  p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint
)
RETURNS TABLE(
  origen text, branch_id bigint, fecha date, documento_tipo text, documento_numero text,
  documento_completo text, proveedor text, nrc text, nit text,
  compras_exentas numeric, compras_gravadas numeric, credito_fiscal numeric, total numeric,
  percepcion_iva numeric, retencion_iva numeric, anulada boolean, tiene_dte boolean,
  -- Lo nuevo: dónde vive el documento.
  dte_id bigint, tipo_dte text, numero_control text, json_path text, pdf_path text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH permitido AS (
    SELECT (SELECT auth_has_module_permission('libro_compras_completo', 'can_view')) AS ok,
           (SELECT auth_module_scope('libro_compras_completo')) AS scope,
           (SELECT auth_employee_branch_id()) AS mi_sucursal
  ),
  compras_norm AS (
    SELECT pr.id, pr.supplier_id, pr.total, pr.fecha, pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero), ' ', ''), '.', ''), 'O', '0')) AS doc
    FROM public.purchase_receipts pr
    WHERE (length(btrim(coalesce(pr.documento_numero, ''))) >= 8 OR pr.sello_recibido IS NOT NULL)
      AND pr.fecha BETWEEN p_desde - 5 AND p_hasta + 5
  ),
  del_erp AS (
    SELECT 'registrada'::text AS origen,
           pr.branch_id::bigint, pr.fecha, pr.documento_tipo, pr.documento_numero,
           coalesce(upper(d.codigo_generacion::text), pr.documento_numero) AS documento_completo,
           pr.proveedor,
           nullif(btrim(coalesce(s.nrc, pm.nrc, '')), '') AS nrc,
           nullif(btrim(coalesce(pm.nit, d.emisor_nit, '')), '') AS nit,
           0::numeric AS compras_exentas,
           coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0) AS compras_gravadas,
           coalesce(pr.iva, 0) AS credito_fiscal,
           coalesce(pr.total, 0) AS total,
           pr.percepcion_iva, pr.retencion_iva,
           pr.estado = 'anulada' AS anulada,
           d.id IS NOT NULL AS tiene_dte,
           d.id AS dte_id, d.tipo_dte, d.numero_control, d.json_path, d.pdf_path
    FROM public.purchase_receipts pr
    LEFT JOIN public.suppliers           s  ON s.id  = pr.supplier_id
    LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
    LEFT JOIN LATERAL (
      SELECT d.* FROM public.purchase_dte_documents d
       WHERE ( (pr.sello_recibido IS NOT NULL AND d.sello_recibido = pr.sello_recibido)
            OR upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0'))
               IN (left(upper(d.codigo_generacion::text), 20),
                   left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                   upper(d.codigo_generacion::text)) )
         AND (pm.nit IS NULL OR d.emisor_nit = pm.nit)
         AND coalesce(d.invalidado, false) = false
       ORDER BY (d.sello_recibido = pr.sello_recibido) DESC NULLS LAST, d.id
       LIMIT 1
    ) d ON true
    WHERE pr.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR pr.branch_id = p_branch_id)
  ),
  sin_compra AS (
    SELECT 'solo_documento'::text AS origen,
           NULL::bigint AS branch_id, d.fecha_emision AS fecha,
           CASE WHEN d.tipo_dte = '03' THEN 'CCF' ELSE 'FACTURA' END AS documento_tipo,
           left(upper(d.codigo_generacion::text), 20) AS documento_numero,
           upper(d.codigo_generacion::text) AS documento_completo,
           d.emisor_nombre AS proveedor,
           nullif(btrim(coalesce(d.emisor_nrc, '')), '') AS nrc,
           nullif(btrim(coalesce(d.emisor_nit, '')), '') AS nit,
           0::numeric AS compras_exentas,
           coalesce(d.monto_total, 0) - coalesce(d.total_iva, 0) AS compras_gravadas,
           coalesce(d.total_iva, 0) AS credito_fiscal,
           coalesce(d.monto_total, 0) AS total,
           NULL::numeric AS percepcion_iva, NULL::numeric AS retencion_iva,
           false AS anulada, true AS tiene_dte,
           d.id AS dte_id, d.tipo_dte, d.numero_control, d.json_path, d.pdf_path
    FROM public.purchase_dte_documents d
    WHERE d.tipo_dte IN ('01', '03')
      AND coalesce(d.invalidado, false) = false
      AND d.fecha_emision BETWEEN p_desde AND p_hasta
      AND NOT EXISTS (SELECT 1 FROM compras_norm c
                       WHERE d.sello_recibido IS NOT NULL AND c.sello_recibido = d.sello_recibido)
      AND NOT EXISTS (SELECT 1 FROM compras_norm c
                       WHERE c.doc IN (left(upper(d.codigo_generacion::text), 20),
                                       left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                                       upper(d.codigo_generacion::text)))
      AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts pr
                        JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
                       WHERE pm.nit = d.emisor_nit
                         AND abs(pr.total - coalesce(d.monto_total, 0)) < 0.01
                         AND pr.fecha BETWEEN d.fecha_emision - 3 AND d.fecha_emision + 3)
      AND p_branch_id IS NULL
  )
  SELECT t.* FROM (SELECT * FROM del_erp UNION ALL SELECT * FROM sin_compra) t,
       permitido p
   WHERE p.ok
     AND (p.scope = 'ALL' OR t.branch_id IS NULL OR t.branch_id = p.mi_sucursal)
   ORDER BY t.fecha, t.origen, t.documento_completo;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_libro_compras_completo(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_compras_completo(date, date, bigint) TO authenticated, service_role;

-- ── El declarable, con lo mismo ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_libro_compras_declarable(date, date);

CREATE FUNCTION public.get_libro_compras_declarable(p_desde date, p_hasta date)
RETURNS TABLE(
  origen text, fecha date, documento_tipo text, documento_numero text, documento_completo text,
  proveedor text, nrc text, nit text,
  compras_gravadas numeric, credito_fiscal numeric, total numeric,
  percepcion_iva numeric, retencion_iva numeric,
  computa_credito boolean, motivo text, clasificacion text,
  dte_id bigint, tipo_dte text, numero_control text, json_path text, pdf_path text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH permitido AS (
    SELECT (SELECT auth_has_module_permission('libro_compras_completo', 'can_view')) AS ok
  ),
  compras_norm AS (
    SELECT pr.id, pr.supplier_id, pr.total, pr.fecha, pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero), ' ', ''), '.', ''), 'O', '0')) AS doc
      FROM public.purchase_receipts pr
     WHERE (length(btrim(coalesce(pr.documento_numero, ''))) >= 8 OR pr.sello_recibido IS NOT NULL)
       AND pr.fecha BETWEEN p_desde - 5 AND p_hasta + 5
  ),
  tipos AS (
    SELECT * FROM (VALUES
      ('03', 'CCF',              1, true ),
      ('05', 'NOTA DE CRÉDITO', -1, true ),
      ('06', 'NOTA DE DÉBITO',   1, true ),
      ('01', 'FACTURA',          1, false),
      ('09', 'LIQUIDACIÓN',      1, false),
      ('07', 'COMPROBANTE DE RETENCIÓN', 1, false)
    ) AS t(tipo_dte, etiqueta, signo, da_credito)
  ),
  del_erp AS (
    SELECT 'registrada'::text AS origen, pr.fecha,
           coalesce(pr.documento_tipo, 'CCF') AS documento_tipo,
           pr.documento_numero,
           coalesce(upper(d.codigo_generacion::text), pr.documento_numero) AS documento_completo,
           pr.proveedor,
           nullif(btrim(coalesce(s.nrc, pm.nrc, '')), '') AS nrc,
           nullif(btrim(coalesce(pm.nit, d.emisor_nit, '')), '') AS nit,
           coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0) AS gravadas,
           coalesce(pr.iva, 0) AS iva,
           coalesce(pr.total, 0) AS total,
           pr.percepcion_iva, pr.retencion_iva,
           1 AS signo, true AS da_credito,
           pm.clasificacion_estado, pm.iva_deducible,
           d.id AS dte_id, d.tipo_dte, d.numero_control, d.json_path, d.pdf_path
      FROM public.purchase_receipts pr
      LEFT JOIN public.suppliers           s  ON s.id  = pr.supplier_id
      LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
      LEFT JOIN LATERAL (
        SELECT d.* FROM public.purchase_dte_documents d
         WHERE ( (pr.sello_recibido IS NOT NULL AND d.sello_recibido = pr.sello_recibido)
              OR upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0'))
                 IN (left(upper(d.codigo_generacion::text), 20),
                     left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                     upper(d.codigo_generacion::text)) )
           AND (pm.nit IS NULL OR d.emisor_nit = pm.nit)
           AND coalesce(d.invalidado, false) = false
         ORDER BY (d.sello_recibido = pr.sello_recibido) DESC NULLS LAST, d.id
         LIMIT 1
      ) d ON true
     WHERE pr.fecha BETWEEN p_desde AND p_hasta
       AND coalesce(pr.estado, '') <> 'anulada'
  ),
  solo_documento AS (
    SELECT 'solo_documento'::text AS origen, d.fecha_emision AS fecha,
           t.etiqueta AS documento_tipo,
           left(upper(d.codigo_generacion::text), 20) AS documento_numero,
           upper(d.codigo_generacion::text) AS documento_completo,
           d.emisor_nombre AS proveedor,
           nullif(btrim(coalesce(d.emisor_nrc, '')), '') AS nrc,
           nullif(btrim(coalesce(d.emisor_nit, '')), '') AS nit,
           coalesce(d.monto_total, 0) - coalesce(d.total_iva, 0) AS gravadas,
           coalesce(d.total_iva, 0) AS iva,
           coalesce(d.monto_total, 0) AS total,
           NULL::numeric AS percepcion_iva, NULL::numeric AS retencion_iva,
           t.signo, t.da_credito,
           pm.clasificacion_estado, pm.iva_deducible,
           d.id AS dte_id, d.tipo_dte, d.numero_control, d.json_path, d.pdf_path
      FROM public.purchase_dte_documents d
      JOIN tipos t ON t.tipo_dte = d.tipo_dte
      LEFT JOIN public.proveedores_maestro pm ON pm.id = d.proveedor_id
     WHERE coalesce(d.invalidado, false) = false
       AND d.fecha_emision BETWEEN p_desde AND p_hasta
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE d.sello_recibido IS NOT NULL AND c.sello_recibido = d.sello_recibido)
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE c.doc IN (left(upper(d.codigo_generacion::text), 20),
                                        left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                                        upper(d.codigo_generacion::text)))
       AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts pr
                         JOIN public.proveedores_maestro pm2 ON pm2.supplier_id = pr.supplier_id
                        WHERE pm2.nit = d.emisor_nit
                          AND abs(pr.total - coalesce(d.monto_total, 0)) < 0.01
                          AND pr.fecha BETWEEN d.fecha_emision - 3 AND d.fecha_emision + 3)
  ),
  todo AS (SELECT * FROM del_erp UNION ALL SELECT * FROM solo_documento),
  juzgado AS (
    SELECT t.*,
           CASE
             WHEN NOT t.da_credito                                     THEN false
             WHEN t.clasificacion_estado IS DISTINCT FROM 'confirmada'  THEN false
             WHEN t.iva_deducible IS NOT TRUE                          THEN false
             ELSE true
           END AS computa,
           CASE
             WHEN NOT t.da_credito
               THEN 'Este tipo de documento no da crédito fiscal (Art. 65 LIVA exige comprobante de crédito fiscal)'
             WHEN t.clasificacion_estado IS DISTINCT FROM 'confirmada'
               THEN 'Falta confirmar la deducibilidad de este proveedor'
             WHEN t.iva_deducible IS NOT TRUE
               THEN 'El proveedor está clasificado como no deducible'
           END AS motivo_txt
      FROM todo t
  )
  SELECT j.origen, j.fecha, j.documento_tipo, j.documento_numero, j.documento_completo,
         j.proveedor, j.nrc, j.nit,
         round((j.gravadas * j.signo)::numeric, 2),
         round((CASE WHEN j.computa THEN j.iva ELSE 0 END * j.signo)::numeric, 2),
         round((j.total * j.signo)::numeric, 2),
         j.percepcion_iva, j.retencion_iva,
         j.computa, j.motivo_txt,
         coalesce(j.clasificacion_estado, 'sin ficha'),
         j.dte_id, j.tipo_dte, j.numero_control, j.json_path, j.pdf_path
    FROM juzgado j, permitido p
   WHERE p.ok
   ORDER BY j.fecha, j.origen, j.documento_completo;
$function$;

COMMENT ON FUNCTION public.get_libro_compras_declarable(date, date) IS
  'Libro de compras con las reglas que deciden lo DECLARABLE: notas de crédito restan y de débito suman (Art. 62 LIVA), sólo el CCF de un proveedor con clasificación confirmada y deducible computa crédito fiscal (Art. 65), y nada se descarta en silencio — lo que no computa sale con su motivo. Devuelve json_path/pdf_path para abrir el documento desde la fila. Sin parámetro de sucursal a propósito: el libro es por NRC y los documentos que sólo llegan por correo no tienen sucursal.';

REVOKE EXECUTE ON FUNCTION public.get_libro_compras_declarable(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_compras_declarable(date, date) TO authenticated, service_role;
