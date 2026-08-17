SET lock_timeout = '5s';

-- Corrige el PLAN de las dos funciones de la migración anterior. El resultado
-- no cambia; el tiempo sí: 8,471 ms → 31 ms en el rango de un año.
--
-- La versión anterior preguntaba `EXISTS (… WHERE ii.invoice_id = si.id …)`.
-- Al estar correlacionada con `si`, esa forma OBLIGA a entrar por las facturas:
-- recorre las ~180,000 del año y sondea los renglones una por una. Escrito como
-- `si.id IN (SELECT ii.invoice_id …)` —sin correlación— el planificador puede
-- entrar por el lado chico: los 79 productos bajo receta tienen 4,013 renglones
-- en TODA la historia, así que junta 3,655 ids con un Index Only Scan y después
-- busca esas facturas por su clave. Medido con `EXPLAIN (ANALYZE, TIMING OFF)`;
-- con el timing encendido el número miente por la instrumentación de las 3,655
-- vueltas del nested loop (marcaba 1,146 ms para un trabajo de 31).
--
-- O sea que las dos escrituras dicen lo mismo y sólo una se puede planificar
-- bien. Si alguna vez se toca este bloque, medir de nuevo: la diferencia no se
-- ve leyendo el SQL.

CREATE OR REPLACE FUNCTION public.get_ventas_con_receta(
    p_fini      date,
    p_ffin      date,
    p_branch_id bigint  DEFAULT NULL,
    -- 'todas' | 'solo' | 'excluir'. No es un booleano porque son TRES estados:
    -- la lista las mezcla, el chip «Anuladas» las aísla, y los totales las
    -- descuentan. Es exactamente lo que hacía el cliente antes de este cambio.
    p_anuladas  text    DEFAULT 'todas',
    p_search    text    DEFAULT NULL,
    p_sort_col  text    DEFAULT 'fecha',
    p_sort_dir  text    DEFAULT 'DESC',
    p_limit     integer DEFAULT 50,
    p_offset    integer DEFAULT 0
)
RETURNS TABLE(
    id bigint, branch_id bigint, erp_invoice_id text, correlativo text,
    tipo_documento text, fecha date, hora time without time zone, cliente text,
    cod_vendedor text, tipo_pago text, subtotal numeric, iva numeric,
    retencion numeric, total numeric, estado text, recibido_mh text,
    has_puntos boolean
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
    v_sort_col text;
    v_sort_dir text;
    v_sql      text;
BEGIN
    IF p_anuladas NOT IN ('todas', 'solo', 'excluir') THEN
        RAISE EXCEPTION 'p_anuladas invalido: % (esperado todas|solo|excluir)', p_anuladas;
    END IF;

    -- Whitelist: es lo ÚNICO que se concatena al SQL. Las claves son las de la
    -- tabla en pantalla, que no coinciden con los nombres de las columnas.
    v_sort_col := CASE p_sort_col
        WHEN 'fecha'          THEN 'si.fecha'
        WHEN 'id'             THEN 'si.id'
        WHEN 'tipo'           THEN 'si.tipo_documento'
        WHEN 'sucursal'       THEN 'si.branch_id'
        WHEN 'vendedor'       THEN 'si.cod_vendedor'
        WHEN 'cliente'        THEN 'si.cliente'
        WHEN 'metodo'         THEN 'si.tipo_pago'
        WHEN 'total'          THEN 'si.total'
        -- los nombres reales de columna también se aceptan
        WHEN 'correlativo'    THEN 'si.correlativo'
        WHEN 'tipo_documento' THEN 'si.tipo_documento'
        WHEN 'branch_id'      THEN 'si.branch_id'
        WHEN 'cod_vendedor'   THEN 'si.cod_vendedor'
        WHEN 'tipo_pago'      THEN 'si.tipo_pago'
        ELSE 'si.fecha'
    END;
    v_sort_dir := CASE WHEN lower(p_sort_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;

    v_sql := '
      SELECT si.id, si.branch_id, si.erp_invoice_id, si.correlativo,
             si.tipo_documento, si.fecha, si.hora, si.cliente,
             si.cod_vendedor, si.tipo_pago, si.subtotal, si.iva,
             si.retencion, si.total, si.estado, si.recibido_mh, si.has_puntos
        FROM public.sales_invoices si
       WHERE si.fecha BETWEEN $1 AND $2
         AND ($3::bigint IS NULL OR si.branch_id = $3::bigint)
         AND ($4 <> ''excluir'' OR si.estado NOT IN (''NULA'', ''DTE INVALIDADO EN MH''))
         AND ($4 <> ''solo''    OR si.estado     IN (''NULA'', ''DTE INVALIDADO EN MH''))
         AND ($5::text IS NULL OR si.id IN (
               SELECT s.id FROM public.search_ventas_ids($5, $1, $2) s))
         AND si.id IN (
               SELECT ii.invoice_id
                 FROM public.sales_invoice_items ii
                WHERE ii.erp_product_id IN (
                      SELECT pr.id FROM public.products pr WHERE pr.es_antibiotico))
       ORDER BY ' || v_sort_col || ' ' || v_sort_dir || ', si.fecha DESC, si.hora DESC LIMIT $6 OFFSET $7';

    RETURN QUERY EXECUTE v_sql
        USING p_fini, p_ffin, p_branch_id, p_anuladas, p_search, p_limit, p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ventas_receta_stats(
    p_fini      date,
    p_ffin      date,
    p_branch_id bigint DEFAULT NULL,
    p_anuladas  text   DEFAULT 'excluir',
    p_search    text   DEFAULT NULL
)
RETURNS TABLE(total_count bigint, total_sum numeric, total_puntos numeric)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
  WITH base AS (
    SELECT si.id, si.total
      FROM public.sales_invoices si
     WHERE si.fecha BETWEEN p_fini AND p_ffin
       AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
       AND (p_anuladas <> 'excluir' OR si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH'))
       AND (p_anuladas <> 'solo'    OR si.estado     IN ('NULA', 'DTE INVALIDADO EN MH'))
       AND (p_search IS NULL OR si.id IN (
             SELECT s.id FROM public.search_ventas_ids(p_search, p_fini, p_ffin) s))
       AND si.id IN (
             SELECT ii.invoice_id
               FROM public.sales_invoice_items ii
              WHERE ii.erp_product_id IN (
                    SELECT pr.id FROM public.products pr WHERE pr.es_antibiotico))
  ),
  -- Mismo criterio que get_puntos_canjeados: una factura puede traer varios
  -- renglones de canje y solo cuenta el mayor.
  puntos AS (
    SELECT DISTINCT ON (ii.invoice_id) ii.total_linea
      FROM public.sales_invoice_items ii
     WHERE ii.erp_product_id = 0
       AND ii.invoice_id IN (SELECT b.id FROM base b)
     ORDER BY ii.invoice_id, ii.total_linea DESC
  )
  SELECT (SELECT count(*) FROM base)::bigint,
         (SELECT coalesce(sum(b.total), 0)        FROM base b),
         (SELECT coalesce(sum(pt.total_linea), 0) FROM puntos pt);
$function$;
