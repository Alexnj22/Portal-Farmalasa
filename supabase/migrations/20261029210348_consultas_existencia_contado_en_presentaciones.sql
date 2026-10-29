SET lock_timeout = '5s';

-- «48 caja» → «48 cajas»: el tipo en plural cuando no es uno. Sólo a los que
-- terminan en vocal; «blister» se queda igual, que es como se dice en sala.
CREATE OR REPLACE FUNCTION public.unidades_en_presentaciones(p_producto integer, p_unidades integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_resto int := abs(coalesce(p_unidades, 0));
  v_partes text[] := '{}';
  v_n int;
  r record;
BEGIN
  IF v_resto = 0 THEN RETURN '0'; END IF;
  FOR r IN
    SELECT DISTINCT lower(trim(pr.tipo)) tipo, pp.factor
      FROM public.product_precios pp JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
     WHERE pp.product_id = p_producto AND pp.activo AND pp.factor > 0
     ORDER BY pp.factor DESC
  LOOP
    IF v_resto >= r.factor THEN
      v_n := v_resto / r.factor;
      v_partes := v_partes || (v_n::text || ' ' || r.tipo
        || CASE WHEN v_n <> 1 AND r.tipo ~ '[aeiou]$' THEN 's' ELSE '' END);
      v_resto := v_resto % r.factor;
    END IF;
  END LOOP;
  IF v_resto > 0 THEN v_partes := v_partes || (v_resto::text || ' unidad' || CASE WHEN v_resto = 1 THEN '' ELSE 'es' END); END IF;
  RETURN array_to_string(v_partes, ' y ');
END $function$;

-- Lo que contó la sala y lo que decía el sistema, dicho en presentaciones
-- («1 caja», «4 blister»): en unidades sueltas no se entendía qué se contó.
CREATE OR REPLACE FUNCTION public.consultas_existencia_lista()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_todo boolean := public.auth_module_scope('conteo_inventario') = 'ALL';
  v_mia bigint := public.auth_employee_branch_id();
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
         WHERE s.consulta_id = c.id))
      ORDER BY c.created_at DESC), '[]'::json)
      FROM public.consultas_existencia c
      JOIN public.products p ON p.id = c.erp_product_id
      LEFT JOIN public.branches bp ON bp.id = c.pedido_desde
     WHERE (c.cerrada_at IS NULL OR c.created_at > now() - interval '60 days'
            OR EXISTS (SELECT 1 FROM public.consultas_existencia_salas s
                        WHERE s.consulta_id = c.id AND s.estado = 'DESCUADRE'))
       AND (v_todo OR c.pedido_desde = v_mia
            OR EXISTS (SELECT 1 FROM public.consultas_existencia_salas s
                        WHERE s.consulta_id = c.id AND s.branch_id = v_mia)));
END $function$;
