SET lock_timeout = '5s';

-- Auditoría columna por columna de los tres libros de ventas contra el CSV del
-- ERP (2026-08-01). El de contribuyentes ya se corrigió; estos dos arrastraban
-- lo mismo: **el dato estaba guardado y la función no lo devolvía.**
--
-- CONSUMIDOR FINAL — fila del ERP, Salud 1, 01-07-2026:
--   [ 3] DTE01S003P001000000000030769   número de control del primero  ← NO existe
--   [ 4] 202641946FAF...XM4C            sello del primero              ← sí
--   [ 5] 319374   [ 6] 320050           id ERP del primero y del último← sí
--   [ 7] 04E88178...  [ 8] FCA05840...  código de generación DEL y AL  ← sí
--   [14] 1277.85  [20] 1277.85          gravadas y total del día       ← sí
--
-- ANULADOS — fila del ERP, Salud 1, julio:
--   [ 0] DTE01S003P001000000000030846   número de control              ← NO existe
--   [ 6] 20264A9A7D27...BA3KI           sello de recepción             ← sí
--   [ 9] EAE8CBF60E85...7870            código de generación           ← sí
--   (el ERP NO trae fecha, cliente ni total: ahí el portal da más)
--
-- El "del → al" del libro de consumidor se ordena por CORRELATIVO, no por el
-- UUID: `min()/max()` sobre un codigo_generacion daría el menor y mayor
-- hexadecimal, que no tienen nada que ver con el primero y el último documento
-- del día. Por eso `array_agg(... ORDER BY correlativo)`.
--
-- Lo único que sigue faltando es el número de control, que no viene en
-- `descarga_dte_emitidos_json.php` ni se puede derivar del correlativo interno.
-- Queda pendiente a propósito: necesita columna en `sales_invoices` (tabla
-- caliente) y su fuente natural —`downloads/dteqr_json.php`— está rota en el
-- servidor del proveedor (escribe en `../jsondte/`, que no existe).

-- ── Art. 83 — consumidores ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_libro_ventas_consumidor(date, date, bigint);

CREATE FUNCTION public.get_libro_ventas_consumidor(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS TABLE (
    branch_id       bigint,
    fecha           date,
    correlativo_del text,
    correlativo_al  text,
    codigo_gen_del  uuid,
    codigo_gen_al   uuid,
    sello_del       text,
    erp_id_del      text,
    erp_id_al       text,
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
           (array_agg(si.codigo_generacion ORDER BY si.correlativo))[1],
           (array_agg(si.codigo_generacion ORDER BY si.correlativo DESC))[1],
           (array_agg(si.recibido_mh       ORDER BY si.correlativo))[1],
           (array_agg(si.erp_invoice_id    ORDER BY si.correlativo))[1],
           (array_agg(si.erp_invoice_id    ORDER BY si.correlativo DESC))[1],
           count(*),
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) = 0), 0),
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) > 0), 0),
           0::numeric,
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

-- ── Anexo de anulados ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_libro_anulados(date, date, bigint);

CREATE FUNCTION public.get_libro_anulados(
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
    sello_recepcion   text,
    erp_invoice_id    text,
    cliente           text,
    total             numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT si.branch_id, si.fecha, si.tipo_documento, si.correlativo,
           si.codigo_generacion, si.recibido_mh, si.erp_invoice_id,
           si.cliente, coalesce(si.total, 0)
    FROM public.sales_invoices si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.estado = 'DTE INVALIDADO EN MH'
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha, si.correlativo;
$$;

REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_anulados(date, date, bigint)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_libro_anulados(date, date, bigint)          TO authenticated, service_role;
