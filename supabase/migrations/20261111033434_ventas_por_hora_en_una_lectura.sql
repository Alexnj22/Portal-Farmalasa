-- Las ventas por hora del Inicio, en una lectura en vez de dos o tres.
--
-- 2026-11-10. `branch_hourly_sales` es una VISTA que agrupa `sales_invoices`
-- por sala, día y hora. Dos lecturas del Inicio la recorrían de más:
--
-- 1. «¿Qué salas vendieron en los últimos 7 días?» bajaba las ~565 filas de la
--    vista (una por sala·día·hora) para quedarse con 7 números. Y se acercaba
--    al techo de 1000 filas: con más salas o más horas abiertas, una sala podía
--    quedar fuera sin error.
-- 2. El historial de 90 días de una sala (~1,000–1,400 filas) iba en páginas
--    de 1000 con `fetchAllRows`, y PostgREST aplica la página SOBRE la vista:
--    cada página volvía a agrupar las facturas enteras. Dos páginas = dos
--    agrupaciones completas. El «Monitor de ventas» con un año: seis.
--
-- Las dos funciones son INVOKER: el RLS de `sales_invoices` sigue decidiendo
-- qué ve cada quien, igual que a través de la vista. El historial devuelve
-- `json` (patrón C de CLAUDE.md): una sola ejecución y sin techo de 1000.
-- Mismas filas, mismas columnas, mismo orden que la consulta de antes.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.salas_con_venta_desde(p_desde date)
 RETURNS integer[]
 LANGUAGE sql
 STABLE
 SET search_path = public, extensions
AS $function$
  SELECT coalesce(array_agg(DISTINCT v.branch_id ORDER BY v.branch_id), '{}')
    FROM public.branch_hourly_sales v
   WHERE v.sale_date >= p_desde;
$function$;

REVOKE EXECUTE ON FUNCTION public.salas_con_venta_desde(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salas_con_venta_desde(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ventas_por_hora_de_sala(p_branch_id integer, p_desde date)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path = public, extensions
AS $function$
  SELECT coalesce(json_agg(json_build_object(
           'sale_hour', v.sale_hour,
           'transaction_count', v.transaction_count,
           'total_sales', v.total_sales,
           'sale_date', v.sale_date)
         ORDER BY v.sale_date, v.sale_hour), '[]'::json)
    FROM public.branch_hourly_sales v
   WHERE v.branch_id = p_branch_id
     AND v.sale_date >= p_desde;
$function$;

REVOKE EXECUTE ON FUNCTION public.ventas_por_hora_de_sala(integer, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ventas_por_hora_de_sala(integer, date) TO authenticated, service_role;
