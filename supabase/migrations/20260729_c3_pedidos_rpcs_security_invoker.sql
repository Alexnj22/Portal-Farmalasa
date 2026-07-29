-- C3.3 — Las 8 RPCs de pedidos pasan de SECURITY DEFINER a SECURITY INVOKER.
--
-- El problema: la policy de SELECT de `pedidos` / `pedido_items` exige
--   auth_has_module_permission('pedidos','can_view')
--   AND (auth_module_scope('pedidos') = 'ALL' OR auth_employee_erp_sucursal_id() = ANY(sucursal_ids))
-- pero estas 8 funciones eran SECURITY DEFINER sin ningun gate interno, asi que
-- corrian como el dueño y se saltaban la policy entera. Cualquier empleado
-- autenticado leia todos los pedidos de todas las sucursales por RPC.
--
-- Medido en prod dentro de BEGIN..ROLLBACK, con un empleado real
-- (Regente de Enfermeria, sin permiso de pedidos):
--   get_pedidos_en_curso()        ANTES 46 filas  →  DESPUES 0
--   get_pausa_razones_stats(...)  ANTES  7 filas  →  DESPUES 0
-- Y con empleados que si tienen el modulo:
--   Bodega (scope ALL)     en_curso 46, pausa 7, sucursal_stats 3
--   Sucursal (scope BRANCH) en_curso  8, pausa 1, sucursal_stats 3
-- Ninguna fallo por permisos: `authenticated` ya tiene SELECT en los 12 objetos
-- que estas funciones leen (verificado con has_table_privilege).
--
-- Nota honesta sobre get_pedido_sucursal_stats: sigue devolviendo una fila por
-- sucursal pedida (3 y 3 arriba) porque su esqueleto sale de erp_sucursal_map /
-- inventory, que son tablas abiertas a authenticated. Lo que si queda filtrado
-- por la policy son las cifras derivadas de pedidos/pedido_items.
--
-- Efecto en usuarios legitimos: los 26 empleados activos con scope=BRANCH pasan
-- a ver solo su sucursal; los 12 con scope=ALL no cambian. Decision del usuario
-- el 2026-07-29.

SET lock_timeout = '5s';

ALTER FUNCTION public.get_pedidos_en_curso()                                SECURITY INVOKER;
ALTER FUNCTION public.get_pedido_item_stats(uuid[])                         SECURITY INVOKER;
ALTER FUNCTION public.get_pedido_kpis(date, date)                           SECURITY INVOKER;
ALTER FUNCTION public.get_pausa_razones_stats(date, date)                   SECURITY INVOKER;
ALTER FUNCTION public.get_pedido_diferencias_stats(timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_pedido_generar_dashboard(integer[])               SECURITY INVOKER;
ALTER FUNCTION public.get_pedido_sin_bodega(integer[])                      SECURITY INVOKER;
ALTER FUNCTION public.get_pedido_sucursal_stats(integer[])                  SECURITY INVOKER;
