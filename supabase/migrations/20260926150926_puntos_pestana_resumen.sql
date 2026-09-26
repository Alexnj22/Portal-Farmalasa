SET lock_timeout = '5s';

-- Puntos estrena la pestaña «Resumen» (pedido del usuario, 2026-09-26): las
-- gráficas y lo relevante del programa se mudan ahí, y «Consulta» queda como
-- las tarjetas y el listado de clientes. Cada pestaña tiene su permiso: el de
-- Resumen nace para quien ya tenía Consulta, así nadie pierde lo que veía.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'puntos_tab_resumen', true, false, false, 'ALL'
  FROM public.role_permissions rp
 WHERE rp.module_key = 'puntos_tab_consulta' AND rp.can_view
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true;

-- La serie diaria es de la pestaña Resumen desde ahora.
CREATE OR REPLACE FUNCTION public.puntos_panel_serie(p_dias integer DEFAULT 30)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json; v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date; v_desde date;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_resumen', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver el resumen de puntos.' USING ERRCODE = '42501';
  END IF;
  v_desde := v_hoy - (least(greatest(coalesce(p_dias, 30), 7), 120) - 1);

  IF public.puntos_fuente() <> 'portal' THEN
    SELECT coalesce(json_agg(json_build_object('fecha', d::date, 'acumulado', coalesce(a.pts, 0),
                                               'canjeado', coalesce(k.pts, 0)) ORDER BY d), '[]'::json)
      INTO v
      FROM generate_series(v_desde, v_hoy, interval '1 day') g(d)
      LEFT JOIN (SELECT fecha, sum(floor(total))::bigint pts FROM public.puntos_enviados
                  WHERE fecha >= v_desde AND estado_puntos IN ('pendiente', 'acumulado') GROUP BY 1) a
             ON a.fecha = g.d::date
      LEFT JOIN (SELECT si.fecha, sum(greatest(round(((SELECT coalesce(sum(ii.total_linea), 0) FROM public.sales_invoice_items ii
                                                       WHERE ii.invoice_id = si.id) - si.total - coalesce(si.retencion, 0)) * 100), 0))::bigint pts
                   FROM public.sales_invoices si
                   JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
                   LEFT JOIN public.customers cu ON cu.id = si.customer_id
                  WHERE si.fecha >= v_desde AND si.has_puntos AND si.estado = 'FINALIZADA'
                    AND coalesce(cu.acumula_puntos, true)
                  GROUP BY 1) k
             ON k.fecha = g.d::date;
  ELSE
    SELECT coalesce(json_agg(json_build_object('fecha', d::date, 'acumulado', coalesce(a.pts, 0),
                                               'canjeado', coalesce(k.pts, 0)) ORDER BY d), '[]'::json)
      INTO v
      FROM generate_series(v_desde, v_hoy, interval '1 day') g(d)
      LEFT JOIN (SELECT ganado_el fecha, sum(puntos)::bigint pts FROM public.puntos_lote
                  WHERE origen = 'venta' AND ganado_el >= v_desde GROUP BY 1) a
             ON a.fecha = g.d::date
      LEFT JOIN (SELECT (created_at AT TIME ZONE 'America/El_Salvador')::date fecha, sum(puntos)::bigint pts
                   FROM public.puntos_salida
                  WHERE tipo = 'canje' AND invoice_id IS NOT NULL
                    AND created_at >= (v_desde::timestamp AT TIME ZONE 'America/El_Salvador')
                  GROUP BY 1) k
             ON k.fecha = g.d::date;
  END IF;
  RETURN v;
END;
$$;

