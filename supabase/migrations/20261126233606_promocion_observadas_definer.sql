SET lock_timeout = '5s';

-- `get_promocion_observadas` nació INVOKER y cruzaba `employees.code` para
-- poner el nombre del vendedor: `authenticated` no tiene SELECT sobre esa
-- columna (sólo id y name), así que la pestaña Control daba 42501 a todos.
-- Mismo arreglo que `rebajas_en_ventas`: DEFINER con la guarda del módulo
-- escrita adentro. Quien ve Promociones tiene alcance de todas las salas.
CREATE OR REPLACE FUNCTION public.get_promocion_observadas(p_desde date, p_hasta date)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE r json;
BEGIN
  IF NOT coalesce(public.auth_has_module_permission('promociones', 'can_view'), false) THEN
    RAISE EXCEPTION 'Sin permiso para ver Promociones.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(json_agg(t ORDER BY t.fecha DESC, t.id DESC), '[]'::json) INTO r FROM (
    SELECT o.id, o.fecha, o.branch_id, b.name AS sala, si.correlativo, si.tipo_documento,
           si.estado, NOT public.venta_valida(si.estado) AS anulada, si.cliente, si.total,
           si.cod_vendedor, e.id AS vendedor_id, e.name AS vendedor,
           rg.id AS regla_id, rg.tipo, rg.producto_texto, rg.requiere_texto,
           o.motivo, o.detalle, o.created_at
      FROM public.promocion_ventas_observadas o
      JOIN public.promocion_reglas rg ON rg.id = o.regla_id
      LEFT JOIN public.sales_invoices si ON si.id = o.invoice_id
      LEFT JOIN public.branches b ON b.id = o.branch_id
      LEFT JOIN LATERAL (SELECT e.id, e.name FROM public.employees e
                          WHERE e.code = si.cod_vendedor ORDER BY e.id LIMIT 1) e ON true
     WHERE o.fecha BETWEEN p_desde AND p_hasta
  ) t;
  RETURN r;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_promocion_observadas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_promocion_observadas(date, date) TO authenticated, service_role;
