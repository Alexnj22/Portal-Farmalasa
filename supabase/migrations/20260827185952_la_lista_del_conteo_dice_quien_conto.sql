SET lock_timeout = '5s';

-- ── El id de quien contó y de quien recontó, en la lista del conteo ─────────
--
-- Última de las cuatro (ver 20260827185652 y 20260827185838). Misma historia:
-- la función resolvía nombre y foto en SQL y no devolvía el id, así que la foto
-- de quien contó no podía llevar su aro de estado (DESIGN.md §5.4). Las
-- columnas crudas `contado_por` y `recontado_por` de
-- `conteo_inventario_items` siempre fueron ids — el LEFT JOIN a `employees` va
-- por ellas.
--
-- Las dos columnas nuevas van al FINAL de la lista: el orden de `RETURNS TABLE`
-- tiene que coincidir con el del SELECT, y agregarlas en el medio obligaría a
-- recontar treinta posiciones a mano por ningún beneficio — PostgREST devuelve
-- JSON con nombres, así que al navegador el orden le da igual.
--
-- DROP + CREATE porque `RETURNS TABLE` no admite columnas nuevas con CREATE OR
-- REPLACE. En una sola migración es atómico.
DROP FUNCTION IF EXISTS public.get_conteo_items_search(uuid, text, text, integer, integer, integer, integer[], text);

