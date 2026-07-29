SET lock_timeout = '5s';

-- ─── C1 — La línea del conteo es una fila del ERP, no un grupo ──────────────
-- El snapshot copiaba una línea por fila de inventory, pero la relectura en
-- vivo agrupaba por (producto, presentacion, lote, is_vencidos): una clave que
-- INCLUYE presentacion — que el sync sobrescribe, no es identidad — y OMITE
-- detalle y fecha_vencimiento — que sí lo son. Resultado medido sobre el conteo
-- abierto: 1,243 de 4,782 líneas (26%) mostraban el total de su grupo, 12,588
-- unidades donde había 4,634. Cada línea hermana producía un faltante fantasma.
--
-- inventory.sync_key ('sucursal|vencidos|producto|lote|detalle|fecha_venc') es
-- la identidad real del ERP: UNIQUE global y estable entre syncs (el upsert va
-- ON CONFLICT (sync_key)). source_inventory_id NO sirve: 1,170 de las 4,782
-- líneas ya apuntaban a filas borradas y reinsertadas por el sync.

ALTER TABLE public.conteo_inventario_items
  ADD COLUMN IF NOT EXISTS source_sync_key text;

CREATE INDEX IF NOT EXISTS idx_conteo_items_source_sync_key
  ON public.conteo_inventario_items(source_sync_key);

-- Backfill del conteo abierto. La reconstrucción desde las columnas propias del
-- ítem se verificó exacta contra las 3,612 líneas cuyo source_inventory_id
-- todavía resuelve (3,612/3,612 coinciden); recupera además 320 huérfanas.
UPDATE public.conteo_inventario_items ci
SET source_sync_key =
      m.erp_sucursal_id || '|' || lower(ci.is_vencidos::text) || '|' || ci.erp_product_id || '|' ||
      coalesce(ci.lote,'') || '|' || coalesce(ci.detalle,'') || '|' ||
      coalesce(ci.fecha_vencimiento::text,'')
FROM public.conteos_inventario c
JOIN public.erp_sucursal_map m ON m.branch_id = c.branch_id
WHERE c.id = ci.conteo_id
  AND ci.source_sync_key IS NULL
  AND NOT ci.es_agregado_manual;


-- ─── El snapshot guarda la identidad ────────────────────────────────────────
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
  SELECT v_conteo_id, i.erp_product_id, i.id, i.sync_key, i.presentacion, i.detalle, i.lote, i.fecha_vencimiento, i.is_vencidos, i.cantidad, pp.costo
  FROM public.inventory i
  LEFT JOIN public.products p ON p.id = i.erp_product_id
  LEFT JOIN LATERAL (
    SELECT MIN(costo) AS costo FROM public.product_precios WHERE product_id = i.erp_product_id AND activo = true
  ) pp ON true
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


-- ─── Guardado: relee la fila exacta del ERP ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text DEFAULT NULL::text, p_estado_item text DEFAULT 'CONTADO'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_live_sistema int4;
  v_diferencia int4;
BEGIN
  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF p_estado_item NOT IN ('PENDIENTE','CONTADO','SIN_UBICAR') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO';
  END IF;

  IF v_item.es_agregado_manual OR v_item.source_sync_key IS NULL THEN
    -- Producto/lote que no estaba en el snapshot original: no hay fila real
    -- de inventory que releer, se queda en el sistema=0 con el que se creó.
    v_live_sistema := v_item.sistema_cantidad;
  ELSE
    -- sync_key es UNIQUE: esto lee UNA fila, la misma que originó la línea.
    -- Si el ERP ya no la tiene (lote agotado), 0 es la respuesta correcta.
    SELECT COALESCE((SELECT cantidad FROM public.inventory WHERE sync_key = v_item.source_sync_key), 0)
    INTO v_live_sistema;
  END IF;

  v_diferencia := CASE WHEN p_fisico_cantidad IS NULL THEN NULL ELSE p_fisico_cantidad - v_live_sistema END;

  UPDATE public.conteo_inventario_items
  SET fisico_cantidad = p_fisico_cantidad,
      sistema_cantidad = v_live_sistema,
      diferencia = v_diferencia,
      estado_item = p_estado_item,
      nota = p_nota,
      contado_por = public.auth_employee_id(),
      contado_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.conteo_inventario_item_history (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por)
  VALUES (p_item_id, p_fisico_cantidad, v_live_sistema, v_diferencia, p_estado_item, p_nota, public.auth_employee_id());

  RETURN jsonb_build_object('sistema_cantidad', v_live_sistema, 'diferencia', v_diferencia);
