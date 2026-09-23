-- Cerrar la lectura — tanda 2 de la Fase 1 de docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md.
--
-- 1. Recorte por SALA en las dos tablas de Ventas que la tanda 1 dejó por
--    módulo. De los módulos de la tanda 1, `ventas` es el único que tiene cargos
--    con alcance de sala (Jefe/a y Subjefe/a de Sala, Dependiente, Regente): los
--    demás sólo los tienen cargos que ven todas las salas. La pantalla de esos
--    cargos ya fija el filtro en su sala (`VentasView`, `branchLocked`), así que
--    recortar acá no les quita nada de lo que ven: sólo lo que la API les dejaba
--    pedir a mano. El criterio es el mismo de `conteos_inventario` y
--    `bolsas_operaciones`: alcance ALL, o la sala de la ficha. La fila
--    `branch_id = -1` de `ventas_monthly_stats` (todas las salas juntas) queda
--    sólo para alcance ALL.
--
-- 2. `inventory_sync_log` pasa a Inventario o Actualización de datos. Sus
--    lectores: la pestaña de Inventario, `v_sync_health` (Actualización de
--    datos), `useSyncMonitor` (ya condicionado a `sync_health`) y el recuadro
--    «Datos» del menú, que desde esta misma versión sólo se dibuja con uno de
--    esos dos permisos. Las funciones DEFINER y el sync (service_role) no pasan
--    por el RLS. La escribe el sync cada minuto: `lock_timeout`, y si choca, se
--    reintenta.

SET lock_timeout = '5s';

DROP POLICY sales_invoice_changelog_select ON public.sales_invoice_changelog;
CREATE POLICY sales_invoice_changelog_select ON public.sales_invoice_changelog
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('ventas', 'can_view'))
           AND ((SELECT public.auth_module_scope('ventas')) = 'ALL'
                OR branch_id = (SELECT public.auth_employee_branch_id())));

DROP POLICY ventas_monthly_stats_select ON public.ventas_monthly_stats;
CREATE POLICY ventas_monthly_stats_select ON public.ventas_monthly_stats
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('ventas', 'can_view'))
           AND ((SELECT public.auth_module_scope('ventas')) = 'ALL'
                OR branch_id = (SELECT public.auth_employee_branch_id())));

DROP POLICY "allow read inventory_sync_log" ON public.inventory_sync_log;
CREATE POLICY inventory_sync_log_select ON public.inventory_sync_log
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('inventario', 'can_view'))
        OR (SELECT public.auth_has_module_permission('sync_health', 'can_view')));
