-- Datos de mercado de la SRS (2026-11-14): lo que el emparejador
-- (scripts/srs/emparejar-datos-mercado.mjs, vía la función srs-datos-mercado
-- con el secreto de carga) tiene que emparejar. Mismo universo que
-- srs_mercado_lista() —todo producto con existencia o ya en la tabla—, menos
-- lo que una persona ya decidió (confirmado / no_aplica), que no se toca.
-- Sólo service_role. JSON para no caer bajo el techo de las 1000 filas.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.srs_mercado_por_emparejar()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  WITH ex AS (
    SELECT i.erp_product_id AS product_id, sum(i.cantidad)::int AS existencia
      FROM public.inventory i
     WHERE i.cantidad > 0 AND NOT i.is_vencidos
     GROUP BY 1
  )
  SELECT coalesce(json_agg(json_build_object(
           'product_id', p.id, 'nombre', p.nombre, 'laboratorio', l.nombre,
           'principio_activo', p.principio_activo, 'existencia', coalesce(ex.existencia, 0))
         ORDER BY p.id), '[]'::json)
    FROM public.products p
    LEFT JOIN ex ON ex.product_id = p.id
    LEFT JOIN public.srs_mercado_productos s ON s.product_id = p.id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
   WHERE (ex.product_id IS NOT NULL OR s.product_id IS NOT NULL)
     AND coalesce(s.estado, 'propuesto') = 'propuesto';
$function$;

REVOKE EXECUTE ON FUNCTION public.srs_mercado_por_emparejar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srs_mercado_por_emparejar() TO service_role;