END;
$function$;


-- ─── Lectura por página de producto ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_conteo_products_page(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(erp_product_id integer, product_nombre text, laboratorio_nombre text, es_antibiotico boolean, foto_url text, item_count integer, contados_count integer, sistema_total integer, fisico_total integer, diferencia_total integer, con_diferencia_count integer, con_vencidos_count integer, con_proximos_count integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
  ),
  -- sync_key es UNIQUE: una fila del ERP por línea del conteo, sin agregación
  -- (agrupar era justo el bug — sumaba los lotes hermanos en cada hermano).
  live_inv AS MATERIALIZED (
    SELECT i.sync_key, i.cantidad::int AS sistema_live
    FROM public.inventory i
    WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
  ),
  matched AS (
    SELECT DISTINCT b.erp_product_id AS m_erp_product_id FROM base b
    WHERE (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.l_nombre,'') || ' ' ||
             coalesce(b.lote,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
  ),
  with_live AS (
    SELECT b.*,
           CASE
             WHEN b.fisico_cantidad IS NULL AND NOT b.es_agregado_manual THEN COALESCE(li.sistema_live, 0)
             ELSE b.sistema_cantidad
           END AS sistema_now
    FROM base b
    LEFT JOIN live_inv li ON li.sync_key = b.source_sync_key
    WHERE b.erp_product_id IN (SELECT m.m_erp_product_id FROM matched m)
  ),
  per_product AS (
    SELECT
      w.erp_product_id,
      max(w.p_nombre) AS product_nombre,
      max(w.l_nombre) AS laboratorio_nombre,
      bool_or(w.p_es_antibiotico) AS es_antibiotico,
      max(w.p_foto_url) AS foto_url,
      count(*)::int AS item_count,
      count(*) FILTER (WHERE w.estado_item != 'PENDIENTE')::int AS contados_count,
      sum(w.sistema_now)::int AS sistema_total,
      sum(w.fisico_cantidad)::int AS fisico_total,
      sum(w.diferencia)::int AS diferencia_total,
      count(*) FILTER (WHERE w.diferencia IS NOT NULL AND w.diferencia != 0)::int AS con_diferencia_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento < CURRENT_DATE)::int AS con_vencidos_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento >= CURRENT_DATE AND w.fecha_vencimiento <= CURRENT_DATE + 90)::int AS con_proximos_count
    FROM with_live w
    GROUP BY w.erp_product_id
  )
  SELECT
    pp.erp_product_id, pp.product_nombre, pp.laboratorio_nombre, pp.es_antibiotico, pp.foto_url,
    pp.item_count, pp.contados_count, pp.sistema_total, pp.fisico_total, pp.diferencia_total, pp.con_diferencia_count,
    pp.con_vencidos_count, pp.con_proximos_count
  FROM per_product pp
  WHERE (p_filtro = 'TODOS' OR p_filtro IS NULL
         OR (p_filtro = 'PENDIENTES' AND pp.contados_count < pp.item_count)
         OR (p_filtro = 'DIFERENCIA' AND pp.con_diferencia_count > 0))
  ORDER BY pp.product_nombre
  LIMIT p_limit OFFSET p_offset;
