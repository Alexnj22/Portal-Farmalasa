SET lock_timeout = '5s';

-- Quien no pidió la consulta ve sólo el renglón de SU sala: antes, una sala
-- incluida en una consulta veía las otras seis con su conteo y lo que decía
-- el sistema. La consulta completa la ven quien la pidió (la persona o su
-- sala) y el alcance ALL.
CREATE OR REPLACE FUNCTION public.consultas_existencia_lista()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_todo boolean := public.auth_module_scope('conteo_inventario') = 'ALL';
  v_mia bigint := public.auth_employee_branch_id();
  v_yo uuid := public.auth_employee_id();
  v_cuenta boolean := public.auth_has_module_permission('conteo_inventario', 'can_edit');
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_view') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  RETURN (
    SELECT coalesce(json_agg(json_build_object(
      'id', c.id, 'created_at', c.created_at, 'cerrada_at', c.cerrada_at,
      'erp_product_id', c.erp_product_id, 'nombre', p.nombre, 'motivo', c.motivo, 'origen', c.origen,
      'pedido_por', c.pedido_por, 'pedido_desde', bp.name,
      'salas', (
        SELECT json_agg(json_build_object(
          'id', s.id, 'sala', b.name, 'branch_id', s.branch_id, 'erp_sucursal_id', s.erp_sucursal_id,
          'estado', s.estado,
          'puedo_contar', v_cuenta AND s.estado IN ('PENDIENTE', 'RECONTAR') AND (v_todo OR s.branch_id = v_mia),
          'contado_por', coalesce(s.contado_2_por, s.contado_1_por),
          'contado_at', coalesce(s.contado_2_at, s.contado_1_at),
          'recontada', s.conteo_2 IS NOT NULL,
          'final', CASE WHEN s.estado NOT IN ('PENDIENTE', 'RECONTAR')
                        THEN coalesce(s.sistema->'ronda_2', s.sistema->'ronda_1') END,
          'contado_texto', CASE WHEN s.estado NOT IN ('PENDIENTE', 'RECONTAR')
                        THEN public.unidades_en_presentaciones(c.erp_product_id,
                               (coalesce(s.sistema->'ronda_2', s.sistema->'ronda_1')->>'contado')::int) END,
          'sistema_texto', CASE WHEN s.estado NOT IN ('PENDIENTE', 'RECONTAR')
                        THEN public.unidades_en_presentaciones(c.erp_product_id,
                               (coalesce(s.sistema->'ronda_2', s.sistema->'ronda_1')->>'sistema')::int) END,
          'diferencia', CASE WHEN s.estado NOT IN ('PENDIENTE', 'RECONTAR') THEN s.diferencia END,
          'texto', CASE WHEN s.estado NOT IN ('PENDIENTE', 'RECONTAR') AND s.diferencia <> 0
                        THEN public.unidades_en_presentaciones(c.erp_product_id, s.diferencia) END,
          'solicitudes', s.solicitudes, 'resuelto_por', s.resuelto_por, 'resuelto_at', s.resuelto_at, 'nota', s.nota)
          ORDER BY b.name)
          FROM public.consultas_existencia_salas s JOIN public.branches b ON b.id = s.branch_id
         WHERE s.consulta_id = c.id
           AND (v_todo OR c.pedido_por = v_yo OR c.pedido_desde = v_mia OR s.branch_id = v_mia)))
      ORDER BY c.created_at DESC), '[]'::json)
      FROM public.consultas_existencia c
      JOIN public.products p ON p.id = c.erp_product_id
      LEFT JOIN public.branches bp ON bp.id = c.pedido_desde
     WHERE (c.cerrada_at IS NULL OR c.created_at > now() - interval '60 days'
            OR EXISTS (SELECT 1 FROM public.consultas_existencia_salas s
                        WHERE s.consulta_id = c.id AND s.estado = 'DESCUADRE'))
       AND (v_todo OR c.pedido_por = v_yo OR c.pedido_desde = v_mia
            OR EXISTS (SELECT 1 FROM public.consultas_existencia_salas s
                        WHERE s.consulta_id = c.id AND s.branch_id = v_mia)));
END $function$;
