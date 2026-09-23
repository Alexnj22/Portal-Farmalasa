-- Regla 2 de la Fase 2 (docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md), aprobada
-- por el usuario el 2026-09-23: las estadísticas y resúmenes de ventas se leen
-- como las facturas — cada sala la suya — o con el módulo que los usa.
--
-- Lectores (mapa del 2026-09-23):
--   sales_daily_stats          get_ventas_stats (Ventas, la sala propia) y
--                              get_metas_dashboard/historico (Metas, todas)
--   product_sales_monthly_agg  pestaña Productos de Ventas y las funciones de
--                              Generar pedido (pedidos_tab_generar, todas)
--   product_sales_rollup       get_stock_analysis (MIN·MAX)
--   product_last_sale          MIN·MAX y Gestión de stock
--   inventory_daily            get_quiebres_sala (MIN·MAX, pestaña Agotados)
-- Los widgets del Inicio que muestran ventas usan funciones DEFINER y no pasan
-- por acá. Los procesos (sync, refresh, triggers) corren como service_role.
--
-- Freno de 2 s: si choca con un refresh, se cancela sola y se reintenta.

SET lock_timeout = '2s';

DROP POLICY "authenticated read" ON public.sales_daily_stats;
CREATE POLICY sales_daily_stats_select ON public.sales_daily_stats
    FOR SELECT TO authenticated
    USING (((SELECT public.auth_has_module_permission('ventas', 'can_view'))
            AND ((SELECT public.auth_module_scope('ventas')) = 'ALL'
                 OR branch_id = (SELECT public.auth_employee_branch_id())))
        OR (SELECT public.auth_has_module_permission('metas', 'can_view')));

DROP POLICY "product_sales_monthly_agg_auth_read" ON public.product_sales_monthly_agg;
CREATE POLICY product_sales_monthly_agg_select ON public.product_sales_monthly_agg
    FOR SELECT TO authenticated
    USING (((SELECT public.auth_has_module_permission('ventas', 'can_view'))
            AND ((SELECT public.auth_module_scope('ventas')) = 'ALL'
                 OR branch_id = (SELECT public.auth_employee_branch_id())))
        OR (SELECT public.auth_has_module_permission('pedidos_tab_generar', 'can_view')));

DROP POLICY "psr_select" ON public.product_sales_rollup;
CREATE POLICY product_sales_rollup_select ON public.product_sales_rollup
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('minmax', 'can_view')));

DROP POLICY "product_last_sale_auth_read" ON public.product_last_sale;
CREATE POLICY product_last_sale_select ON public.product_last_sale
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('minmax', 'can_view'))
        OR (SELECT public.auth_has_module_permission('gestion_stock', 'can_view')));

DROP POLICY "inventory_daily_select" ON public.inventory_daily;
CREATE POLICY inventory_daily_select ON public.inventory_daily
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('minmax', 'can_view')));
