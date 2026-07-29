-- ============================================================================
-- BACKUP SEMANAL + OPTIMIZACIÓN DE REFRESCOS — 2026-07-02 (v2.2.462)
-- Aplicado vía MCP (refresh_schedule_and_backup_infra,
-- cron_backup_critical_tables_weekly). Registro consolidado en el repo.
-- ============================================================================

-- 1) Refrescos de estadísticas alineados al horario operativo (6am-11pm SV,
--    misma ventana 12-23,0-5 UTC que los syncs DTE). Antes corrían 24/7:
--    refresh_product_sales_monthly_agg 4.2s y refresh_sales_daily_stats 2.7s
--    cada 15 min — ~30% de ese costo era en horas muertas.
select cron.schedule('refresh-product-sales-monthly-agg', '*/15 12-23,0-5 * * *', 'SELECT public.refresh_product_sales_monthly_agg(3)');
select cron.schedule('refresh-sales-daily-stats', '*/15 12-23,0-5 * * *', 'SELECT public.refresh_sales_daily_stats(365)');

-- 2) Bucket privado 'backups' + RPC backup_dump_table(p_table) con whitelist
--    de 28 tablas de trabajo manual/config (empleados, permisos, min/max,
--    reglas de despacho, promociones, nómina, auditoría...). Solo service_role.
--    Los datos del ERP (ventas/inventario/productos) NO se exportan: se
--    recuperan por resync.

-- 3) Edge function backup-critical-tables: exporta cada tabla como JSON gzip a
--    backups/YYYY-MM-DD/tabla.json.gz, retención 60 días. Autenticada con
--    ADMIN_INVOKE_SECRET. Primer run verificado: 28/28 tablas, 1.16 MB.

-- 4) Cron semanal (domingos 08:00 UTC = 2am SV):
--    backup-critical-tables-weekly → net.http_post a la edge function.

-- (El DDL real vive en el historial de migraciones de Supabase.)
SELECT 1;
