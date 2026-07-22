-- Fase 3.3 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md, regla CLAUDE.md #7):
-- email_sync_log no tenía retención — se suma al cron existente
-- purge-sync-logs-daily (jobid 172), mismos 90 días que sync_log/
-- inventory_sync_log. No aplica en staging: el branch no tiene pg_cron
-- jobs programados.
SELECT cron.alter_job(
  job_id := 172,
  command := $$
  DELETE FROM public.sync_log WHERE ran_at < now() - interval '90 days';
  DELETE FROM public.inventory_sync_log WHERE synced_at < now() - interval '90 days';
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '14 days';
  DELETE FROM public.login_rate_limit WHERE created_at < now() - interval '7 days';
  DELETE FROM public.email_sync_log WHERE checked_at < now() - interval '90 days';
  $$
);

-- purchase_dte_processed_messages: ledger anti-re-escaneo de Gmail, NUNCA
-- purgar (borrarlo forzaría re-escanear el historial completo desde
-- BACKFILL_FROM en la próxima corrida).
COMMENT ON TABLE public.purchase_dte_processed_messages IS
  'Ledger de mensajes de Gmail ya procesados por sync-purchase-emails — fuente única de "ya visto" para no re-escanear. NUNCA agregar a un cron de purga: borrar filas de acá hace que esos mensajes se re-escaneen desde Gmail en la próxima corrida (potencialmente el historial completo).';
