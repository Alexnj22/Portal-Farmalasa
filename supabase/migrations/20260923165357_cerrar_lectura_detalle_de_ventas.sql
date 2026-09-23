-- Regla 1 de la Fase 2 (docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md), aprobada
-- por el usuario el 2026-09-23: el detalle de una venta lo ve quien ve la venta.
--
-- `sales_invoice_items` tenía `USING (true)`: cualquier cuenta podía leer las
-- 594k líneas de todas las salas. La factura (`sales_invoices`) ya decide quién
-- ve qué —ventas, minmax_ver_costos o dash_top_productos, cada uno con su
-- alcance—, así que la línea HEREDA esa decisión con un EXISTS: la subconsulta
-- corre bajo el RLS de la factura, y la regla queda escrita una sola vez.
--
-- El atajo de adelante es la mitad importante: quien ve TODAS las facturas por
-- alguno de esos tres permisos no paga el EXISTS por fila (`get_stock_analysis`
-- recorre ~300k líneas). Medido como usuario antes de aplicar, el mes en curso:
-- Jefe/a de Sala 344 → 385 ms, Supervisor 379 → 248 ms — ruido, no costo.
--
-- Ningún lector se queda sin lo que usa: todos llegan a la línea a través de
-- una factura que ya pueden ver (el mapa de lectores está en el plan).
--
-- Tabla caliente (el sync escribe cada minuto): freno de 2 s. Si choca con un
-- sync, se cancela sola sin trabar a nadie y se reintenta.

SET lock_timeout = '2s';

DROP POLICY "Authed can read sales_invoice_items" ON public.sales_invoice_items;

CREATE POLICY sales_invoice_items_select ON public.sales_invoice_items
    FOR SELECT TO authenticated
    USING (
        ((SELECT public.auth_has_module_permission('ventas', 'can_view'))
            AND (SELECT public.auth_module_scope('ventas')) = 'ALL')
     OR ((SELECT public.auth_has_module_permission('minmax_ver_costos', 'can_view'))
            AND (SELECT public.auth_module_scope('minmax_ver_costos')) = 'ALL')
     OR ((SELECT public.auth_has_module_permission('dash_top_productos', 'can_view'))
            AND (SELECT public.auth_module_scope('dash_top_productos')) = 'ALL')
     OR EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.id = sales_invoice_items.invoice_id)
    );