CREATE FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_erp_product_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[], p_area text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, erp_product_id integer, presentacion text, detalle text, lote text, fecha_vencimiento date, is_vencidos boolean, sistema_cantidad integer, fisico_cantidad integer, diferencia integer, estado_item text, nota text, costo_unitario numeric, es_agregado_manual boolean, product_nombre text, es_antibiotico boolean, foto_url text, laboratorio_nombre text, contado_por_nombre text, contado_at timestamp with time zone, fisico_primer_conteo integer, recontado_at timestamp with time zone, recontado_por_nombre text, contado_por_photo_url text, recontado_por_photo_url text, ediciones_count integer, ver_sistema boolean, factor integer, grupo_mixto boolean, diferencia_grupo integer, contado_por uuid, recontado_por uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_modo text;
  v_fuente text;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id, c.modo, c.fuente_sistema INTO v_branch_id, v_modo, v_fuente
  FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  v_filtro := CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  RETURN QUERY
  WITH neto AS MATERIALIZED (
    SELECT * FROM public.conteo_lineas_netas(p_conteo_id)
  ),
  base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre,
           NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS e_nombre,
           NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS r_nombre,
           e.photo_url AS e_photo, r.photo_url AS r_photo, p.codigo_barras AS p_codigo,
           nt.factor AS n_factor, nt.grupo_mixto AS n_mixto, nt.neto_grupo AS n_neto
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN public.employees e ON e.id = ci.contado_por
    LEFT JOIN public.employees r ON r.id = ci.recontado_por
    LEFT JOIN neto nt ON nt.item_id = ci.id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_erp_product_id IS NULL OR ci.erp_product_id = p_erp_product_id)
      AND (p_erp_product_ids IS NULL OR ci.erp_product_id = ANY(p_erp_product_ids))
      -- Los renglones del área de vencidos son de otro anaquel: la sección que
      -- los pide NO tiene que recibir los de la bodega normal del mismo
      -- producto, y al revés. Sin esto, los 42 productos que están en las dos
      -- mostrarían sus dos juegos de renglones en las dos secciones.
      AND (p_area IS NULL OR (p_area = 'VENCIDOS') = ci.is_vencidos)
  ),
  live_raw AS MATERIALIZED (
    SELECT i.sync_key, i.erp_product_id AS r_pid, i.is_vencidos AS r_venc, i.cantidad::int AS cantidad,
           CASE WHEN v_modo = 'SIMPLE' THEN NULL ELSE i.lote END AS r_lote,
           CASE WHEN v_modo = 'SIMPLE' THEN NULL ELSE i.fecha_vencimiento END AS r_fecha,
           upper(btrim(COALESCE(i.presentacion, ''))) AS r_pres,
           COALESCE(g.grupo_key, 'P:' || upper(btrim(COALESCE(i.presentacion, '')))) AS r_key
    FROM public.inventory i
    LEFT JOIN public.conteo_presentacion_grupo g
           ON g.product_id = i.erp_product_id
          AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
    WHERE v_fuente = 'VIVO' AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
  ),
  live_inv AS MATERIALIZED (
    SELECT r.sync_key, r.cantidad AS sistema_live FROM live_raw r WHERE v_modo <> 'SIMPLE'
  ),
  live_grp AS MATERIALIZED (
    SELECT r.r_pid AS g_pid, r.r_venc AS g_venc, r.r_lote AS g_lote, r.r_fecha AS g_fecha,
           r.r_key AS g_key, sum(r.cantidad)::int AS sistema_live
    FROM live_raw r GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT r.r_pid, r.r_venc, r.r_lote, r.r_fecha, 'P:' || r.r_pres, sum(r.cantidad)::int
    FROM live_raw r WHERE 'P:' || r.r_pres <> r.r_key GROUP BY 1, 2, 3, 4, 5
  ),
  filtered AS (
    SELECT b.* FROM base b
    WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
           OR (v_filtro = 'PENDIENTES' AND b.estado_item = 'PENDIENTE')
           -- Un renglón cuyo grupo cuadra en unidades no es una diferencia: sin
           -- esto el recuento a ciegas mandaría a recontar la caja sin abrir.
           OR (v_filtro = 'DIFERENCIA' AND b.diferencia IS NOT NULL AND b.diferencia != 0
               AND coalesce(b.n_neto, 0) != 0)
           OR (v_filtro = 'SIN_UBICAR' AND b.estado_item = 'SIN_UBICAR'))
      AND (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.lote,'') || ' ' ||
             coalesce(b.l_nombre,'') || ' ' || coalesce(b.presentacion,'') || ' ' ||
             coalesce(b.p_codigo,'')
           ) LIKE ALL (v_pats))
    -- `presentacion` como último desempate: en SIMPLE el lote es NULL en todos
    -- los renglones, y sin él dos presentaciones del mismo producto quedaban en
    -- orden arbitrario — o sea con una página inestable entre llamadas.
    ORDER BY b.l_nombre NULLS LAST, b.p_nombre, b.lote, b.presentacion
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    f.id, f.erp_product_id, f.presentacion, f.detalle, f.lote, f.fecha_vencimiento, f.is_vencidos,
    CASE WHEN NOT v_ver THEN NULL
         WHEN f.fisico_cantidad IS NULL AND NOT f.es_agregado_manual THEN
           CASE WHEN v_fuente = 'HOJA'
                THEN COALESCE(f.sistema_inicial, f.sistema_cantidad)
                ELSE COALESCE(li.sistema_live, lg.sistema_live, 0) END
         ELSE f.sistema_cantidad END,
    f.fisico_cantidad,
    CASE WHEN v_ver THEN f.diferencia END,
    f.estado_item, f.nota,
    CASE WHEN v_ver THEN f.costo_unitario END,
    f.es_agregado_manual,
    f.p_nombre, f.p_es_antibiotico, f.p_foto_url, f.l_nombre,
    f.e_nombre, f.contado_at,
    CASE WHEN v_ver THEN f.fisico_primer_conteo END,
    f.recontado_at, f.r_nombre,
    f.e_photo, f.r_photo,
    (SELECT count(*)::int FROM public.conteo_inventario_item_history h
      WHERE h.item_id = f.id AND h.evento IN ('EDICION', 'BORRADO')),
    v_ver,
    f.n_factor,
    coalesce(f.n_mixto, false),
    CASE WHEN v_ver THEN f.n_neto END,
    f.contado_por,
    f.recontado_por
  FROM filtered f
  LEFT JOIN live_inv li ON li.sync_key = f.source_sync_key
  LEFT JOIN live_grp lg ON lg.g_pid = f.erp_product_id
                       AND lg.g_venc = f.is_vencidos
                       AND lg.g_key = f.grupo_key
                       AND lg.g_lote IS NOT DISTINCT FROM f.lote
                       AND lg.g_fecha IS NOT DISTINCT FROM f.fecha_vencimiento
  ORDER BY f.l_nombre NULLS LAST, f.p_nombre, f.lote, f.presentacion;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_items_search(uuid, text, text, integer, integer, integer, integer[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteo_items_search(uuid, text, text, integer, integer, integer, integer[], text) TO authenticated, service_role;
