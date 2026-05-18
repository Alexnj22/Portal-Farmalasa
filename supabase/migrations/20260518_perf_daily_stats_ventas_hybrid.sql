-- Pre-aggregate daily sales stats so get_ventas_stats never scans 126K+ raw rows
--
-- Root cause: get_ventas_stats for 6 months scans ~126K rows from sales_invoices.
-- Warm buffer cache: ~740ms. Cold NAS reads (first query of the day): 20-46s →
-- statement timeout. Fixing with a hybrid approach identical to product sales.
--
-- Architecture:
--   sales_daily_stats — stores (count, sum) per (date, branch_id) for past days
--   refresh_sales_daily_stats() — pg_cron target, refreshes last 365 past days
--   get_ventas_stats() — past days from daily_stats, today from raw table (live)
--
-- Warm-up: pg_cron runs on next 15-min tick and backfills 365 days of history.
--          The 7-day seed is inserted inline so common ranges work immediately.

CREATE TABLE IF NOT EXISTS public.sales_daily_stats (
    date         date    NOT NULL,
    branch_id    integer NOT NULL,
    count_valid  integer NOT NULL DEFAULT 0,
    sum_total    numeric NOT NULL DEFAULT 0,
    PRIMARY KEY (date, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_sds_date_branch
    ON public.sales_daily_stats (date, branch_id);

ALTER TABLE public.sales_daily_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read" ON public.sales_daily_stats
    FOR SELECT TO authenticated USING (true);

-- ── Refresh function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_sales_daily_stats(
    p_days_back integer DEFAULT 7
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_from_date   date;
    v_today       date;
    v_inserted    integer;
    v_has_history boolean;
BEGIN
    v_today := CURRENT_DATE;

    -- On first run (table lacks data going back 30+ days): do full 365-day backfill.
    -- On subsequent runs: only refresh the requested window (handles late corrections).
    SELECT EXISTS(
        SELECT 1 FROM public.sales_daily_stats WHERE date <= v_today - 30
    ) INTO v_has_history;

    IF v_has_history THEN
        v_from_date := v_today - p_days_back;
    ELSE
        v_from_date := v_today - 365;
    END IF;

    DELETE FROM public.sales_daily_stats
    WHERE date >= v_from_date AND date < v_today;

    INSERT INTO public.sales_daily_stats (date, branch_id, count_valid, sum_total)
    SELECT
        si.fecha,
        si.branch_id,
        COUNT(*)::integer,
        COALESCE(SUM(si.total::numeric), 0)
    FROM public.sales_invoices si
    WHERE si.fecha >= v_from_date
      AND si.fecha < v_today
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    GROUP BY si.fecha, si.branch_id;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.refresh_sales_daily_stats(integer) TO postgres;

-- ── pg_cron: refresh last 365 days every 15 min ──────────────────────────────
-- First run backfills full history (postgres role has no statement timeout).
-- Subsequent runs keep last 365 days fresh (handles late cancellations).

SELECT cron.schedule(
    'refresh-sales-daily-stats',
    '*/15 * * * *',
    'SELECT public.refresh_sales_daily_stats(365)'
);

-- ── Seed last 7 days immediately (don't wait for pg_cron) ────────────────────
INSERT INTO public.sales_daily_stats (date, branch_id, count_valid, sum_total)
SELECT fecha, branch_id, COUNT(*)::integer, COALESCE(SUM(total::numeric), 0)
FROM public.sales_invoices
WHERE fecha >= CURRENT_DATE - 7 AND fecha < CURRENT_DATE
  AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
GROUP BY fecha, branch_id
ON CONFLICT (date, branch_id) DO UPDATE
  SET count_valid = EXCLUDED.count_valid, sum_total = EXCLUDED.sum_total;

-- ── Drop old 3-arg overload (causes "function is not unique" error) ───────────
DROP FUNCTION IF EXISTS public.get_ventas_stats(date, date, integer);

-- ── Hybrid get_ventas_stats ───────────────────────────────────────────────────
-- 3-path query:
--   from_stats → sales_daily_stats for covered past days (instant after backfill)
--   from_raw   → raw sales_invoices for uncovered past days (bootstrap fallback;
--                becomes a 0-row index range scan once daily_stats is fully seeded)
--   live       → raw sales_invoices for today (real-time, supports hora_corte)

CREATE OR REPLACE FUNCTION public.get_ventas_stats(
    p_fini       date,
    p_ffin       date,
    p_branch_id  integer DEFAULT NULL::integer,
    p_hora_corte time    DEFAULT NULL::time
)
RETURNS TABLE(total_count bigint, total_sum numeric)
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
WITH
-- Earliest date in sales_daily_stats for this branch (NULL = table empty)
coverage AS (
    SELECT MIN(date) AS since
    FROM public.sales_daily_stats
    WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Fast path: past days already in daily_stats
from_stats AS (
    SELECT
        COALESCE(SUM(count_valid), 0)::bigint AS cnt,
        COALESCE(SUM(sum_total), 0)           AS total
    FROM public.sales_daily_stats
    WHERE date >= GREATEST(p_fini, COALESCE((SELECT since FROM coverage), CURRENT_DATE))
      AND date < CURRENT_DATE
      AND date <= p_ffin
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Fallback: raw scan for dates before daily_stats coverage.
-- After full backfill LEAST(since, CURRENT_DATE) <= p_fini → 0-row index range → free.
from_raw AS (
    SELECT
        COUNT(*)::bigint                 AS cnt,
        COALESCE(SUM(total::numeric), 0) AS total
    FROM public.sales_invoices
    WHERE fecha >= p_fini
      AND fecha <  LEAST(COALESCE((SELECT since FROM coverage), CURRENT_DATE), CURRENT_DATE)
      AND fecha <= p_ffin
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Today from raw tables (always live, supports hora_corte)
live AS (
    SELECT
        COUNT(*)                         AS cnt,
        COALESCE(SUM(total::numeric), 0) AS total
    FROM public.sales_invoices
    WHERE p_ffin >= CURRENT_DATE
      AND fecha  >= GREATEST(p_fini, CURRENT_DATE)
      AND (fecha < p_ffin OR (fecha = p_ffin AND (p_hora_corte IS NULL OR hora <= p_hora_corte)))
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
)
SELECT (s.cnt + r.cnt + l.cnt), (s.total + r.total + l.total)
FROM from_stats s, from_raw r, live l;
$function$;
