-- A1 · Buscar en Ventas con rango de un año se caía por statement timeout.
--
-- `si.id IN (SELECT … FROM search_ventas_ids(…))`: el planificador estima una
-- función en 1,000 filas (el ROWS por defecto). Con ORDER BY fecha LIMIT 50
-- eso le hace creer que recorriendo el año por fecha llena las 50 enseguida,
-- así que elige barrer `idx_sales_invoices_fecha` hacia atrás y filtrar cada
-- factura contra el hash. Cuando la búsqueda devuelve pocas o ninguna —el caso
-- de quien escribe un nombre de producto— recorre las 192,554 facturas del año:
-- 70,420 bloques (550 MB) por llamada, 4.7 s en frío y ~28 s bajo carga.
-- El 21-sep fueron 47 intentos seguidos, todos cortados por timeout.
--
-- `= ANY (ARRAY(SELECT …))` convierte la búsqueda en un InitPlan que corre UNA
-- vez y deja al planificador entrar por la llave primaria. Mismo resultado
-- (los ids de search_ventas_ids son únicos), medido con literales:
--   sin coincidencias («EXFORGE HCT», año)   4,718 ms → 9.7 ms
--   11,031 coincidencias («maria», año)        594 ms → 618 ms
--   41,165 coincidencias («ma», año)         8,581 ms → 9,037 ms (lo caro ahí
--        es search_ventas_ids misma: dos letras no usan el índice de trigramas)
-- Las dos funciones se mueven juntas: son la lista y el encabezado de la misma
-- pantalla y tienen que describir el mismo conjunto.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_ventas_con_receta(p_fini date, p_ffin date, p_branch_id bigint DEFAULT NULL::bigint, p_anuladas text DEFAULT 'todas'::text, p_search text DEFAULT NULL::text, p_sort_col text DEFAULT 'fecha'::text, p_sort_dir text DEFAULT 'DESC'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_solo_receta boolean DEFAULT true)
 RETURNS TABLE(id bigint, branch_id bigint, erp_invoice_id text, correlativo text, tipo_documento text, fecha date, hora time without time zone, cliente text, cod_vendedor text, tipo_pago text, subtotal numeric, iva numeric, retencion numeric, total numeric, estado text, recibido_mh text, has_puntos boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
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
        WHEN 'correlativo'    THEN 'si.correlativo'
        WHEN 'tipo_documento' THEN 'si.tipo_documento'
        WHEN 'branch_id'      THEN 'si.branch_id'
        WHEN 'cod_vendedor'   THEN 'si.cod_vendedor'
        WHEN 'tipo_pago'      THEN 'si.tipo_pago'
        ELSE 'si.fecha'
    END;
    v_sort_dir := CASE WHEN lower(p_sort_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;

    -- La búsqueda va como `= ANY (ARRAY(…))` y NO como `IN (SELECT …)`: ver el
    -- encabezado de la migración ventas_busqueda_entra_por_llave. Con IN, una
    -- búsqueda sin coincidencias barría el rango entero por fecha.
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
         AND ($5::text IS NULL OR si.id = ANY (ARRAY(
               SELECT s.id FROM public.search_ventas_ids($5, $1, $2) s)))
         AND (NOT $8 OR si.id IN (
               SELECT ii.invoice_id
                 FROM public.sales_invoice_items ii
                WHERE ii.erp_product_id IN (
                      SELECT pr.id FROM public.products pr WHERE pr.es_antibiotico)))
       ORDER BY ' || v_sort_col || ' ' || v_sort_dir || ', si.fecha DESC, si.hora DESC LIMIT $6 OFFSET $7';

    RETURN QUERY EXECUTE v_sql
        USING p_fini, p_ffin, p_branch_id, p_anuladas, p_search, p_limit, p_offset, p_solo_receta;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ventas_receta_stats(p_fini date, p_ffin date, p_branch_id bigint DEFAULT NULL::bigint, p_anuladas text DEFAULT 'todas'::text, p_search text DEFAULT NULL::text, p_solo_receta boolean DEFAULT true)
 RETURNS TABLE(total_count bigint, total_sum numeric, total_puntos numeric, total_count_todas bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
    IF p_anuladas NOT IN ('todas', 'solo', 'excluir') THEN
        RAISE EXCEPTION 'p_anuladas invalido: % (esperado todas|solo|excluir)', p_anuladas;
    END IF;

    RETURN QUERY
    -- `base` es EXACTAMENTE lo que dibuja get_ventas_con_receta con los mismos
    -- argumentos. Si las dos dejan de coincidir, el encabezado vuelve a hablar
    -- de una lista que no es la que está en pantalla. `p_solo_receta` es el
    -- décimo argumento de aquélla y el sexto de ésta: se mueven juntos. Y la
    -- búsqueda va como `= ANY (ARRAY(…))` en las dos, por el mismo motivo.
    WITH base AS (
      SELECT si.id, si.total, si.estado
        FROM public.sales_invoices si
       WHERE si.fecha BETWEEN p_fini AND p_ffin
         AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
         AND (p_anuladas <> 'excluir' OR si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH'))
         AND (p_anuladas <> 'solo'    OR si.estado     IN ('NULA', 'DTE INVALIDADO EN MH'))
         AND (p_search IS NULL OR si.id = ANY (ARRAY(
               SELECT s.id FROM public.search_ventas_ids(p_search, p_fini, p_ffin) s)))
         AND (NOT p_solo_receta OR si.id IN (
               SELECT ii.invoice_id
                 FROM public.sales_invoice_items ii
                WHERE ii.erp_product_id IN (
                      SELECT pr.id FROM public.products pr WHERE pr.es_antibiotico)))
    ),
    -- Las que suman dinero. La excepción del alcance 'solo' es deliberada:
    -- cuando alguien enciende «Anuladas» está AUDITANDO las anuladas, y el
    -- número que quiere es cuánto se anuló. Dejarlo en $0 sería literal y
    -- también inútil.
    cuentan AS (
      SELECT b.id, b.total FROM base b
       WHERE p_anuladas = 'solo'
          OR b.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    ),
    -- Mismo criterio que get_puntos_canjeados: una factura puede traer varios
    -- renglones de canje y solo cuenta el mayor.
    puntos AS (
      SELECT DISTINCT ON (ii.invoice_id) ii.total_linea
        FROM public.sales_invoice_items ii
       WHERE ii.erp_product_id = 0
         AND ii.invoice_id IN (SELECT c.id FROM cuentan c)
       ORDER BY ii.invoice_id, ii.total_linea DESC
    )
    SELECT (SELECT count(*) FROM cuentan)::bigint,
           (SELECT coalesce(sum(c.total), 0)        FROM cuentan c),
           (SELECT coalesce(sum(pt.total_linea), 0) FROM puntos pt),
           (SELECT count(*) FROM base)::bigint;
END;
$function$;
