-- get_ventas_stats: la reescritura HC1 (segunda_b_05) le quitó a from_raw la
-- cota `fecha <= p_ffin`. Bajo RLS la cota armada con subselects queda como
-- filtro y no como índice, y un período pasado recorría el índice hasta hoy:
-- 110–125 ms y 280,527 filas descartadas. Se devuelve la cota redundante (y
-- `date BETWEEN` en from_stats). Mismo resultado en 7 casos; período pasado
-- 110 → 31 ms. Definición viva; sólo cambian esas dos líneas.
SET lock_timeout = '5s';

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
      AND date >= p_fini AND date <= p_ffin
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
      AND fecha <= p_ffin
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
