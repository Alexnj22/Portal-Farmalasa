SET lock_timeout = '5s';

-- "IVA cero" NO es "compra exenta". Era una regla traída del libro de VENTAS,
-- donde sí distingue; en compras no aplica.
--
-- Hallado el 2026-08-01 comparando junio contra el ERP: 11 de 12 branch-meses
-- cuadraban en las cinco columnas y uno no —Salud 4, un solo documento de
-- $2.55— y toda la diferencia estaba en qué columna lo ponía cada lado.
--
-- El JSON autoritativo del ERP dice:
--     {"sumas_gravadas": 2.55, "iva": 0, "percepcion_iva": 0, "total_operacion": 2.55}
-- y su libro lo imprime en GRAVADAS, con las tres columnas de exentas en 0.00.
--
-- O sea: **la fuente no tiene un monto exento que informar.** No hay campo de
-- exentas en el JSON de compras, y el libro del ERP nunca llena esas columnas.
-- Un documento con IVA cero es una compra gravada a la que el ERP le calculó
-- cero impuesto —dato sucio del proveedor, no una exención—, y clasificarla
-- como exenta movía plata de columna en un libro que se declara.
--
-- Entonces: gravadas = sumas_gravadas - percepción, SIEMPRE. Exentas queda en
-- cero, y no por suposición: es lo que la fuente informa. La columna se sigue
-- devolviendo porque el Art. 86 la pide y el CSV la necesita.

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
           0::numeric,   -- ver el encabezado: la fuente no informa exentas
           coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0),
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
