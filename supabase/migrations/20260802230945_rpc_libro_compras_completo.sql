SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- LIBRO DE COMPRAS COMPLETO — vista propia, NO reemplaza al libro actual.
--
-- El libro de `get_libro_compras` sale del ERP y se queda como esta: es el que
-- se compara contra el archivo del origen para confirmar que no sobra ni falta
-- nada — mismo contenido y mismo formato. Ese cotejo es su razon de ser y no se
-- toca.
--
-- Este otro responde una pregunta distinta: **que compro la farmacia de verdad**.
-- Medido sobre junio-julio 2026, el libro del ERP deja afuera 528 documentos con
-- $10,921.99 de credito fiscal, contra $49,525.79 declarados:
--
--   143 docs · $7,375.57  el proveedor tiene compras en el ERP pero ese CCF no
--                         esta, y no hay ninguna con ese monto ±3 dias
--   302 docs · $1,156.80  proveedores sin ninguna compra en el ERP (agua, luz,
--                         telefono, banco): gastos que nunca entran
--    83 docs · $2,389.62  la compra existe y el cruce por documento falla
--
-- DOS COSAS QUE ESTE LIBRO HACE MEJOR QUE EL ERP, a proposito:
--
--   · **El numero de documento va COMPLETO.** El ERP corta el codigo de
--     generacion a 20 caracteres y con eso su propio libro no puede identificar
--     sus documentos (H2: 778 de 875 filas en el tope). El portal tiene el
--     codigo entero en 658 de esas 875 porque el DTE llego por correo. Se
--     exporta el completo cuando se tiene, y el del ERP cuando no. Verificado
--     al aplicar: 1,167 de 1,384 filas de jun-jul salen con el codigo completo.
--   · **Cada fila dice de donde salio** (`origen`), para que la diferencia con
--     el libro del ERP sea auditable en vez de misteriosa.
--
-- LO QUE NO HACE: no resta las notas de credito. El ajuste del Art. 62 quedo
-- pendiente de confirmacion con el contador (2026-08-02) y meterlo aca sin esa
-- confirmacion seria inventar una tercera verdad.
--
-- LA DEDUPLICACION es por codigo de generacion truncado a 20, que es la unica
-- clave que los dos lados comparten. `sync-erp-purchases` ya advierte que ese
-- truncado "no siempre es unico", asi que el cruce exige ADEMAS que el NIT del
-- proveedor coincida — igual que en `ligar_notas_a_compras`.
-- ═══════════════════════════════════════════════════════════════════════════
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
    SELECT 'ERP'::text AS origen,
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
    SELECT 'DTE recibido'::text AS origen,
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

COMMENT ON FUNCTION public.get_libro_compras_completo(date, date, bigint) IS
  'El libro de compras con lo que la farmacia compro DE VERDAD: las compras del ERP mas los DTE recibidos por correo que no tienen compra registrada. NO reemplaza a get_libro_compras, que sale del ERP y sirve para cotejar contra el archivo del origen. Exporta el numero de documento COMPLETO (el ERP lo corta a 20 y con eso no identifica sus propios documentos) y marca el origen de cada fila. No resta notas de credito: el ajuste del Art. 62 esta pendiente de confirmacion con el contador.';

REVOKE EXECUTE ON FUNCTION public.get_libro_compras_completo(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_compras_completo(date, date, bigint) TO authenticated, service_role;

-- Permisos del modulo nuevo, copiados de los roles que ya ven libros_iva.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT rp.role_id, 'libro_compras_completo', rp.can_view, false, rp.scope
FROM public.role_permissions rp
WHERE rp.module_key = 'libros_iva'
ON CONFLICT (role_id, module_key) DO NOTHING;
