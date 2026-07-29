-- Conteo de Inventario — el ciego se impone en el servidor, no en la vista
--
-- Antes: `const [ciego, setCiego] = useState(true)` + un <Switch>. El número del
-- sistema viajaba SIEMPRE en la respuesta y la vista decidía pintarlo o no, así
-- que "conteo ciego" era una cortesía: apagar el switch, o mirar la respuesta en
-- el inspector, alcanzaba. Un conteo ciego que se puede desactivar no es un
-- control interno, es una etiqueta.
--
-- Ahora el número NO SALE de la base si el llamador no puede verlo, y quién
-- puede se define con el permiso `conteo_ver_sistema` (v1).
--
-- Regla: se ve el sistema si el conteo YA ESTÁ CERRADO (FINALIZADO/CERRADO —
-- ahí los números son el resultado y no hay nada que sesgar) O si tenés el
-- permiso. Mientras está abierto y no lo tenés, es ciego y no hay switch que
-- lo cambie.
--
-- Hay CINCO caminos que devuelven el dato y los cinco tienen que respetarlo;
-- tapar solo la tabla dejaba tres puertas abiertas:
--   1. get_conteo_items_search      → las líneas de la tabla
--   2. get_conteo_products_page     → los totales por producto
--   3. get_conteo_items_jsonb       → lo que alimenta los PDF y el CSV
--   4. get_conteo_items_count       → el filtro "con diferencia" REVELA qué
--   5. get_conteo_products_count       líneas descuadran sin mostrar un número:
--                                      con el conteo ciego ese filtro no filtra.
--
-- De paso: nombre CORTO (primer nombre + primer apellido, convención del
-- proyecto) y `photo_url` cruda para que el frontend la firme con
-- signPhotosDeep — en BD nunca se guarda ni se devuelve una URL firmada.

SET lock_timeout = '5s';

-- ── el predicado, en un solo lugar ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conteo_puede_ver_sistema(p_conteo_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM public.conteos_inventario c
           WHERE c.id = p_conteo_id
             AND c.status NOT IN ('BORRADOR', 'EN_PROGRESO')
         )
         OR public.auth_has_module_permission('conteo_ver_sistema', 'can_view');
$function$;

