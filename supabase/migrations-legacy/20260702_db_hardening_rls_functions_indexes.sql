-- ============================================================================
-- DB HARDENING COMPLETO — 2026-07-02 (v2.2.460)
-- Aplicado vía MCP apply_migration en 7 bloques. Este archivo es el registro
-- consolidado en el repo. Resultado: advisor de seguridad 199 → 108 hallazgos,
-- ERRORES 14 → 0. Cero cambios de datos de negocio.
-- ============================================================================

-- ── BLOQUE 1: RLS en las 9 tablas que estaban abiertas (advisor ERROR) ──────
-- Policies dimensionadas al uso real del portal:
--   escritura frontend  → FOR ALL to authenticated
--   lectura frontend / RPC INVOKER → FOR SELECT to authenticated
-- anon queda sin acceso en todas.
ALTER TABLE public.lab_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_locations_auth_all ON public.lab_locations FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.minmax_ignored ENABLE ROW LEVEL SECURITY;
CREATE POLICY minmax_ignored_auth_all ON public.minmax_ignored FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.overtime_bank ENABLE ROW LEVEL SECURITY;
CREATE POLICY overtime_bank_auth_all ON public.overtime_bank FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.vacation_plan_headers ENABLE ROW LEVEL SECURITY;
CREATE POLICY vacation_plan_headers_auth_all ON public.vacation_plan_headers FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.stock_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_config_auth_all ON public.stock_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.erp_sucursal_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_sucursal_map_auth_read ON public.erp_sucursal_map FOR SELECT TO authenticated USING (true);
ALTER TABLE public.product_last_sale ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_last_sale_auth_read ON public.product_last_sale FOR SELECT TO authenticated USING (true);
ALTER TABLE public.product_sales_monthly_agg ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_sales_monthly_agg_auth_read ON public.product_sales_monthly_agg FOR SELECT TO authenticated USING (true);
ALTER TABLE public.sales_alert_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_alert_log_auth_read ON public.sales_alert_log FOR SELECT TO authenticated USING (true);

-- ── BLOQUE 2: vistas a security_invoker (respetan RLS del consultante) ──────
ALTER VIEW public.employee_timeline SET (security_invoker = true);
ALTER VIEW public.product_cost_history SET (security_invoker = true);
ALTER VIEW public.product_purchase_summary SET (security_invoker = true);
ALTER VIEW public.products_with_lab SET (security_invoker = true);
ALTER VIEW public.v_product_factor SET (security_invoker = true);

-- ── BLOQUE 3: funciones SECURITY DEFINER fuera del alcance de anon/PUBLIC ───
-- 32 funciones: REVOKE FROM PUBLIC, anon + GRANT a authenticated, service_role.
-- Excepciones (pre-login kiosco, validan device token internamente):
--   get_kiosk_boot_payload, get_kiosk_coverage_employees
DO $$
DECLARE fn text; r record;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'anular_pedido','attendance_kiosko_pedido_lifecycle','backfill_daily_stats_chunk',
    'calculate_stock_params','confirm_pedido','crear_ruta','debug_pedido_timings',
    'discard_stock_drafts','fn_psp_capture_history','get_draft_cost_estimate',
    'get_logistics_chief_ids','get_minmax_approver_ids','get_pausa_razones_stats',
    'get_pedido_diferencias_stats','get_pedido_item_stats','get_pedido_kpis',
    'get_pedido_sin_bodega','get_pedido_sucursal_stats','get_pedidos_en_curso',
    'get_stock_analysis_count','init_pedido_sucursal_codigos','marcar_pedido_enviado',
    'notify_missing_roster','notify_push_on_announcement','publish_stock_params',
    'receive_pedido_sucursal','refresh_product_sales_monthly_agg','refresh_sales_daily_stats',
    'resolve_pedido_item','save_pedido_snapshot','update_pedido_sucursal_lifecycle',
    'zero_out_product_all_branches'
  ]
  LOOP
    FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    END LOOP;
  END LOOP;
END $$;

-- ── BLOQUE 4: search_path fijo en todas las funciones propias (47) ──────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fnsig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND (p.proconfig IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.fnsig);
  END LOOP;
END $$;

-- ── BLOQUE 5: MVs fuera de la API + drop de MV muerta ───────────────────────
-- mv_product_factor conserva SELECT de authenticated: get_pedido_preview es
-- SECURITY INVOKER y la lee con los permisos del usuario.
REVOKE ALL ON public.inventory_grouped_mv FROM anon, authenticated;
REVOKE ALL ON public.mv_stock_analysis FROM anon, authenticated;
REVOKE ALL ON public.mv_product_factor FROM anon;
DROP MATERIALIZED VIEW IF EXISTS public.mv_product_last_sale;

-- ── BLOQUE 6: índices FK + limpieza de índices nunca usados (~36 MB) ────────
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_branch ON public.purchase_receipts(branch_id);
CREATE INDEX IF NOT EXISTS idx_pedido_items_erp_pres ON public.pedido_items(erp_presentacion_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_rules_pres ON public.dispatch_rules(dispatch_id_presentacion);
CREATE INDEX IF NOT EXISTS idx_minmax_ignored_product ON public.minmax_ignored(erp_product_id);
CREATE INDEX IF NOT EXISTS idx_vacation_plans_header ON public.vacation_plans(plan_header_id);
CREATE INDEX IF NOT EXISTS idx_promotion_products_receipt ON public.promotion_products(receipt_id);
CREATE INDEX IF NOT EXISTS idx_promotion_products_pres ON public.promotion_products(presentacion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_payments_promo ON public.promotion_payments(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotions_lab ON public.promotions(laboratorio_id);
-- 0 lecturas en toda la vida de la BD (stats nunca reseteadas); reversibles.
-- sales_invoices_customer_id_idx se CONSERVA (FK + facturación futura).
DROP INDEX IF EXISTS public.idx_inventory_desc_trgm;
DROP INDEX IF EXISTS public.idx_si_branch_estado;
DROP INDEX IF EXISTS public.audit_logs_details_gin;
DROP INDEX IF EXISTS public.audit_logs_source_severity_created_idx;
DROP INDEX IF EXISTS public.audit_logs_branch_created_idx;
DROP INDEX IF EXISTS public.idx_purchase_items_lote;
DROP INDEX IF EXISTS public.idx_inventory_vencidos;
DROP INDEX IF EXISTS public.idx_pp_product_activo;
DROP INDEX IF EXISTS public.idx_igmv_unidades;

-- ── BLOQUE 7: retención 90 días para logs de diagnóstico de sync ────────────
select cron.schedule(
  'purge-sync-logs-daily',
  '10 6 * * *',
  $$
  DELETE FROM public.sync_log WHERE ran_at < now() - interval '90 days';
  DELETE FROM public.inventory_sync_log WHERE synced_at < now() - interval '90 days';
  $$
);
