-- Chunked backfill for sales_daily_stats
--
-- Processes 5-day chunks going backwards from the earliest date already in
-- sales_daily_stats, one chunk per pg_cron tick (1 min). This keeps each run
-- well within statement timeout even on a cold NAS cache.
--
-- The function self-removes its cron job ('backfill-daily-stats') once coverage
-- reaches 185 days back (CURRENT_DATE - 185), so no manual cleanup needed.
--
-- Schedule (run once after deploying this migration):
--   SELECT cron.schedule('backfill-daily-stats', '* * * * *',
--                        'SELECT public.backfill_daily_stats_chunk()');

CREATE OR REPLACE FUNCTION public.backfill_daily_stats_chunk()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_today       date := CURRENT_DATE;
    v_target      date := CURRENT_DATE - 185;
    v_earliest    date;
    v_chunk_end   date;
    v_chunk_start date;
    v_inserted    integer;
BEGIN
    SELECT MIN(date) INTO v_earliest FROM public.sales_daily_stats;

    -- Stop when we have coverage going back 185 days
    IF v_earliest IS NOT NULL AND v_earliest <= v_target THEN
        PERFORM cron.unschedule('backfill-daily-stats');
        RETURN 'backfill complete, job removed';
    END IF;

    -- Work backwards: chunk_end is one day before the earliest we have
    v_chunk_end   := COALESCE(v_earliest, v_today - 7) - 1;
    v_chunk_start := GREATEST(v_chunk_end - 4, v_target);

    INSERT INTO public.sales_daily_stats (date, branch_id, count_valid, sum_total)
    SELECT
        si.fecha,
        si.branch_id,
        COUNT(*)::integer,
        COALESCE(SUM(si.total::numeric), 0)
    FROM public.sales_invoices si
    WHERE si.fecha BETWEEN v_chunk_start AND v_chunk_end
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    GROUP BY si.fecha, si.branch_id
    ON CONFLICT (date, branch_id) DO UPDATE
        SET count_valid = EXCLUDED.count_valid,
            sum_total   = EXCLUDED.sum_total;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN format('%s rows | %s → %s | earliest now %s',
                  v_inserted, v_chunk_start, v_chunk_end, v_chunk_start);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.backfill_daily_stats_chunk() TO postgres;
