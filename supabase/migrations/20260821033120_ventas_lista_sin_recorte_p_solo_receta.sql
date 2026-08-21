SET lock_timeout = '5s';

-- La lista de Ventas deja de recortarse en 1,000, y el total de dinero deja de
-- calcularse sobre el recorte.
--
-- `search_ventas_ids` devuelve SETOF y el navegador la llamaba con
-- `supabase.rpc()` sin paginar. PostgREST corta en 1,000 sin avisar. Medido el
-- 2026-08-21 contra prod:
--     «maria» · Este mes         →    810 filas   (entra)
--     «maria» · Últimos 6 meses  →  7,540 filas   → el navegador ve 1,000
--     «maria» · Este año         →  9,777 filas   → el navegador ve 1,000
--     «jose»  · Este año         →  8,404 filas   → el navegador ve 1,000
--
-- Y no es sólo que falten filas: fetchInvoicesForStatsSpecial SUMA EL DINERO
-- sobre el conjunto recortado, así que el encabezado mostraba un conteo y un
-- monto que no eran los del período. Después la lista pintaba 200 de esos 1,000
-- arbitrarios — no «los 200 más recientes», los 200 primeros de un recorte que
-- nadie eligió. Y los 1,000 ids viajaban dentro de la URL del `.in()` siguiente:
-- 7,303 bytes medidos.
--
-- El arreglo YA EXISTE en el repo: get_ventas_con_receta / get_ventas_receta_stats
-- resuelven esto para la píldora «Receta Médica» — el conjunto lo arma la base y
-- search_ventas_ids se llama como SUBCONSULTA, donde el tope no aplica. Esas dos
-- se diferencian del camino normal en UNA línea: el filtro de antibióticos. Así
-- que en vez de escribir un par gemelo —la MISMA lista dicha dos veces, con toda
-- la deriva que eso trae— se les agrega `p_solo_receta boolean DEFAULT true`.
--
-- El DEFAULT true preserva byte por byte el comportamiento de todo llamador
-- actual: PostgREST resuelve por las claves del cuerpo y hoy nadie manda ese
-- parámetro.
--
-- Va DROP + CREATE y no CREATE OR REPLACE porque no se le pueden agregar
-- parámetros a una función existente: CREATE OR REPLACE dejaría DOS sobrecargas,
-- que es la basura que esta misma auditoría encontró en reclamar_impresion y
-- update_proveedor_manual. El DDL de Postgres es transaccional, así que DROP y
-- CREATE entran juntos y no hay instante con la función ausente.
--
-- Probado antes en el branch staging (cbnjplmnfmfsambavjce): quedó una sola
-- versión de cada una, sin sobrecargas duplicadas.

-- ── 1 · La lista ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_ventas_con_receta(date, date, bigint, text, text, text, text, integer, integer);

CREATE FUNCTION public.get_ventas_con_receta(
    p_fini         date,
    p_ffin         date,
    p_branch_id    bigint  DEFAULT NULL,
    p_anuladas     text    DEFAULT 'todas',
    p_search       text    DEFAULT NULL,
    p_sort_col     text    DEFAULT 'fecha',
    p_sort_dir     text    DEFAULT 'DESC',
    p_limit        integer DEFAULT 50,
    p_offset       integer DEFAULT 0,
    p_solo_receta  boolean DEFAULT true
)
RETURNS TABLE(id bigint, branch_id bigint, erp_invoice_id text, correlativo text,
              tipo_documento text, fecha date, hora time without time zone, cliente text,
              cod_vendedor text, tipo_pago text, subtotal numeric, iva numeric,
              retencion numeric, total numeric, estado text, recibido_mh text,
              has_puntos boolean)
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

REVOKE ALL ON FUNCTION public.get_ventas_con_receta(date, date, bigint, text, text, text, text, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ventas_con_receta(date, date, bigint, text, text, text, text, integer, integer, boolean) TO authenticated, service_role;

-- ── 2 · Los totales del encabezado ──────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_ventas_receta_stats(date, date, bigint, text, text);

CREATE FUNCTION public.get_ventas_receta_stats(
    p_fini        date,
    p_ffin        date,
    p_branch_id   bigint  DEFAULT NULL,
    p_anuladas    text    DEFAULT 'todas',
    p_search      text    DEFAULT NULL,
    p_solo_receta boolean DEFAULT true
)
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
    -- décimo argumento de aquélla y el sexto de ésta: se mueven juntos.
    WITH base AS (
      SELECT si.id, si.total, si.estado
        FROM public.sales_invoices si
       WHERE si.fecha BETWEEN p_fini AND p_ffin
         AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
         AND (p_anuladas <> 'excluir' OR si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH'))
         AND (p_anuladas <> 'solo'    OR si.estado     IN ('NULA', 'DTE INVALIDADO EN MH'))
         AND (p_search IS NULL OR si.id IN (
               SELECT s.id FROM public.search_ventas_ids(p_search, p_fini, p_ffin) s))
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

REVOKE ALL ON FUNCTION public.get_ventas_receta_stats(date, date, bigint, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ventas_receta_stats(date, date, bigint, text, text, boolean) TO authenticated, service_role;
