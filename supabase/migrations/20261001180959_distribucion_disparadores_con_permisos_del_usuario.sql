-- Cuatro disparadores de la distribuidora corrían como SECURITY DEFINER sin
-- necesitarlo (auditoría de los borradores, 2026-10-01). Sólo leen tablas que
-- cualquiera con permiso de ver Distribución ya puede leer (dist_lotes,
-- dist_pedidos, dist_cargas, dist_rutas: las cuatro con policy
-- `auth_has_module_permission('distribucion','can_view')`) o completan la
-- propia fila. Quien escribe en sus tablas tiene ese permiso; lo que escriben
-- las funciones DEFINER y service_role sigue corriendo como su dueño.
-- Probado en el branch de pruebas con las pruebas de pantalla de venta, lotes,
-- autoventa, rutas y venta perdida: 5 de 5.
SET lock_timeout = '5s';
ALTER FUNCTION public.dist_validar_lote_item() SECURITY INVOKER;
ALTER FUNCTION public.dist_ventas_perdidas_resolver() SECURITY INVOKER;
ALTER FUNCTION public.dist_cliente_ruta_texto() SECURITY INVOKER;
ALTER FUNCTION public.dist_validar_desde_camion() SECURITY INVOKER;