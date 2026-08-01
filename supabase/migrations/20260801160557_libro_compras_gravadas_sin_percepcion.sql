SET lock_timeout = '5s';

-- La columna de gravadas venía inflada por la percepción.
--
-- `descargar_compras_json.php` manda `totales.sumas_gravadas` **con la
-- percepción adentro** —cumple `sumas_gravadas + iva = total_operacion`— y el
-- libro del ERP la resta para llegar a la base gravada. Verificado al cuarto
-- decimal en Bodega el 2026-08-01:
--
--   LETERAGO  JSON 160.1740  perc 1.59  →  libro 158.58   (= 160.1740 - 1.59)
--   COFARSAL  JSON 613.6194  perc 6.08  →  libro 607.54   (= 613.6194 - 6.08)
--
-- Y la base del anexo de percepción del ERP es exactamente esa resta:
-- 607.5394 y 158.584, idénticas a `sumas_gravadas - percepcion_iva`.
--
-- Fiscalmente tiene sentido: la percepción (Art. 163 CT) es un anticipo que
-- cobra el proveedor, no parte de la base imponible. Va en el total del
-- documento y en su propia columna, no en las gravadas.
--
-- **Por qué no lo agarró la verificación de mayo 2025**: comparé documentos,
-- total, crédito fiscal y percepción —los cuatro cuadraban al centavo— pero no
-- la columna de gravadas. Cuadrar en casi todo no es cuadrar; lo delató una
-- captura de pantalla donde $613.62 con $6.08 de percepción no daba el 1%.
--
-- `coalesce(...,0)` para las filas viejas sin sincronizar: ahí no se sabe si
-- hubo percepción, pero esas filas la vista ya las marca en rojo por no tener
-- número de documento.

CREATE OR REPLACE FUNCTION public.get_libro_compras(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS TABLE (
    branch_id        bigint,
    fecha            date,
    documento_tipo   text,
    documento_numero text,
    proveedor        text,
    nrc              text,
    nit              text,
    compras_exentas  numeric,
    compras_gravadas numeric,
    credito_fiscal   numeric,
    total            numeric,
    percepcion_iva   numeric,
    retencion_iva    numeric,
    anulada          boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT pr.branch_id::bigint,
           pr.fecha,
           pr.documento_tipo,
           pr.documento_numero,
           pr.proveedor,
           nullif(btrim(coalesce(s.nrc, pm.nrc, '')), ''),
           nullif(btrim(coalesce(pm.nit, '')), ''),
           CASE WHEN coalesce(pr.iva, 0) = 0 THEN coalesce(pr.total, 0) ELSE 0 END,
           CASE WHEN coalesce(pr.iva, 0) > 0
                THEN coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0)
                ELSE 0 END,
           coalesce(pr.iva, 0),
           coalesce(pr.total, 0),
           pr.percepcion_iva,
           pr.retencion_iva,
           pr.estado = 'anulada'
    FROM public.purchase_receipts pr
    LEFT JOIN public.suppliers           s  ON s.id  = pr.supplier_id
    LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR pr.branch_id = (SELECT auth_employee_branch_id()))
      AND pr.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR pr.branch_id = p_branch_id)
      -- **Las anuladas NO se filtran**, y no es una decisión de estilo: el libro
      -- del ERP las incluye. Verificado en Bodega el 2026-07-20, que tiene una
      -- anulada de $254.89 — 28 documentos y $16,321.43 de los dos lados, al
      -- centavo. Filtrarlas habría dejado el libro corto sin que nada avisara.
      -- Se devuelven marcadas para que quien declara pueda verlas.
    ORDER BY pr.branch_id, pr.fecha, pr.documento_numero;
$$;