END;
$function$;


-- ─── Lectura de líneas ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_erp_product_id integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, erp_product_id integer, presentacion text, detalle text, lote text, fecha_vencimiento date, is_vencidos boolean, sistema_cantidad integer, fisico_cantidad integer, diferencia integer, estado_item text, nota text, costo_unitario numeric, es_agregado_manual boolean, product_nombre text, es_antibiotico boolean, foto_url text, laboratorio_nombre text, contado_por_nombre text, contado_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre,
           NULLIF(TRIM(COALESCE(e.first_names,'') || ' ' || COALESCE(e.last_names,'')), '') AS e_nombre
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN public.employees e ON e.id = ci.contado_por
    WHERE ci.conteo_id = p_conteo_id
      AND (p_erp_product_id IS NULL OR ci.erp_product_id = p_erp_product_id)
  ),
  live_inv AS MATERIALIZED (
    SELECT i.sync_key, i.cantidad::int AS sistema_live
    FROM public.inventory i
    WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
  ),
  filtered AS (
    SELECT b.* FROM base b
    WHERE (p_filtro = 'TODOS' OR p_filtro IS NULL
           OR (p_filtro = 'PENDIENTES' AND b.estado_item = 'PENDIENTE')
           OR (p_filtro = 'DIFERENCIA' AND b.diferencia IS NOT NULL AND b.diferencia != 0)
           OR (p_filtro = 'SIN_UBICAR' AND b.estado_item = 'SIN_UBICAR'))
      AND (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.lote,'') || ' ' ||
             coalesce(b.l_nombre,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
    ORDER BY b.p_nombre, b.lote
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    f.id, f.erp_product_id, f.presentacion, f.detalle, f.lote, f.fecha_vencimiento, f.is_vencidos,
    CASE
      WHEN f.fisico_cantidad IS NULL AND NOT f.es_agregado_manual THEN COALESCE(li.sistema_live, 0)
      ELSE f.sistema_cantidad
    END,
    f.fisico_cantidad, f.diferencia, f.estado_item, f.nota, f.costo_unitario, f.es_agregado_manual,
    f.p_nombre, f.p_es_antibiotico, f.p_foto_url, f.l_nombre,
    f.e_nombre, f.contado_at
  FROM filtered f
  LEFT JOIN live_inv li ON li.sync_key = f.source_sync_key;
END;
$function$;


-- ─── Payload completo para impresión (Patrón C: json_agg) ───────────────────
CREATE OR REPLACE FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  RETURN (
    SELECT coalesce(json_agg(to_json(t)), '[]'::json)
    FROM (
      SELECT ci.id, ci.erp_product_id, ci.presentacion, ci.detalle, ci.lote, ci.fecha_vencimiento, ci.is_vencidos,
        CASE
          WHEN ci.fisico_cantidad IS NULL AND NOT ci.es_agregado_manual THEN
            COALESCE((
              SELECT i.cantidad FROM public.inventory i
              WHERE i.sync_key = ci.source_sync_key
                AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
            ), 0)
          ELSE ci.sistema_cantidad
        END AS sistema_cantidad,
        ci.fisico_cantidad, ci.diferencia, ci.estado_item, ci.nota, ci.costo_unitario, ci.es_agregado_manual,
        p.nombre AS product_nombre, p.es_antibiotico, p.foto_url, l.nombre AS laboratorio_nombre,
        NULLIF(TRIM(COALESCE(e.first_names,'') || ' ' || COALESCE(e.last_names,'')), '') AS contado_por_nombre,
        ci.contado_at
      FROM public.conteo_inventario_items ci
      LEFT JOIN public.products p ON p.id = ci.erp_product_id
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      LEFT JOIN public.employees e ON e.id = ci.contado_por
      WHERE ci.conteo_id = p_conteo_id
      ORDER BY p.nombre, ci.lote
    ) t
  );
END;
$function$;
