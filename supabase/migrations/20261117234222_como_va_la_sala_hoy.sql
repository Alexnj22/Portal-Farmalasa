-- «Cómo va hoy» en el kiosco de caja (pedido del usuario, 2026-11-17: «una
-- gráfica que me diga cómo va la venta, top vendedores, y motivación de subir
-- la venta porque va bajo de lo esperado»).
--
-- Devuelve la forma del día, no la meta: la meta del día sale de
-- `get_meta_sala` (la del mes repartida entre sus días, la misma definición de
-- `avanceDeMetaDelDia`) y el cliente las junta. Lo que agrega esto:
--   · `hoy`: la venta de hoy por hora.
--   · `tipica`: cuánto se vende en cada hora el MISMO día de la semana, en las
--     4 semanas anteriores. Con eso «lo esperado a esta hora» es la meta del día
--     por la parte del día que normalmente ya pasó: a las 9 de la mañana no se
--     espera el 50 %, y así el aviso de «va bajo» no sale todas las mañanas.
--   · `vendedores`: los 5 que más venden hoy en la sucursal.
-- Mismos frenos que `get_meta_sala`: `dash_meta_sala` y su alcance.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.como_va_la_sala_hoy(p_branch_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF NOT public.auth_has_module_permission('dash_meta_sala', 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF public.auth_module_scope('dash_meta_sala') IS DISTINCT FROM 'ALL'
     AND public.auth_employee_branch_id() IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN json_build_object(
    'fecha', v_hoy,
    'hoy', (SELECT coalesce(json_agg(json_build_object('hora', h, 'total', round(t, 2), 'ventas', n) ORDER BY h), '[]'::json)
              FROM (SELECT extract(hour FROM s.hora)::int h, sum(s.total) t, count(*) n
                      FROM public.sales_invoices s
                     WHERE s.branch_id = p_branch_id AND s.fecha = v_hoy AND public.venta_valida(s.estado)
                     GROUP BY 1) x),
    'tipica', (SELECT coalesce(json_agg(json_build_object('hora', h, 'total', round(t / 4.0, 2)) ORDER BY h), '[]'::json)
                 FROM (SELECT extract(hour FROM s.hora)::int h, sum(s.total) t
                         FROM public.sales_invoices s
                        WHERE s.branch_id = p_branch_id
                          AND s.fecha IN (v_hoy - 7, v_hoy - 14, v_hoy - 21, v_hoy - 28)
                          AND public.venta_valida(s.estado)
                        GROUP BY 1) x),
    'vendedores', (SELECT coalesce(json_agg(json_build_object('id', id, 'name', name, 'photo_url', photo_url,
                                                              'total', round(t, 2), 'ventas', n) ORDER BY t DESC), '[]'::json)
                     FROM (SELECT e.id, e.name, e.photo_url, sum(s.total) t, count(*) n
                             FROM public.sales_invoices s
                             JOIN public.employees e ON e.code = s.cod_vendedor
                            WHERE s.branch_id = p_branch_id AND s.fecha = v_hoy AND public.venta_valida(s.estado)
                            GROUP BY e.id, e.name, e.photo_url
                            ORDER BY sum(s.total) DESC
                            LIMIT 5) x));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.como_va_la_sala_hoy(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.como_va_la_sala_hoy(bigint) TO authenticated, service_role;
