SET lock_timeout = '5s';

-- Los cuatro reportes que faltaban del grupo "Libros IVA" del ERP, generados
-- desde `purchase_receipts`.
--
-- Verificado el 2026-08-01 contra el ERP: `purchase_receipts` reproduce el libro
-- de compras del ERP día por día —23 de los 24 días de junio en Bodega idénticos
-- en conteo y monto antes de tocar nada, y las 5 sucursales que faltaban cuadran
-- exacto tras el backfill (Salud 1: 20 docs / $2,364.77, igual que el CSV).
--
-- Lo que el portal NO puede reproducir es el **sello de recepción**: el ERP lo
-- imprime en su libro pero no lo manda en `descargar_compras_json.php`
-- (verificado: cero cadenas de 40 caracteres en todo el payload), y
-- `purchase_dte_documents.sello_recibido` viene NULL en 633 de 634 documentos de
-- junio. Ninguna columna del Art. 86 lo pide, así que el libro sale completo —
-- pero conviene saber por qué esa columna del ERP acá no existe.
--
-- SECURITY DEFINER **con gate adentro**, igual que los libros de ventas: la
-- policy de `purchase_receipts` pide `compras.can_view`, así que un contador con
-- permiso de Libros IVA y nada más leería cero filas siendo INVOKER. El gate va
-- envuelto en `(SELECT ...)` para que Postgres lo evalúe una vez y no por fila
-- (incidente 2026-07-08).

-- ── Art. 86 — Libro de compras ─────────────────────────────────────────────
-- Una fila POR DOCUMENTO. Exenta = la que no generó crédito fiscal; es el mismo
-- criterio que el libro de ventas usa para separar exentas de gravadas, y sale
-- del dato en vez de asumirse.
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
           CASE WHEN coalesce(pr.iva, 0) = 0 THEN coalesce(pr.total, 0)    ELSE 0 END,
           CASE WHEN coalesce(pr.iva, 0) > 0 THEN coalesce(pr.subtotal, 0) ELSE 0 END,
           coalesce(pr.iva, 0),
           coalesce(pr.total, 0),
           pr.percepcion_iva,
           pr.retencion_iva,
           pr.estado = 'anulada'
    FROM public.purchase_receipts pr
    LEFT JOIN public.suppliers          s  ON s.id  = pr.supplier_id
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

-- ── Anexo de percepción (Art. 163 CT) ──────────────────────────────────────
-- No es una fuente aparte: es el subconjunto del libro de compras con
-- percepción > 0. Verificado contra el ERP en junio 2026 — 7 + 2 + 6 + 211 =
-- 226 filas, exactamente las 226 del anexo del ERP.
CREATE OR REPLACE FUNCTION public.get_libro_percepcion(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS TABLE (
    branch_id        bigint,
    fecha            date,
    proveedor        text,
    nrc              text,
    nit              text,
    documento_tipo   text,
    documento_numero text,
    monto_sujeto     numeric,
    percepcion_iva   numeric,
    anulada          boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    -- Tampoco se filtran las anuladas acá, por coherencia con el libro del que
    -- salen: no tengo cómo verificar qué hace el ERP en su anexo (no hay ni una
    -- anulada con percepción en la historia), y esconder una fila que el libro
    -- sí muestra es justo la clase de filtro silencioso que en los libros de
    -- ventas costó $282.58 de diferencia sin explicación. Van marcadas.
    SELECT l.branch_id, l.fecha, l.proveedor, l.nrc, l.nit,
           l.documento_tipo, l.documento_numero,
           l.compras_gravadas, l.percepcion_iva, l.anulada
    FROM public.get_libro_compras(p_desde, p_hasta, p_branch_id) l
    WHERE coalesce(l.percepcion_iva, 0) > 0
    ORDER BY l.branch_id, l.fecha, l.documento_numero;
$$;

-- ── Anexo de retención (Art. 162 CT) ───────────────────────────────────────
-- Hoy sale vacío y eso es lo correcto: el ERP tampoco tiene una sola fila entre
-- 2025-01 y 2026-07 en las 7 sucursales (verificado). La farmacia no es agente
-- de retención. El reporte existe para poder declararlo en cero y para el día
-- que sí haya una.
CREATE OR REPLACE FUNCTION public.get_libro_retencion(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS TABLE (
    branch_id        bigint,
    fecha            date,
    proveedor        text,
    nrc              text,
    nit              text,
    documento_tipo   text,
    documento_numero text,
    monto_sujeto     numeric,
    retencion_iva    numeric,
    anulada          boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT l.branch_id, l.fecha, l.proveedor, l.nrc, l.nit,
           l.documento_tipo, l.documento_numero,
           l.compras_gravadas, l.retencion_iva, l.anulada
    FROM public.get_libro_compras(p_desde, p_hasta, p_branch_id) l
    WHERE coalesce(l.retencion_iva, 0) > 0
    ORDER BY l.branch_id, l.fecha, l.documento_numero;
$$;

-- ── Reporte de sujeto excluido (Art. 119 CT) ───────────────────────────────
-- El filtro es la CLASE DE DOCUMENTO, no "proveedor sin NRC". Son cosas
-- distintas y confundirlas llenaría el reporte de falsos positivos: hoy hay 2
-- proveedores con NRC vacío en `suppliers` (20 documentos), pero los 20 son CCF
-- — o sea proveedores inscritos a los que les falta el dato, no sujetos
-- excluidos. El ERP no registra ni una Factura de Sujeto Excluido en toda su
-- historia, así que este reporte sale vacío en los dos lados.
CREATE OR REPLACE FUNCTION public.get_libro_sujeto_excluido(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS TABLE (
    branch_id        bigint,
    fecha            date,
    proveedor        text,
    nit              text,
    dui              text,
    documento_numero text,
    total            numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT pr.branch_id::bigint, pr.fecha, pr.proveedor,
           nullif(btrim(coalesce(pm.nit, '')), ''),
           nullif(btrim(coalesce(pm.dui, '')), ''),
           pr.documento_numero,
           coalesce(pr.total, 0)
    FROM public.purchase_receipts pr
    LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR pr.branch_id = (SELECT auth_employee_branch_id()))
      AND pr.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR pr.branch_id = p_branch_id)
      AND pr.documento_tipo IN ('FSE', 'SUJETO EXCLUIDO')
      AND coalesce(pr.estado, '') <> 'anulada'
    ORDER BY pr.branch_id, pr.fecha, pr.documento_numero;
$$;

REVOKE EXECUTE ON FUNCTION public.get_libro_compras(date, date, bigint)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_percepcion(date, date, bigint)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_retencion(date, date, bigint)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_sujeto_excluido(date, date, bigint)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_compras(date, date, bigint)          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_libro_percepcion(date, date, bigint)       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_libro_retencion(date, date, bigint)        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_libro_sujeto_excluido(date, date, bigint)  TO authenticated, service_role;
