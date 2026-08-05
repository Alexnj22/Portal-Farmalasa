SET lock_timeout = '5s';

-- El listado devolvía el gasto y su reparto por sala, pero no las CUOTAS. Sin
-- ellas la pantalla tendría que dividir monto ÷ meses en el navegador — y ahí
-- se pierde el residuo que el servidor puso en el último mes: $1,000 entre 3
-- daría tres veces 333.333 en pantalla contra 333.33 / 333.33 / 333.34 en la
-- base. El mismo error que `montoDe()` evitó en la confirmación.
--
-- Además trae la meta ya calculada de cada mes, para que la pantalla no tenga
-- que pedirla por separado y cruzarla a mano.
CREATE OR REPLACE FUNCTION public.get_metas_gastos()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_view') THEN
    RETURN '[]'::json;
  END IF;

  RETURN coalesce((
    SELECT json_agg(to_json(t) ORDER BY t.created_at DESC) FROM (
      SELECT g.id, g.concepto, g.monto_total, g.margen_pct, g.meses, g.ym_inicio,
             g.nota, g.estado, g.created_at, g.anulado_nota, g.anulado_at,
             round(g.monto_total / (g.margen_pct / 100), 2) AS venta_total,
             (SELECT e.name FROM public.employees e WHERE e.id = g.creado_por) AS creado_por_nombre,
             (SELECT json_agg(to_json(x) ORDER BY x.sala)
                FROM (SELECT gs.branch_id, gs.monto,
                             (SELECT b.name FROM public.branches b WHERE b.id = gs.branch_id) AS sala
                      FROM public.metas_gasto_sala gs WHERE gs.gasto_id = g.id) x) AS salas,
             -- Las cuotas tal como quedaron guardadas, con la meta del mes al lado.
             (SELECT json_agg(to_json(c) ORDER BY c.year_month, c.sala)
                FROM (SELECT q.branch_id, q.year_month, q.monto_gasto, q.monto_venta, q.estado,
                             (SELECT b.name FROM public.branches b WHERE b.id = q.branch_id) AS sala,
                             (SELECT m.monto_meta FROM public.metas_sucursal m
                               WHERE m.branch_id = q.branch_id AND m.year_month = q.year_month) AS monto_meta
                      FROM public.metas_gasto_cuota q WHERE q.gasto_id = g.id) c) AS cuotas,
             (SELECT count(*) FROM public.metas_gasto_cuota c
               WHERE c.gasto_id = g.id AND c.estado = 'pendiente') AS cuotas_vivas,
             (SELECT coalesce(sum(c.monto_venta), 0) FROM public.metas_gasto_cuota c
               WHERE c.gasto_id = g.id AND c.estado = 'pendiente') AS venta_viva
      FROM public.metas_gasto g
    ) t), '[]'::json);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_metas_gastos() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_metas_gastos() TO authenticated, service_role;
