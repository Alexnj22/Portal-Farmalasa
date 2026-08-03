SET lock_timeout = '5s';

-- ===========================================================================
-- C2 — el sello como camino de cruce. Y por que NO reemplaza al del documento.
--
-- El plan prometia que el sello «reemplaza el 86.7% difuso por 100% donde ambos
-- lados lo tengan». La segunda mitad de esa frase es la que importa, y medida
-- resulta que hoy NO se cumple:
--
--   El sello del lado DTE empezo a capturarse a mitad de julio.
--   junio 0% · julio 31% · agosto 100%.
--
-- Con eso, sobre el 22-31 de julio el cruce por sello da 90 y el de documento
-- 127. El sello es mejor CLAVE —40 caracteres, unico por documento, sin
-- truncar— pero el portal todavia no lo tiene en suficientes documentos.
-- Reemplazar el cruce viejo por este habria EMPEORADO el resultado.
--
-- Entonces el sello entra como camino ADICIONAL, antes de la heuristica de monto
-- porque es exacto. Medido sobre julio-agosto: el documento cruza 385 de 486, y
-- el sello suma 13 mas (398). Poco hoy, y va a crecer solo: agosto ya esta al
-- 100% del lado DTE.
--
-- Verificado tras aplicar: lo "sin registrar" de junio-julio baja de 445
-- documentos / $8,532.37 a 436 / $8,184.31, y la rama registrada sigue en
-- $49,525.79 — identica al libro del Art. 86.
-- ===========================================================================
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
  -- El documento del ERP, limpio de lo que se teclea mal.
  compras_norm AS (
    SELECT pr.id, pr.supplier_id, pr.total, pr.fecha, pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero), ' ', ''), '.', ''), 'O', '0')) AS doc
    FROM public.purchase_receipts pr
    WHERE (length(btrim(coalesce(pr.documento_numero, ''))) >= 8
           OR pr.sello_recibido IS NOT NULL)
      AND pr.fecha BETWEEN p_desde - 5 AND p_hasta + 5
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
       WHERE (
               -- C2: el sello primero. Es exacto y no viene truncado.
               (pr.sello_recibido IS NOT NULL AND d.sello_recibido = pr.sello_recibido)
            OR upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0'))
               IN (left(upper(d.codigo_generacion::text), 20),
                   left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                   upper(d.codigo_generacion::text))
             )
         AND (pm.nit IS NULL OR d.emisor_nit = pm.nit)
         AND coalesce(d.invalidado, false) = false
       -- El que cruza por sello gana: es la clave exacta.
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
           false AS anulada,
           true AS tiene_dte
    FROM public.purchase_dte_documents d
    WHERE d.tipo_dte IN ('01', '03')
      AND coalesce(d.invalidado, false) = false
      AND d.fecha_emision BETWEEN p_desde AND p_hasta
      -- Camino 1: el SELLO. Exacto, 40 caracteres, sin truncar.
      AND NOT EXISTS (
        SELECT 1 FROM compras_norm c
         WHERE d.sello_recibido IS NOT NULL AND c.sello_recibido = d.sello_recibido
      )
      -- Camino 2: el codigo de generacion, normalizado.
      AND NOT EXISTS (
        SELECT 1 FROM compras_norm c
         WHERE c.doc IN (left(upper(d.codigo_generacion::text), 20),
                         left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                         upper(d.codigo_generacion::text))
      )
      -- Camino 3: proveedor + monto exacto +-3 dias. Heuristica deliberada: sin
      -- ella, 81 documentos que SI estan registrados (con otro numero) se
      -- mostrarian como faltantes.
      AND NOT EXISTS (
        SELECT 1 FROM public.purchase_receipts pr
          JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
         WHERE pm.nit = d.emisor_nit
           AND abs(pr.total - coalesce(d.monto_total, 0)) < 0.01
           AND pr.fecha BETWEEN d.fecha_emision - 3 AND d.fecha_emision + 3
      )
      AND p_branch_id IS NULL
  )
  SELECT t.* FROM (SELECT * FROM del_erp UNION ALL SELECT * FROM sin_compra) t,
       permitido p
   WHERE p.ok
     AND (p.scope = 'ALL' OR t.branch_id IS NULL OR t.branch_id = p.mi_sucursal)
   ORDER BY t.fecha, t.origen, t.documento_completo;
$function$;