REVOKE EXECUTE ON FUNCTION public.conteo_puede_ver_sistema(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteo_puede_ver_sistema(uuid) TO authenticated, service_role;

-- El historial se consulta por item_id en cada línea de la página (contador de
-- ediciones) y en el modal. Sin índice eso era un seq scan por fila.
CREATE INDEX IF NOT EXISTS idx_conteo_item_history_item
    ON public.conteo_inventario_item_history (item_id);

-- ── 1. las líneas ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_conteo_items_search(uuid, text, text, integer, integer, integer);
CREATE FUNCTION public.get_conteo_items_search(
    p_conteo_id uuid,
    p_search text DEFAULT NULL::text,
    p_filtro text DEFAULT 'TODOS'::text,
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0,
    p_erp_product_id integer DEFAULT NULL::integer
) RETURNS TABLE(
    id uuid, erp_product_id integer, presentacion text, detalle text, lote text,
    fecha_vencimiento date, is_vencidos boolean, sistema_cantidad integer,
    fisico_cantidad integer, diferencia integer, estado_item text, nota text,
    costo_unitario numeric, es_agregado_manual boolean, product_nombre text,
    es_antibiotico boolean, foto_url text, laboratorio_nombre text,
    contado_por_nombre text, contado_at timestamp with time zone,
    fisico_primer_conteo integer, recontado_at timestamp with time zone,
    recontado_por_nombre text,
    contado_por_photo_url text, recontado_por_photo_url text,
    ediciones_count integer, ver_sistema boolean
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  -- Filtrar por "con diferencia" con el conteo ciego señalaría exactamente las
  -- líneas que descuadran: el mismo dato, servido como filtro.
  v_filtro := CASE WHEN p_filtro = 'DIFERENCIA' AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre,
           NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS e_nombre,
           NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS r_nombre,
           e.photo_url AS e_photo, r.photo_url AS r_photo
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
    WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
           OR (v_filtro = 'PENDIENTES' AND b.estado_item = 'PENDIENTE')
           OR (v_filtro = 'DIFERENCIA' AND b.diferencia IS NOT NULL AND b.diferencia != 0)
           OR (v_filtro = 'SIN_UBICAR' AND b.estado_item = 'SIN_UBICAR'))
      AND (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.lote,'') || ' ' ||
             coalesce(b.l_nombre,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
    ORDER BY b.l_nombre NULLS LAST, b.p_nombre, b.lote
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    f.id, f.erp_product_id, f.presentacion, f.detalle, f.lote, f.fecha_vencimiento, f.is_vencidos,
    -- El sistema: en vivo mientras la línea no se haya contado, y NULL si el
    -- llamador no puede verlo. `fisico_cantidad` nunca se tapa: es el dato que
    -- la persona misma anotó y necesita ver en la línea ya confirmada.
    CASE WHEN NOT v_ver THEN NULL
         WHEN f.fisico_cantidad IS NULL AND NOT f.es_agregado_manual THEN COALESCE(li.sistema_live, 0)
         ELSE f.sistema_cantidad END,
    f.fisico_cantidad,
    CASE WHEN v_ver THEN f.diferencia END,
    f.estado_item, f.nota,
    CASE WHEN v_ver THEN f.costo_unitario END,
    f.es_agregado_manual,
    f.p_nombre, f.p_es_antibiotico, f.p_foto_url, f.l_nombre,
    f.e_nombre, f.contado_at,
    -- El primer conteo es justamente lo que el recuento no debe ver de antemano.
    CASE WHEN v_ver THEN f.fisico_primer_conteo END,
    f.recontado_at, f.r_nombre,
    f.e_photo, f.r_photo,
    (SELECT count(*)::int FROM public.conteo_inventario_item_history h
      WHERE h.item_id = f.id AND h.evento IN ('EDICION', 'BORRADO')),
    v_ver
  FROM filtered f
  LEFT JOIN live_inv li ON li.sync_key = f.source_sync_key;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_items_search(uuid, text, text, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_search(uuid, text, text, integer, integer, integer) TO authenticated, service_role;

-- ── 2. los totales por producto ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_conteo_products_page(uuid, text, text, integer, integer);
CREATE FUNCTION public.get_conteo_products_page(
    p_conteo_id uuid,
    p_search text DEFAULT NULL::text,
    p_filtro text DEFAULT 'TODOS'::text,
    p_limit integer DEFAULT 25,
    p_offset integer DEFAULT 0
) RETURNS TABLE(
    erp_product_id integer, product_nombre text, laboratorio_nombre text,
    es_antibiotico boolean, foto_url text, item_count integer, contados_count integer,
    sistema_total integer, fisico_total integer, diferencia_total integer,
    con_diferencia_count integer, con_vencidos_count integer, con_proximos_count integer,
    sin_ubicar_count integer, ver_sistema boolean
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  v_filtro := CASE WHEN p_filtro = 'DIFERENCIA' AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

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
    pp.item_count, pp.contados_count,
    CASE WHEN v_ver THEN pp.sistema_total END,
    pp.fisico_total,
    CASE WHEN v_ver THEN pp.diferencia_total END,
    CASE WHEN v_ver THEN pp.con_diferencia_count END,
    pp.con_vencidos_count, pp.con_proximos_count,
    -- sin_ubicar sale del CONTEO, no del sistema: es un hallazgo de quien contó
    -- ("lo busqué y no está"), así que se ve aunque el conteo sea ciego.
    pp.sin_ubicar_count,
    v_ver
  FROM per_product pp
  WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
         OR (v_filtro = 'PENDIENTES' AND pp.contados_count < pp.item_count)
         OR (v_filtro = 'DIFERENCIA' AND pp.con_diferencia_count > 0)
         OR (v_filtro = 'SIN_UBICAR' AND pp.sin_ubicar_count > 0))
  -- Como el anaquel: laboratorio primero, producto adentro. Los sin laboratorio
  -- al final, para que no partan el recorrido.
  ORDER BY pp.laboratorio_nombre NULLS LAST, pp.product_nombre
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_products_page(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_products_page(uuid, text, text, integer, integer) TO authenticated, service_role;

-- ── 3. lo que alimenta los PDF y el CSV ─────────────────────────────────────
-- printHojaConteo ya sabía imprimir ciego, pero el dato le llegaba igual y el
-- flag lo ponía la vista. Si el llamador es ciego, la hoja sale sin sistema
-- porque no hay sistema que imprimir.
CREATE OR REPLACE FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  RETURN (
    SELECT coalesce(json_agg(to_json(t)), '[]'::json)
    FROM (
      SELECT ci.id, ci.erp_product_id, ci.presentacion, ci.detalle, ci.lote, ci.fecha_vencimiento, ci.is_vencidos,
        CASE WHEN NOT v_ver THEN NULL
             WHEN ci.fisico_cantidad IS NULL AND NOT ci.es_agregado_manual THEN
               COALESCE((
                 SELECT i.cantidad FROM public.inventory i
                 WHERE i.sync_key = ci.source_sync_key
                   AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
               ), 0)
             ELSE ci.sistema_cantidad
        END AS sistema_cantidad,
        CASE WHEN v_ver THEN ci.sistema_inicial END AS sistema_inicial,
        ci.fisico_cantidad,
        CASE WHEN v_ver THEN ci.diferencia END AS diferencia,
        ci.estado_item, ci.nota,
        CASE WHEN v_ver THEN ci.costo_unitario END AS costo_unitario,
        ci.es_agregado_manual,
        CASE WHEN v_ver THEN ci.fisico_primer_conteo END AS fisico_primer_conteo,
        ci.recontado_at,
        p.nombre AS product_nombre, p.es_antibiotico, p.foto_url, p.codigo_barras, l.nombre AS laboratorio_nombre,
        NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS contado_por_nombre,
        NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS recontado_por_nombre,
        ci.contado_at,
        v_ver AS ver_sistema
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

-- ── 4 y 5. los conteos: el filtro de diferencia no filtra si sos ciego ──────
CREATE OR REPLACE FUNCTION public.get_conteo_items_count(
    p_conteo_id uuid,
    p_search text DEFAULT NULL::text,
    p_filtro text DEFAULT 'TODOS'::text,
    p_erp_product_id integer DEFAULT NULL::integer
) RETURNS bigint
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS (
    SELECT CASE WHEN p_filtro = 'DIFERENCIA' AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
                THEN 'TODOS' ELSE p_filtro END AS filtro
  ),
  base AS MATERIALIZED (
    SELECT ci.estado_item, ci.diferencia, ci.lote, ci.presentacion, ci.erp_product_id,
           p.nombre AS product_nombre, l.nombre AS laboratorio_nombre
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_erp_product_id IS NULL OR ci.erp_product_id = p_erp_product_id)
  )
  SELECT count(*) FROM base, cfg
  WHERE (cfg.filtro = 'TODOS' OR cfg.filtro IS NULL
         OR (cfg.filtro = 'PENDIENTES' AND base.estado_item = 'PENDIENTE')
         OR (cfg.filtro = 'DIFERENCIA' AND base.diferencia IS NOT NULL AND base.diferencia != 0)
         OR (cfg.filtro = 'SIN_UBICAR' AND base.estado_item = 'SIN_UBICAR'))
    AND (p_search IS NULL OR p_search = ''
         OR public.norm_search(
              coalesce(base.product_nombre,'') || ' ' || coalesce(base.lote,'') || ' ' ||
              coalesce(base.laboratorio_nombre,'') || ' ' || coalesce(base.presentacion,'')
            ) LIKE ALL (
              ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
            ));
$function$;

CREATE OR REPLACE FUNCTION public.get_conteo_products_count(
    p_conteo_id uuid,
    p_search text DEFAULT NULL::text,
    p_filtro text DEFAULT 'TODOS'::text
) RETURNS bigint
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS (
    SELECT CASE WHEN p_filtro = 'DIFERENCIA' AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
                THEN 'TODOS' ELSE p_filtro END AS filtro
  ),
  base AS MATERIALIZED (
    SELECT ci.erp_product_id, ci.estado_item, ci.diferencia, ci.lote, ci.presentacion,
           p.nombre AS product_nombre, l.nombre AS laboratorio_nombre
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
  ),
  matched AS (
    SELECT DISTINCT erp_product_id FROM base
    WHERE (p_search IS NULL OR p_search = ''
           OR public.norm_search(
                coalesce(product_nombre,'') || ' ' || coalesce(laboratorio_nombre,'') || ' ' ||
                coalesce(lote,'') || ' ' || coalesce(presentacion,'')
              ) LIKE ALL (
                ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
              ))
  ),
  per_product AS (
    SELECT b.erp_product_id,
           count(*) AS item_count,
           count(*) FILTER (WHERE b.estado_item != 'PENDIENTE') AS contados_count,
           count(*) FILTER (WHERE b.diferencia IS NOT NULL AND b.diferencia != 0) AS con_diferencia_count,
           count(*) FILTER (WHERE b.estado_item = 'SIN_UBICAR') AS sin_ubicar_count
    FROM base b
    WHERE b.erp_product_id IN (SELECT erp_product_id FROM matched)
    GROUP BY b.erp_product_id
  )
  SELECT count(*) FROM per_product, cfg
  WHERE (cfg.filtro = 'TODOS' OR cfg.filtro IS NULL
         OR (cfg.filtro = 'PENDIENTES' AND per_product.contados_count < per_product.item_count)
         OR (cfg.filtro = 'DIFERENCIA' AND per_product.con_diferencia_count > 0)
         OR (cfg.filtro = 'SIN_UBICAR' AND per_product.sin_ubicar_count > 0));
$function$;

-- ── el historial: quién, con foto, y QUÉ hizo ───────────────────────────────
DROP FUNCTION IF EXISTS public.get_conteo_item_history(uuid);
CREATE FUNCTION public.get_conteo_item_history(p_item_id uuid)
RETURNS TABLE(
    id uuid, evento text, fisico_cantidad integer, sistema_cantidad integer,
    diferencia integer, estado_item text, nota text,
    contado_por_nombre text, contado_por_photo_url text,
    contado_at timestamp with time zone
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ver boolean;
BEGIN
  SELECT public.conteo_puede_ver_sistema(ci.conteo_id) INTO v_ver
  FROM public.conteo_inventario_items ci WHERE ci.id = p_item_id;

  RETURN QUERY
  SELECT h.id, h.evento, h.fisico_cantidad,
         CASE WHEN v_ver THEN h.sistema_cantidad END,
         CASE WHEN v_ver THEN h.diferencia END,
         h.estado_item, h.nota,
         NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS contado_por_nombre,
         e.photo_url AS contado_por_photo_url,
         h.contado_at
  FROM public.conteo_inventario_item_history h
  LEFT JOIN public.employees e ON e.id = h.contado_por
  WHERE h.item_id = p_item_id
  ORDER BY h.contado_at DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_item_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_item_history(uuid) TO authenticated, service_role;
