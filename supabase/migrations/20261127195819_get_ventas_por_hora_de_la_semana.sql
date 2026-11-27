-- /sucursales/:id Personal: ventas por (día de la semana, hora) ya sumadas, en una pasada.
-- Reemplaza ~9-16 páginas de branch_hourly_sales (vista que se recalcula por página).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_ventas_por_hora_de_la_semana(p_branch_id bigint)
RETURNS json
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH horas AS (
    SELECT fecha, EXTRACT(hour FROM hora)::int AS hora, round(sum(total), 2) AS total
    FROM public.sales_invoices
    WHERE branch_id = p_branch_id AND venta_valida(estado)
    GROUP BY fecha, EXTRACT(hour FROM hora)
  )
  SELECT json_build_object(
    'registros', (SELECT count(*) FROM horas),
    'fechas_por_dia', (SELECT coalesce(json_object_agg(dia, n), '{}'::json) FROM (
        SELECT EXTRACT(dow FROM fecha)::int AS dia, count(DISTINCT fecha) AS n
        FROM horas GROUP BY 1) d),
    'celdas', (SELECT coalesce(json_agg(json_build_object('dia', dia, 'hora', hora, 'total', total)), '[]'::json) FROM (
        SELECT EXTRACT(dow FROM fecha)::int AS dia, hora, sum(total) AS total
        FROM horas GROUP BY 1, 2) c)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_ventas_por_hora_de_la_semana(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ventas_por_hora_de_la_semana(bigint) TO authenticated, service_role;
