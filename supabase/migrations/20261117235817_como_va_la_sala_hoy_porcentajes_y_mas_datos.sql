-- «Cómo va hoy», segunda versión (pedido del usuario, 2026-11-17: «agrega más
-- datos, no pongas cantidades totales para los dependientes, sólo
-- porcentajes; sólo el jefe / subjefe puede ver montos»).
--
-- Los montos los decide LA BASE, no la pantalla: sin
-- `dash_meta_sala_vista_completa` no viaja ningún monto. Todo va como `parte`
-- de la BASE del día: la meta del día (la del mes entre sus días, la misma
-- definición de `avanceDeMetaDelDia`) o, sin meta, lo que la sucursal vende un
-- día normal. Quien ve montos recibe además `base` y los `total`.
--
-- Datos: venta por hora de hoy, la típica (mismo día de la semana, 4 semanas
-- antes), la del mismo día de la semana pasada, el avance del mes, los 5 que
-- más venden y los 5 productos que más salen hoy.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.como_va_la_sala_hoy(p_branch_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_montos  boolean := public.auth_has_module_permission('dash_meta_sala_vista_completa', 'can_view');
  v_meta    record;
  v_tipico  numeric;
  v_hoy_tot numeric;
  v_base    numeric;
  v_tipo    text;
BEGIN
  IF NOT public.auth_has_module_permission('dash_meta_sala', 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF public.auth_module_scope('dash_meta_sala') IS DISTINCT FROM 'ALL'
     AND public.auth_employee_branch_id() IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT m.monto_meta, m.dias_mes, m.pct_cumplimiento, m.pct_proyectado, m.dias_restantes
    INTO v_meta FROM public.get_meta_sala(p_branch_id) m LIMIT 1;

  SELECT sum(s.total) / 4.0 INTO v_tipico
    FROM public.sales_invoices s
   WHERE s.branch_id = p_branch_id
     AND s.fecha IN (v_hoy - 7, v_hoy - 14, v_hoy - 21, v_hoy - 28)
     AND public.venta_valida(s.estado);

  SELECT sum(s.total) INTO v_hoy_tot
    FROM public.sales_invoices s
   WHERE s.branch_id = p_branch_id AND s.fecha = v_hoy AND public.venta_valida(s.estado);

  IF coalesce(v_meta.monto_meta, 0) > 0 AND coalesce(v_meta.dias_mes, 0) > 0 THEN
    v_base := v_meta.monto_meta / v_meta.dias_mes; v_tipo := 'meta';
  ELSIF coalesce(v_tipico, 0) > 0 THEN
    v_base := v_tipico; v_tipo := 'tipico';
  END IF;

  IF v_base IS NULL THEN
    RETURN json_build_object('fecha', v_hoy, 'montos', v_montos, 'base_tipo', NULL);
  END IF;

  RETURN json_build_object(
    'fecha', v_hoy,
    'montos', v_montos,
    'base_tipo', v_tipo,
    'base', CASE WHEN v_montos THEN round(v_base, 2) END,
    'hoy', (SELECT coalesce(json_agg(json_build_object('hora', h, 'parte', round(t / v_base, 5),
                                                       'total', CASE WHEN v_montos THEN round(t, 2) END, 'ventas', n) ORDER BY h), '[]'::json)
              FROM (SELECT extract(hour FROM s.hora)::int h, sum(s.total) t, count(*) n
                      FROM public.sales_invoices s
                     WHERE s.branch_id = p_branch_id AND s.fecha = v_hoy AND public.venta_valida(s.estado)
                     GROUP BY 1) x),
    'tipica', (SELECT coalesce(json_agg(json_build_object('hora', h, 'parte', round(t / 4.0 / v_base, 5), 'ventas', round(n / 4.0, 2)) ORDER BY h), '[]'::json)
                 FROM (SELECT extract(hour FROM s.hora)::int h, sum(s.total) t, count(*) n
                         FROM public.sales_invoices s
                        WHERE s.branch_id = p_branch_id
                          AND s.fecha IN (v_hoy - 7, v_hoy - 14, v_hoy - 21, v_hoy - 28)
                          AND public.venta_valida(s.estado)
                        GROUP BY 1) x),
    'semana_pasada', (SELECT coalesce(json_agg(json_build_object('hora', h, 'parte', round(t / v_base, 5)) ORDER BY h), '[]'::json)
                        FROM (SELECT extract(hour FROM s.hora)::int h, sum(s.total) t
                                FROM public.sales_invoices s
                               WHERE s.branch_id = p_branch_id AND s.fecha = v_hoy - 7 AND public.venta_valida(s.estado)
                               GROUP BY 1) x),
    'mes', CASE WHEN v_meta.monto_meta IS NOT NULL THEN json_build_object(
             'pct_cumplimiento', v_meta.pct_cumplimiento, 'pct_proyectado', v_meta.pct_proyectado,
             'dias_restantes', v_meta.dias_restantes) END,
    'vendedores', (SELECT coalesce(json_agg(json_build_object('id', id, 'name', name, 'photo_url', photo_url, 'ventas', n,
                                                              'parte_del_dia', CASE WHEN v_hoy_tot > 0 THEN round(t / v_hoy_tot, 4) END,
                                                              'total', CASE WHEN v_montos THEN round(t, 2) END) ORDER BY t DESC), '[]'::json)
                     FROM (SELECT e.id, e.name, e.photo_url, sum(s.total) t, count(*) n
                             FROM public.sales_invoices s
                             JOIN public.employees e ON e.code = s.cod_vendedor
                            WHERE s.branch_id = p_branch_id AND s.fecha = v_hoy AND public.venta_valida(s.estado)
                            GROUP BY e.id, e.name, e.photo_url
                            ORDER BY sum(s.total) DESC
                            LIMIT 5) x),
    'productos', (SELECT coalesce(json_agg(json_build_object('nombre', d, 'cantidad', c, 'ventas', n) ORDER BY n DESC, c DESC), '[]'::json)
                    FROM (SELECT i.descripcion d, sum(i.cantidad) c, count(DISTINCT i.invoice_id) n
                            FROM public.sales_invoices s
                            JOIN public.sales_invoice_items i ON i.invoice_id = s.id
                           WHERE s.branch_id = p_branch_id AND s.fecha = v_hoy AND public.venta_valida(s.estado)
                             AND coalesce(i.erp_product_id, 0) <> 0
                           GROUP BY i.descripcion
                           ORDER BY count(DISTINCT i.invoice_id) DESC, sum(i.cantidad) DESC
                           LIMIT 5) x));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.como_va_la_sala_hoy(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.como_va_la_sala_hoy(bigint) TO authenticated, service_role;
