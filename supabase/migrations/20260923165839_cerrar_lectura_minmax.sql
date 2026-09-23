-- Regla 4 de la Fase 2 (docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md), aprobada
-- por el usuario el 2026-09-23: el MIN·MAX se lee como el inventario — quien
-- tiene alguna pantalla que lo usa, sin recorte por sala.
--
-- Sin recorte a propósito: los traslados (`get_donde_hay`,
-- `get_faltantes_con_stock_en_otra_sala`, `get_traslado_disponibilidad`) miran
-- el MIN de la OTRA sala para no dejarla por debajo al darle producto.
--
-- Misma lista que `inventory_select` (20260923…_cerrar_lectura_inventario): los
-- lectores de `product_stock_params` son un subconjunto de los del inventario
-- (MIN·MAX, pedidos, gestión de stock, conteo, traslados, la solicitud de
-- MIN·MAX del Inicio y la aprobación en Solicitudes). Las escrituras no cambian.
--
-- Tabla caliente: freno de 2 s.

SET lock_timeout = '2s';

DROP POLICY "psp_select" ON public.product_stock_params;

CREATE POLICY product_stock_params_select ON public.product_stock_params
    FOR SELECT TO authenticated
    USING ((SELECT EXISTS (
        SELECT 1 FROM unnest(ARRAY[
            'inventario', 'dash_inv_search', 'dash_inv_movement', 'traslados',
            'dash_traslados', 'conteo_inventario', 'minmax', 'dash_minmax_req',
            'pedidos', 'gestion_stock', 'ventas', 'sync_health', 'requests'
        ]) m
        WHERE public.auth_has_module_permission(m, 'can_view'))));
