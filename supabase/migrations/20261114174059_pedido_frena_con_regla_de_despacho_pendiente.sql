-- Generar un pedido con un producto cuya regla de despacho quedó PENDIENTE
-- (reglas_despacho_pendientes abierta) ahora se FRENA. Sin regla, el producto
-- salía en su presentación suelta: el pedido #236 (2026-10-30) mandó «4 PAR»
-- de GUANTE TALLA S NIPRO, que se despacha por CAJA X 50 PARES; la pendiente
-- se resolvió 43 minutos después. Decisión del usuario (2026-11-14): frenar y
-- avisar que hay que resolver las reglas.
--
-- Dos piezas:
--   · reglas_pendientes_de_productos(ids): la pantalla la consulta al calcular
--     la vista previa. DEFINER porque quien genera (Auxiliar de Bodega) no
--     tiene la pestaña Reglas y el RLS de la tabla le devolvería vacío.
--   · confirm_pedido: el mismo freno en la base, para que ningún camino lo
--     saltee. Reescrita desde su definición VIVA; sólo se agrega el bloque.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reglas_pendientes_de_productos(p_product_ids integer[])
RETURNS integer[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT coalesce(array_agg(DISTINCT r.erp_product_id ORDER BY r.erp_product_id), '{}')
  FROM public.reglas_despacho_pendientes r
  WHERE r.resuelto_at IS NULL
    AND r.erp_product_id = ANY (p_product_ids)
    AND (SELECT public.auth_has_module_permission('pedidos', 'can_view'));
$$;
REVOKE EXECUTE ON FUNCTION public.reglas_pendientes_de_productos(integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reglas_pendientes_de_productos(integer[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_pedido(p_created_by uuid, p_notes text, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid, p_revisado_por uuid DEFAULT NULL::uuid, p_sucursal_ids integer[] DEFAULT NULL::integer[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_pedido_id uuid;
  v_item      jsonb;
  v_qty       integer;
  v_suc_valid boolean;
  v_actor     uuid := auth_employee_id();
  v_pend      text[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  -- Crear un pedido es de Bodega (decisión 2026-10-02).
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: crear un pedido es de Bodega';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un ítem.';
  END IF;

  -- Regla de despacho pendiente = el producto no sabe en qué presentación
  -- sale. Frena el pedido entero (2026-11-14).
  SELECT array_agg(DISTINCT p.nombre ORDER BY p.nombre)
    INTO v_pend
  FROM jsonb_array_elements(p_items) i
  JOIN public.reglas_despacho_pendientes r
    ON r.erp_product_id = (i->>'erp_product_id')::integer AND r.resuelto_at IS NULL
  JOIN public.products p ON p.id = r.erp_product_id;
  IF v_pend IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede generar: % la regla de despacho pendiente (%). Hay que resolverla en Pedidos → Reglas.',
      CASE WHEN cardinality(v_pend) = 1 THEN 'un producto tiene' ELSE cardinality(v_pend) || ' productos tienen' END,
      CASE WHEN cardinality(v_pend) > 2
           THEN array_to_string(v_pend[1:2], ', ') || ' y ' || (cardinality(v_pend) - 2) || ' más'
           ELSE array_to_string(v_pend, ', ') END;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'cantidad_asignada')::integer, 0);
    IF v_qty < 0 THEN
      RAISE EXCEPTION 'cantidad_asignada no puede ser negativa (product_id=%).', v_item->>'erp_product_id';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM erp_sucursal_map
      WHERE erp_sucursal_id = (v_item->>'erp_sucursal_id')::integer
    ) INTO v_suc_valid;
    IF NOT v_suc_valid THEN
      RAISE EXCEPTION 'erp_sucursal_id % no existe.', v_item->>'erp_sucursal_id';
    END IF;
  END LOOP;

  -- responsable_id/revisado_por: la única lógica cliente real hoy es
  -- "self o null" (esEmpleado ? user.id : null / siempre null) — se preserva
  -- ese comportamiento exacto pero resuelto server-side, sin aceptar un uuid
  -- de tercero.
  INSERT INTO pedidos (created_by, notes, responsable_id, revisado_por, sucursal_ids)
  VALUES (
    v_actor,
    p_notes,
    CASE WHEN p_responsable_id IS NOT NULL THEN v_actor ELSE NULL END,
    CASE WHEN p_revisado_por   IS NOT NULL THEN v_actor ELSE NULL END,
    p_sucursal_ids
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'cantidad_asignada')::integer, 0);
    INSERT INTO pedido_items (
      pedido_id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
      cantidad_asignada, sin_stock, revision_minmax,
      stock_packs_snapshot, max_qty_snapshot, min_qty_snapshot, urgencia_pct_snapshot,
      lotes_asignados,
      factor, dispatch_tipo, dispatch_factor, dispatch_multiplo,
      caja_especial, agotamiento,
      status, cantidad_recibida, received_at
    ) VALUES (
      v_pedido_id,
      (v_item->>'erp_sucursal_id')::integer,
      (v_item->>'erp_product_id')::integer,
      (v_item->>'erp_presentacion_id')::integer,
      v_qty,
      COALESCE((v_item->>'sin_stock')::boolean,       false),
      COALESCE((v_item->>'revision_minmax')::boolean,  false),
      (v_item->>'stock_packs_snapshot')::numeric,
      (v_item->>'max_qty_snapshot')::integer,
      (v_item->>'min_qty_snapshot')::integer,
      (v_item->>'urgencia_pct_snapshot')::integer,
      CASE WHEN v_qty > 0 THEN (v_item->'lotes_asignados') ELSE NULL END,
      (v_item->>'factor')::numeric,
      v_item->>'dispatch_tipo',
      (v_item->>'dispatch_factor')::numeric,
      COALESCE((v_item->>'dispatch_multiplo')::smallint, 1),
      COALESCE((v_item->>'caja_especial')::boolean, false),
      COALESCE((v_item->>'agotamiento')::boolean,    false),
      CASE WHEN v_qty = 0 THEN 'recibido'  ELSE 'pendiente' END,
      CASE WHEN v_qty = 0 THEN 0           ELSE NULL        END,
      CASE WHEN v_qty = 0 THEN now()       ELSE NULL        END
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$function$;
