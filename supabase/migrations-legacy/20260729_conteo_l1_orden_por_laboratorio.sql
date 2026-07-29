SET lock_timeout = '5s';

-- ─── L1 — La grilla se ordena como está el anaquel ──────────────────────────
-- En las sucursales el producto está acomodado POR LABORATORIO. Ordenar la
-- pantalla por nombre de producto (o por valor del desvío, como quedó en R1b)
-- obliga a zigzaguear la farmacia entera para contar o recontar.
--
-- Se cae el orden por valor que había puesto el filtro de diferencias: la razón
-- física gana. Dentro de cada laboratorio el orden sigue siendo alfabético por
-- producto, que es como está la góndola.
--
-- El orden alfabético ya reproduce el numérico: de 356 laboratorios, 57 traen
-- prefijo numérico y ninguno pasa de un dígito, así que no aparece el clásico
-- "10- antes que 2-".

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
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento >= CURRENT_DATE AND w.fecha_vencimiento <= CURRENT_DATE + 90)::int AS con_proximos_count,
      count(*) FILTER (WHERE w.estado_item = 'SIN_UBICAR')::int AS sin_ubicar_count
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
         OR (p_filtro = 'DIFERENCIA' AND pp.con_diferencia_count > 0)
         OR (p_filtro = 'SIN_UBICAR' AND pp.sin_ubicar_count > 0))
  -- Como el anaquel: laboratorio primero, producto adentro. Los sin laboratorio
  -- al final, para que no partan el recorrido.
  ORDER BY pp.laboratorio_nombre NULLS LAST, pp.product_nombre
  LIMIT p_limit OFFSET p_offset;
END;
$function$;


-- Mismo criterio para las líneas: cuando no se pide un producto puntual (la
-- expansión de una fila), la lista general también recorre por laboratorio.
CREATE OR REPLACE FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_erp_product_id integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, erp_product_id integer, presentacion text, detalle text, lote text, fecha_vencimiento date, is_vencidos boolean, sistema_cantidad integer, fisico_cantidad integer, diferencia integer, estado_item text, nota text, costo_unitario numeric, es_agregado_manual boolean, product_nombre text, es_antibiotico boolean, foto_url text, laboratorio_nombre text, contado_por_nombre text, contado_at timestamp with time zone, fisico_primer_conteo integer, recontado_at timestamp with time zone, recontado_por_nombre text)
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
           NULLIF(TRIM(COALESCE(e.first_names,'') || ' ' || COALESCE(e.last_names,'')), '') AS e_nombre,
           NULLIF(TRIM(COALESCE(r.first_names,'') || ' ' || COALESCE(r.last_names,'')), '') AS r_nombre
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN public.employees e ON e.id = ci.contado_por
    LEFT JOIN public.employees r ON r.id = ci.recontado_por
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
    ORDER BY b.l_nombre NULLS LAST, b.p_nombre, b.lote
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
    f.e_nombre, f.contado_at,
    f.fisico_primer_conteo, f.recontado_at, f.r_nombre
  FROM filtered f
  LEFT JOIN live_inv li ON li.sync_key = f.source_sync_key;
END;
$function$;


-- El payload de impresión ya salía por producto; que salga por laboratorio para
-- que la hoja impresa siga el mismo recorrido que la pantalla.
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
        ci.sistema_inicial,
        ci.fisico_cantidad, ci.diferencia, ci.estado_item, ci.nota, ci.costo_unitario, ci.es_agregado_manual,
        ci.fisico_primer_conteo, ci.recontado_at,
        p.nombre AS product_nombre, p.es_antibiotico, p.foto_url, p.codigo_barras, l.nombre AS laboratorio_nombre,
        NULLIF(TRIM(COALESCE(e.first_names,'') || ' ' || COALESCE(e.last_names,'')), '') AS contado_por_nombre,
        NULLIF(TRIM(COALESCE(r.first_names,'') || ' ' || COALESCE(r.last_names,'')), '') AS recontado_por_nombre,
        ci.contado_at
      FROM public.conteo_inventario_items ci
      LEFT JOIN public.products p ON p.id = ci.erp_product_id
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      LEFT JOIN public.employees e ON e.id = ci.contado_por
      LEFT JOIN public.employees r ON r.id = ci.recontado_por
      WHERE ci.conteo_id = p_conteo_id
      ORDER BY l.nombre NULLS LAST, p.nombre, ci.lote
    ) t
  );
END;
$function$;
