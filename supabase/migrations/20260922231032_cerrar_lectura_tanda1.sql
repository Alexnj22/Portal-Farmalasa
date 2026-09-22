-- Cerrar la lectura de tablas que no son de todos — tanda 1 de la Fase 1 de
-- docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md (remedido el 2026-09-22).
--
-- Regla del usuario: «cada uno debe tener acceso solo a lo suyo, sin nada más»,
-- con la condición de no quitarle a nadie lo que su pantalla usa. Cada tabla
-- tenía `USING (true)` para cualquier cuenta.
--
-- Cómo se eligió el acceso de cada una: todos sus lectores —`.from()` directo,
-- embebidos en otro `select`, funciones INVOKER y vistas `security_invoker`—,
-- trazados hasta la pantalla y el módulo que la abre. El acceso nuevo es
-- `can_view` en la UNIÓN de esos módulos. Las cinco sin ningún lector desde el
-- navegador (sólo funciones DEFINER, crons o edge functions con service_role)
-- quedan cerradas para `authenticated`.
--
-- Verificado antes de aplicar, midiendo filas visibles por cargo en una
-- transacción con rollback: igual para todo cargo con el módulo, 0 para los
-- demás. `bloqueo_global` (RESTRICTIVE) no se toca.
--
-- Queda para la tanda siguiente: el recorte por SALA (hoy el acceso es por
-- módulo) e `inventory_sync_log`, que lee el indicador de sincronización del
-- menú de todos.

SET lock_timeout = '5s';

-- ── Sin lectores desde el navegador: se cierran ─────────────────────────────
DROP POLICY "espejo_conflictos_select" ON public.espejo_conflictos;
DROP POLICY "purchase_claim_lines_select" ON public.purchase_claim_lines;
DROP POLICY "purchase_claim_rules_select" ON public.purchase_claim_rules;
DROP POLICY "wfm_snapshots_select" ON public.wfm_snapshots;
DROP POLICY "sales_alert_log_auth_read" ON public.sales_alert_log;

-- ── Por módulo ────────────────────────────────────────────────────────────────
DROP POLICY "Authed can read sales_invoice_changelog" ON public.sales_invoice_changelog;
CREATE POLICY sales_invoice_changelog_select ON public.sales_invoice_changelog
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('ventas', 'can_view')));
DROP POLICY "ventas_monthly_stats_read" ON public.ventas_monthly_stats;
CREATE POLICY ventas_monthly_stats_select ON public.ventas_monthly_stats
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('ventas', 'can_view')));
DROP POLICY "product_precios_history_read" ON public.product_precios_history;
CREATE POLICY product_precios_history_select ON public.product_precios_history
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('ventas', 'can_view'))
        OR (SELECT public.auth_has_module_permission('productos', 'can_view')));
DROP POLICY "product_precios_changelog_read" ON public.product_precios_changelog;
CREATE POLICY product_precios_changelog_select ON public.product_precios_changelog
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('productos', 'can_view')));
DROP POLICY "products_changelog_read" ON public.products_changelog;
CREATE POLICY products_changelog_select ON public.products_changelog
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('productos', 'can_view')));
DROP POLICY "authenticated_read_history" ON public.product_stock_params_history;
CREATE POLICY product_stock_params_history_select ON public.product_stock_params_history
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('minmax', 'can_view')));
DROP POLICY "sales_invoice_resolutions_read" ON public.sales_invoice_resolutions;
CREATE POLICY sales_invoice_resolutions_select ON public.sales_invoice_resolutions
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));
DROP POLICY "sales_null_resolutions_read" ON public.sales_null_resolutions;
CREATE POLICY sales_null_resolutions_select ON public.sales_null_resolutions
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));
DROP POLICY "sales_observation_resolutions_read" ON public.sales_observation_resolutions;
CREATE POLICY sales_observation_resolutions_select ON public.sales_observation_resolutions
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));
DROP POLICY "sales_gap_resolutions_read" ON public.sales_gap_resolutions;
CREATE POLICY sales_gap_resolutions_select ON public.sales_gap_resolutions
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));
DROP POLICY "spc_select" ON public.sales_payment_confirmations;
CREATE POLICY sales_payment_confirmations_select ON public.sales_payment_confirmations
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));
DROP POLICY "staff read" ON public.ventas_perdidas;
CREATE POLICY ventas_perdidas_select ON public.ventas_perdidas
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('ventas_perdidas', 'can_view')));
DROP POLICY "minmax_ignored_select" ON public.minmax_ignored;
CREATE POLICY minmax_ignored_select ON public.minmax_ignored
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('gestion_stock', 'can_view')));
DROP POLICY "pos_proveedores_select" ON public.pos_proveedores;
CREATE POLICY pos_proveedores_select ON public.pos_proveedores
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('cuentas_por_cobrar', 'can_view')));
DROP POLICY "metas_config_select" ON public.metas_config;
CREATE POLICY metas_config_select ON public.metas_config
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));
DROP POLICY "metas_sucursal_select" ON public.metas_sucursal;
CREATE POLICY metas_sucursal_select ON public.metas_sucursal
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));
DROP POLICY "clientes_sin_producto_select" ON public.clientes_sin_producto;
CREATE POLICY clientes_sin_producto_select ON public.clientes_sin_producto
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));
DROP POLICY "stock_config_select" ON public.stock_config;
CREATE POLICY stock_config_select ON public.stock_config
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('minmax', 'can_view'))
        OR (SELECT public.auth_has_module_permission('pedidos', 'can_view')));
DROP POLICY "dispatch_rules_select" ON public.dispatch_rules;
CREATE POLICY dispatch_rules_select ON public.dispatch_rules
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('pedidos', 'can_view'))
        OR (SELECT public.auth_has_module_permission('minmax', 'can_view')));
