SET lock_timeout = '5s';

-- Los libros de IVA de ventas, generados desde `sales_invoices`.
--
-- Verificado el 2026-07-31 contra los libros del ERP: 7 sucursales × 3 meses
-- (abr/may/jun 2026), 84 CSV. CCF 18/18 branch-meses exactos en conteo y monto;
-- consumidor 18/18 exactos; anulados 204 documentos con el md5 del conjunto
-- ordenado de `codigo_generacion` idéntico en ambos lados — identidad, no sólo
-- conteo.
--
-- **El filtro del sello es el que cierra la diferencia.** Sin él sobraban
-- $282.58 en 6 branch-meses, y cada diferencia era exactamente la suma de las
-- facturas con `recibido_mh` inválido. Una factura FINALIZADA sin sello de 40
-- caracteres no llegó a Hacienda: no va en el libro.
--
-- SECURITY DEFINER **con gate adentro**: la policy de `sales_invoices` pide
-- `ventas.can_view`, así que un contador con permiso de Libros IVA y nada más
-- leería cero filas siendo INVOKER. El gate es el mismo que la policy haría —
-- permiso de módulo + scope de sucursal— y va envuelto en `(SELECT ...)` porque
-- sin el initplan Postgres lo evalúa POR FILA (incidente 2026-07-08).

-- ── Art. 83 — Libro de operaciones de ventas a consumidores ────────────────
-- Una fila POR DÍA, con el rango de correlativos del→al. Los correlativos son
-- texto con ceros a la izquierda y sufijo fijo, así que min/max lexicográfico
-- es el rango real (verificado contra el ERP).
CREATE OR REPLACE FUNCTION public.get_libro_ventas_consumidor(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS TABLE (
    branch_id       bigint,
    fecha           date,
    correlativo_del text,
    correlativo_al  text,
    documentos      bigint,
    ventas_exentas  numeric,
    ventas_gravadas numeric,
    exportaciones   numeric,
    total_diario    numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT si.branch_id,
           si.fecha,
           min(si.correlativo),
           max(si.correlativo),
           count(*),
           -- Exenta = la que no generó IVA. La farmacia vende gravado casi
           -- todo, así que en la práctica esta columna va en cero — pero se
           -- calcula, no se asume: el día que entre un producto exento el libro
           -- lo refleja solo.
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) = 0), 0),
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) > 0), 0),
           0::numeric,   -- exportaciones: no hay operaciones de exportación
           coalesce(sum(si.total), 0)
    FROM public.sales_invoices si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento = 'COF'
      AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    GROUP BY si.branch_id, si.fecha
    ORDER BY si.branch_id, si.fecha;
$$;

-- ── Art. 85 — Libro de operaciones de ventas a contribuyentes ──────────────
-- Una fila POR DOCUMENTO. `nrc` sale de `customers` y hoy viene NULL en todas:
-- la columna existe desde la migración anterior pero el dato todavía no se
-- captura del receptor del DTE. La vista lo muestra como faltante — en blanco
-- y sin aviso sería un libro que parece completo y no lo está.
CREATE OR REPLACE FUNCTION public.get_libro_ventas_contribuyente(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS TABLE (
    branch_id         bigint,
    fecha             date,
    correlativo       text,
    codigo_generacion uuid,
    cliente           text,
    nrc               text,
    nit               text,
    ventas_exentas    numeric,
    ventas_gravadas   numeric,
    debito_fiscal     numeric,
    total             numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT si.branch_id,
           si.fecha,
           si.correlativo,
           si.codigo_generacion,
           si.cliente,
           nullif(btrim(coalesce(c.nrc, '')), ''),
           nullif(btrim(coalesce(c.nit, '')), ''),
           CASE WHEN coalesce(si.iva, 0) = 0 THEN coalesce(si.total, 0)    ELSE 0 END,
           CASE WHEN coalesce(si.iva, 0) > 0 THEN coalesce(si.subtotal, 0) ELSE 0 END,
           coalesce(si.iva, 0),
           coalesce(si.total, 0)
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento = 'CCF'
      AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha, si.correlativo;
$$;

-- ── Anexo de documentos anulados ───────────────────────────────────────────
-- `NULA` NO entra: su `codigo_generacion` es NULL porque nunca llegó a
-- Hacienda. Anulado es el DTE que sí se emitió y después se invalidó.
CREATE OR REPLACE FUNCTION public.get_libro_anulados(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS TABLE (
    branch_id         bigint,
    fecha             date,
    tipo_documento    text,
    correlativo       text,
    codigo_generacion uuid,
    cliente           text,
    total             numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT si.branch_id, si.fecha, si.tipo_documento, si.correlativo,
           si.codigo_generacion, si.cliente, coalesce(si.total, 0)
    FROM public.sales_invoices si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.estado = 'DTE INVALIDADO EN MH'
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha, si.correlativo;
$$;

REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_anulados(date, date, bigint)             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint)    TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_libro_anulados(date, date, bigint)             TO authenticated, service_role;
