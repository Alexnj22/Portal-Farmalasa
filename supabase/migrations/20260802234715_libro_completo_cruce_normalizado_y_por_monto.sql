SET lock_timeout = '5s';

-- ===========================================================================
-- El cruce del libro completo: dos caminos, y por que no hay un tercero.
--
-- HISTORIA DE ESTE ARREGLO, porque la conclusion intermedia fue equivocada y
-- conviene que quede escrita para que nadie la repita:
--
--   1. La primera version cruzaba SOLO por `documento_numero = left(cg,20)`.
--   2. Al ver que `documento_numero` guarda tres cosas distintas —codigo de
--      generacion (733 filas), numero de CONTROL (56) y el correlativo del
--      proveedor (27)— parecia que faltaba cruzar por numero de control, y que
--      eso bajaba lo "sin registrar" de $7,375 a $1,581.
--   3. ERA FALSO. Un numero de control mide 31 caracteres y el ERP lo guarda
--      cortado a 20, que es justo donde vive el correlativo: los 1,180 DTE de
--      junio-julio tienen 1,171 numeros de control distintos, y truncados a 20
--      quedan 48 CLAVES. Cruzar por ahi junta ~25 documentos ajenos en cada
--      una. Verificado contando las claves distintas, no asumido.
--
-- Entonces los caminos que SI sirven son dos:
--
--   1. CODIGO DE GENERACION — 36 caracteres, unico por documento. Es la clave
--      real. Se compara normalizando el documento del ERP: hay filas con un
--      espacio adentro (`9D063633- C6`), con punto final (`13130.`) y con la
--      letra O donde va un cero (`4999COBE-B30`). Un codigo de generacion es
--      hexadecimal, asi que una O siempre es un cero mal tecleado.
--   2. PROVEEDOR + MONTO EXACTO +-3 DIAS — es una HEURISTICA, no una prueba, y
--      por eso va ultima. Recupera 81 documentos ($2,356.14 de credito) que
--      estan registrados con un numero que no es su codigo de generacion. Sin
--      ella el libro los muestra como "sin registrar" y son falsos positivos.
--
-- Lo que queda sin cruzar en junio-julio son 445 documentos y $8,532.37 de
-- credito fiscal. Ese numero NO es "plata segura": que no aparezca una compra
-- con ese monto no prueba que no exista, y el Art. 65-A pide que el gasto sea
-- indispensable para el giro. Es el techo, y hay que revisarlo documento por
-- documento antes de reclamar nada. El aviso de la vista lo dice.
--
-- Verificado al aplicar: la rama `registrada` da $49,525.79, identico al libro
-- del Art. 86. La rama `solo_documento` baja de 528 documentos / $10,921.99 a
-- 445 / $8,532.37 — se fueron 83 falsos positivos por $2,389.62.
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
    SELECT pr.id, pr.supplier_id, pr.total, pr.fecha,
           upper(replace(replace(replace(btrim(pr.documento_numero), ' ', ''), '.', ''), 'O', '0')) AS doc
    FROM public.purchase_receipts pr
    WHERE length(btrim(coalesce(pr.documento_numero, ''))) >= 8
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
       WHERE upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0'))
             IN (left(upper(d.codigo_generacion::text), 20),
                 left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                 upper(d.codigo_generacion::text))
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
      -- Camino 1: el codigo de generacion, normalizado.
      AND NOT EXISTS (
        SELECT 1 FROM compras_norm c
         WHERE c.doc IN (left(upper(d.codigo_generacion::text), 20),
                         left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                         upper(d.codigo_generacion::text))
      )
      -- Camino 2: proveedor + monto exacto +-3 dias. Heuristica deliberada: sin
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
