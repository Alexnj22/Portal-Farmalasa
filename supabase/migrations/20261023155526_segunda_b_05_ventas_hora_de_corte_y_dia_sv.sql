SET lock_timeout = '5s';

-- Ventas: el «hoy» de El Salvador, la hora de corte en los dos períodos, y un
-- orden total para paginar (HC1, HC2, HC3, HC5).
-- HC1 · con hora, el ÚLTIMO día del rango se lee en vivo con hora <= corte, sea
--   hoy o no (antes un período anterior salía entero del pre-agregado).
-- HC2 · «hoy» = día de El Salvador, también en refresh_sales_daily_stats.
-- HC3 · desempate por si.id en las funciones que paginan.
-- HC5 · venta_valida (regla U2). Todas desde su definición VIVA (2026-10-23).

CREATE OR REPLACE FUNCTION public.get_ventas_stats(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_hora_corte time without time zone DEFAULT NULL::time without time zone)
 RETURNS TABLE(total_count bigint, total_sum numeric, total_count_todas bigint)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
WITH
h AS (
    SELECT (now() AT TIME ZONE 'America/El_Salvador')::date AS hoy
),
lim AS (
    SELECT h.hoy,
           LEAST(h.hoy, CASE WHEN p_hora_corte IS NOT NULL THEN p_ffin ELSE p_ffin + 1 END) AS hasta_agregado
    FROM h
),
coverage AS (
    SELECT MIN(date) AS since
    FROM public.sales_daily_stats
    WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
),
from_stats AS (
    SELECT
        COALESCE(SUM(count_valid), 0)::bigint AS cnt,
        COALESCE(SUM(sum_total), 0)           AS total
    FROM public.sales_daily_stats
    WHERE date >= GREATEST(p_fini, COALESCE((SELECT since FROM coverage), (SELECT hoy FROM lim)))
      AND date < (SELECT hasta_agregado FROM lim)
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
from_raw AS (
    SELECT
        COUNT(*)::bigint                 AS cnt,
        COALESCE(SUM(total::numeric), 0) AS total
    FROM public.sales_invoices
    WHERE fecha >= p_fini
      AND fecha <  LEAST(COALESCE((SELECT since FROM coverage), (SELECT hoy FROM lim)),
                         (SELECT hasta_agregado FROM lim))
      AND public.venta_valida(estado)
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
live AS (
    SELECT
        COUNT(*)                         AS cnt,
        COALESCE(SUM(total::numeric), 0) AS total
    FROM public.sales_invoices
    WHERE fecha >= GREATEST(p_fini, (SELECT hasta_agregado FROM lim))
      AND fecha <= p_ffin
      AND (fecha < p_ffin OR p_hora_corte IS NULL OR hora <= p_hora_corte)
      AND public.venta_valida(estado)
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
anuladas AS (
    SELECT COUNT(*)::bigint AS cnt
    FROM public.sales_invoices
    WHERE fecha >= p_fini
      AND fecha <= p_ffin
      AND (fecha < p_ffin OR p_hora_corte IS NULL OR hora <= p_hora_corte)
      AND NOT public.venta_valida(estado)
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
)
SELECT (s.cnt + r.cnt + l.cnt),
       (s.total + r.total + l.total),
       (s.cnt + r.cnt + l.cnt + a.cnt)
FROM from_stats s, from_raw r, live l, anuladas a;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_sales_daily_stats(p_days_back integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_from_date date;
    v_today     date;
    v_written   integer;
    v_has_history boolean;
BEGIN
    v_today := (now() AT TIME ZONE 'America/El_Salvador')::date;

    SELECT EXISTS(
        SELECT 1 FROM public.sales_daily_stats WHERE date <= v_today - 30
    ) INTO v_has_history;

    IF v_has_history THEN
        v_from_date := v_today - p_days_back;
    ELSE
        v_from_date := v_today - 365;
    END IF;

    WITH fresh AS (
        SELECT si.fecha AS date, si.branch_id,
               COUNT(*)::integer            AS count_valid,
               COALESCE(SUM(si.total::numeric), 0) AS sum_total
        FROM public.sales_invoices si
        WHERE si.fecha >= v_from_date
          AND si.fecha <  v_today
          AND public.venta_valida(si.estado)
        GROUP BY si.fecha, si.branch_id
    ),
    np AS (
        SELECT v.fecha AS date, v.branch_id,
               COALESCE(SUM(v.total::numeric), 0) AS sum_no_producto
        FROM public.ventas_sin_producto v
        WHERE v.fecha >= v_from_date AND v.fecha < v_today
        GROUP BY v.fecha, v.branch_id
    ),
    conjunto AS (
        SELECT f.date, f.branch_id, f.count_valid, f.sum_total,
               COALESCE(n.sum_no_producto, 0) AS sum_no_producto
        FROM fresh f
        LEFT JOIN np n ON n.date = f.date AND n.branch_id = f.branch_id
    ),
    del AS (
        DELETE FROM public.sales_daily_stats s
        WHERE s.date >= v_from_date AND s.date < v_today
          AND NOT EXISTS (SELECT 1 FROM conjunto f
                          WHERE f.date = s.date AND f.branch_id = s.branch_id)
        RETURNING 1
    ),
    ins AS (
        INSERT INTO public.sales_daily_stats (date, branch_id, count_valid, sum_total, sum_no_producto)
        SELECT date, branch_id, count_valid, sum_total, sum_no_producto FROM conjunto
        ON CONFLICT (date, branch_id) DO UPDATE
        SET count_valid     = EXCLUDED.count_valid,
            sum_total       = EXCLUDED.sum_total,
            sum_no_producto = EXCLUDED.sum_no_producto
        WHERE (sales_daily_stats.count_valid, sales_daily_stats.sum_total, sales_daily_stats.sum_no_producto)
              IS DISTINCT FROM (EXCLUDED.count_valid, EXCLUDED.sum_total, EXCLUDED.sum_no_producto)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM del) + (SELECT count(*) FROM ins) INTO v_written;

    RETURN v_written;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ventas_con_puntos(p_fini date, p_ffin date, p_branch_id bigint DEFAULT NULL::bigint, p_sort_col text DEFAULT 'fecha'::text, p_sort_dir text DEFAULT 'DESC'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id bigint, branch_id bigint, erp_invoice_id text, correlativo text, tipo_documento text, fecha date, hora time without time zone, cliente text, cod_vendedor text, tipo_pago text, subtotal numeric, iva numeric, total numeric, estado text, n bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_sort_col text; v_sort_dir text; v_sql text;
BEGIN
    v_sort_col := CASE p_sort_col
        WHEN 'fecha' THEN 'si.fecha' WHEN 'correlativo' THEN 'si.correlativo'
        WHEN 'tipo_documento' THEN 'si.tipo_documento' WHEN 'branch_id' THEN 'si.branch_id'
        WHEN 'cod_vendedor' THEN 'si.cod_vendedor' WHEN 'cliente' THEN 'si.cliente'
        WHEN 'tipo_pago' THEN 'si.tipo_pago' WHEN 'total' THEN 'si.total' ELSE 'si.fecha' END;
    v_sort_dir := CASE WHEN lower(p_sort_dir)='asc' THEN 'ASC' ELSE 'DESC' END;
    v_sql := format('WITH base AS (SELECT si.* FROM public.sales_invoices si
        WHERE si.has_puntos=true AND si.fecha BETWEEN %L AND %L
          AND public.venta_valida(si.estado)
          AND (%L::bigint IS NULL OR si.branch_id=%L::bigint) AND si.cliente NOT ILIKE ''%%MAPFRE%%''),
        total_cnt AS (SELECT COUNT(*) AS n FROM base)
        SELECT si.id,si.branch_id,si.erp_invoice_id,si.correlativo,si.tipo_documento,si.fecha,si.hora,
               si.cliente,si.cod_vendedor,si.tipo_pago,si.subtotal,si.iva,si.total,si.estado,c.n
        FROM base si CROSS JOIN total_cnt c ORDER BY %s %s,si.fecha DESC,si.hora DESC,si.id DESC LIMIT %s OFFSET %s',
        p_fini,p_ffin,p_branch_id,p_branch_id,v_sort_col,v_sort_dir,p_limit,p_offset);
    RETURN QUERY EXECUTE v_sql;
END;
$function$;

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
         AND ($4 <> ''excluir'' OR public.venta_valida(si.estado))
         AND ($4 <> ''solo''    OR NOT public.venta_valida(si.estado))
         AND ($5::text IS NULL OR si.id = ANY (ARRAY(
               SELECT s.id FROM public.search_ventas_ids($5, $1, $2) s)))
         AND (NOT $8 OR si.id IN (
               SELECT ii.invoice_id
                 FROM public.sales_invoice_items ii
                WHERE ii.erp_product_id IN (
                      SELECT pr.id FROM public.products pr WHERE pr.es_antibiotico)))
       ORDER BY ' || v_sort_col || ' ' || v_sort_dir || ', si.fecha DESC, si.hora DESC, si.id DESC LIMIT $6 OFFSET $7';

    RETURN QUERY EXECUTE v_sql
        USING p_fini, p_ffin, p_branch_id, p_anuladas, p_search, p_limit, p_offset, p_solo_receta;
END;
$function$;
