-- Single-call RPC that returns MTD sales totals for all requested branches.
-- Replaces 6 separate get_ventas_stats calls from MetasView.
CREATE OR REPLACE FUNCTION public.get_branch_monthly_sales(
  p_fini date,
  p_ffin date,
  p_branch_ids integer[]
)
RETURNS TABLE(branch_id integer, total_sum numeric)
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path TO ''
AS $$
WITH
-- Past days: fast path from pre-aggregated daily stats
from_stats AS (
  SELECT branch_id, COALESCE(SUM(sum_total), 0) AS total
  FROM public.sales_daily_stats
  WHERE date >= p_fini
    AND date <  CURRENT_DATE
    AND date <= p_ffin
    AND branch_id = ANY(p_branch_ids)
  GROUP BY branch_id
),
-- Today: always live from invoices (supports intraday)
live AS (
  SELECT branch_id, COALESCE(SUM(total::numeric), 0) AS total
  FROM public.sales_invoices
  WHERE p_ffin >= CURRENT_DATE
    AND fecha >= GREATEST(p_fini, CURRENT_DATE)
    AND fecha <= p_ffin
    AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND branch_id = ANY(p_branch_ids)
  GROUP BY branch_id
)
SELECT
  b,
  COALESCE(s.total, 0) + COALESCE(l.total, 0) AS total_sum
FROM unnest(p_branch_ids) AS b
LEFT JOIN from_stats s ON s.branch_id = b
LEFT JOIN live      l ON l.branch_id = b
$$;

GRANT EXECUTE ON FUNCTION public.get_branch_monthly_sales(date, date, integer[]) TO authenticated;
