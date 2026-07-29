SET lock_timeout = '5s';

-- ─── C3 — Un costo por presentación, un solo criterio ───────────────────────
-- crear_conteo_inventario costeaba con MIN(costo) sobre TODAS las presentaciones
-- activas del producto, sin mirar la presentación de la línea. 628 productos
-- tienen más de un costo activo, con razón máx/mín promedio de 7.8x y hasta
-- 250x: los $ de faltante y sobrante estaban subvaluados sin criterio.
-- Y no hacía falta — el 97.8% de las líneas de inventory casan exacto con
-- product_precios → presentaciones.tipo.
--
-- Había además TRES criterios distintos en el mismo módulo: MIN(costo) en el
-- snapshot, order('id').limit(1) en el alta manual del cliente, y ninguno para
-- las líneas nunca contadas. Este helper es ahora el único.

CREATE OR REPLACE FUNCTION public.conteo_costo_unitario(p_product_id integer, p_presentacion text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Prefiere el costo de la presentación de la línea; si el producto no la
  -- tiene registrada, cae al costo más bajo activo (criterio anterior) para no
  -- dejar la línea sin valuar.
  SELECT pp.costo
  FROM public.product_precios pp
  LEFT JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
  WHERE pp.product_id = p_product_id
    AND pp.activo = true
  ORDER BY (pr.tipo IS NOT DISTINCT FROM p_presentacion) DESC, pp.costo
  LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.conteo_costo_unitario(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteo_costo_unitario(integer, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.crear_conteo_inventario(p_branch_id bigint, p_scope_type text, p_scope_filter jsonb DEFAULT NULL::jsonb, p_erp_product_ids integer[] DEFAULT NULL::integer[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo_id uuid;
  v_erp_sucursal_ids int[];
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND p_branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF p_scope_type NOT IN ('TOTAL','LABORATORIO','BAJO_RECETA','MANUAL') THEN
    RAISE EXCEPTION 'ALCANCE_INVALIDO';
  END IF;

  SELECT array_agg(erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map WHERE branch_id = p_branch_id;

  IF v_erp_sucursal_ids IS NULL THEN
    RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP';
  END IF;

  -- Siempre incluye TODO el inventario (vencido o no) — el conteo físico debe
  -- reflejar la realidad completa del anaquel/bodega; lo vencido/próximo a
  -- vencer se señala como aviso en la UI, no se excluye del snapshot.
  INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status)
  VALUES (p_branch_id, public.auth_employee_id(), p_scope_type, p_scope_filter, true, 'EN_PROGRESO')
  RETURNING id INTO v_conteo_id;

  INSERT INTO public.conteo_inventario_items (conteo_id, erp_product_id, source_inventory_id, source_sync_key, presentacion, detalle, lote, fecha_vencimiento, is_vencidos, sistema_cantidad, costo_unitario)
  SELECT v_conteo_id, i.erp_product_id, i.id, i.sync_key, i.presentacion, i.detalle, i.lote, i.fecha_vencimiento, i.is_vencidos, i.cantidad,
         public.conteo_costo_unitario(i.erp_product_id, i.presentacion)
  FROM public.inventory i
  LEFT JOIN public.products p ON p.id = i.erp_product_id
  WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
    AND (
      p_scope_type = 'TOTAL'
      OR (p_scope_type = 'LABORATORIO' AND p.laboratorio_id = (p_scope_filter->>'laboratorio_id')::int)
      OR (p_scope_type = 'BAJO_RECETA' AND p.es_antibiotico = true)
      OR (p_scope_type = 'MANUAL' AND i.erp_product_id = ANY(p_erp_product_ids))
    );

  RETURN v_conteo_id;
END;
$function$;


-- Recosteo de los conteos todavía abiertos: el costo se aplica al valuar en
-- finalizar_conteo_inventario, así que corregirlo antes de cerrar es exacto.
UPDATE public.conteo_inventario_items ci
SET costo_unitario = public.conteo_costo_unitario(ci.erp_product_id, ci.presentacion)
FROM public.conteos_inventario c
WHERE c.id = ci.conteo_id
  AND c.status IN ('BORRADOR','EN_PROGRESO')
  AND ci.costo_unitario IS DISTINCT FROM public.conteo_costo_unitario(ci.erp_product_id, ci.presentacion);
