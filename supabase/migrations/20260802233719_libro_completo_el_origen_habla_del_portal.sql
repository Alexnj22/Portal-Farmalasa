SET lock_timeout = '5s';

-- La columna `origen` devolvia 'ERP' y 'DTE recibido', y eso llegaba tal cual a
-- la pantalla Y al CSV exportado. Rompe la regla del portal: **el usuario no
-- sabe que es el ERP**, y la procedencia del dato no va en la UI ni en los
-- archivos que se entregan. Corregido por el usuario el 2026-08-02, la segunda
-- vez que se le escapa lo mismo (la primera fue el barrido de v2.334.1). La
-- regla quedo escrita en CLAUDE.md.
--
-- Los valores pasan a describir el ESTADO DEL NEGOCIO, que ademas es lo que la
-- vista quiere decir: el documento esta registrado como compra, o solo existe el
-- documento del proveedor.
--
--   'ERP'          -> 'registrada'
--   'DTE recibido' -> 'solo_documento'
--
-- Son valores de maquina en minuscula: la etiqueta que se lee la pone la vista,
-- que es donde tiene que vivir el idioma.

CREATE OR REPLACE FUNCTION public.get_libro_compras_completo(
  p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL
)
 RETURNS TABLE(
   origen text, branch_id bigint, fecha date, documento_tipo text,
   documento_numero text, documento_completo text,
   proveedor text, nrc text, nit text,
   compras_exentas numeric, compras_gravadas numeric, credito_fiscal numeric,
   total numeric, percepcion_iva numeric, retencion_iva numeric,
   anulada boolean, tiene_dte boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH permitido AS (
    SELECT (SELECT auth_has_module_permission('libro_compras_completo', 'can_view')) AS ok,
           (SELECT auth_module_scope('libro_compras_completo')) AS scope,
           (SELECT auth_employee_branch_id()) AS mi_sucursal
  ),
  del_erp AS (
    SELECT 'registrada'::text AS origen,
           pr.branch_id::bigint, pr.fecha, pr.documento_tipo,
           pr.documento_numero,
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
           d.id IS NOT NULL AS tiene_dte
    FROM public.purchase_receipts pr
    LEFT JOIN public.suppliers           s  ON s.id  = pr.supplier_id
    LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
    LEFT JOIN LATERAL (
      SELECT d.* FROM public.purchase_dte_documents d
       WHERE left(upper(d.codigo_generacion::text), 20) = pr.documento_numero
         AND (pm.nit IS NULL OR d.emisor_nit = pm.nit)
         AND coalesce(d.invalidado, false) = false
       ORDER BY d.id LIMIT 1
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
           false AS anulada,
           true AS tiene_dte
    FROM public.purchase_dte_documents d
    WHERE d.tipo_dte IN ('01', '03')
      AND coalesce(d.invalidado, false) = false
      AND d.fecha_emision BETWEEN p_desde AND p_hasta
      AND NOT EXISTS (
        SELECT 1 FROM public.purchase_receipts pr
         WHERE pr.documento_numero = left(upper(d.codigo_generacion::text), 20)
      )
      -- Sin sucursal: los DTE llegan a una casilla de la empresa, no a una
      -- sucursal. Si se pide una sucursal concreta, no entran — no se les puede
      -- inventar una.
      AND p_branch_id IS NULL
  )
  SELECT t.* FROM (SELECT * FROM del_erp UNION ALL SELECT * FROM sin_compra) t,
       permitido p
   WHERE p.ok
     AND (p.scope = 'ALL' OR t.branch_id IS NULL OR t.branch_id = p.mi_sucursal)
   ORDER BY t.fecha, t.origen, t.documento_completo;
$function$;

