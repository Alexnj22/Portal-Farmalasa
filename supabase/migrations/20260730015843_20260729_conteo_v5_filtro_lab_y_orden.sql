-- Conteo de Inventario — filtro por laboratorio y orden por columna.
--
-- Las dos cosas van juntas porque las dos son del MISMO problema: la lista de
-- renglones se pagina en el servidor (por producto, para que un producto con
-- muchos lotes no se parta entre dos páginas), así que ni el filtro ni el orden
-- pueden vivir en el cliente — filtrar o ordenar 25 filas de 2,500 da un
-- resultado que parece correcto y no lo es.
--
-- Se DROPEA la firma vieja en vez de dejar las dos. Un overload cuyos
-- parámetros extra tienen DEFAULT solo se puede llamar con la aridad máxima:
-- con las dos firmas vivas, la llamada de 5 argumentos que hace el portal hoy
-- pasaría a ser ambigua (42725) y la vista quedaría en blanco.
SET lock_timeout = '5s';

-- ── Los laboratorios que hay EN ESTE conteo ─────────────────────────────────
-- No sirve el catálogo completo (1,100+): el selector tiene que ofrecer solo lo
-- que está en el anaquel que se está contando, o el usuario elige un laboratorio
-- y la tabla queda vacía sin explicación.
--
-- `laboratorio_id = 0` es el centinela de "sin laboratorio". Existe porque hay
-- renglones así (1 de 2,500 en el conteo de La Popular) y sin la opción esas
-- líneas no serían alcanzables por ningún filtro — el mismo agujero que tenía
-- SIN_UBICAR antes de C7. Ningún laboratorio real tiene id 0.
CREATE OR REPLACE FUNCTION public.get_conteo_laboratorios(p_conteo_id uuid)
RETURNS TABLE(laboratorio_id integer, laboratorio_nombre text, item_count integer)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT COALESCE(p.laboratorio_id, 0)                    AS laboratorio_id,
         COALESCE(l.nombre, 'Sin laboratorio')            AS laboratorio_nombre,
         count(*)::int                                    AS item_count
  FROM public.conteo_inventario_items ci
  LEFT JOIN public.products p     ON p.id = ci.erp_product_id
  LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
  WHERE ci.conteo_id = p_conteo_id
  GROUP BY COALESCE(p.laboratorio_id, 0), COALESCE(l.nombre, 'Sin laboratorio')
  ORDER BY COALESCE(l.nombre, 'Sin laboratorio');
$$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_laboratorios(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteo_laboratorios(uuid) TO authenticated, service_role;

-- ── Cuenta de productos, con el laboratorio en el filtro ────────────────────
DROP FUNCTION IF EXISTS public.get_conteo_products_count(uuid, text, text);

CREATE OR REPLACE FUNCTION public.get_conteo_products_count(
  p_conteo_id      uuid,
  p_search         text    DEFAULT NULL,
  p_filtro         text    DEFAULT 'TODOS',
  p_laboratorio_id integer DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH cfg AS (
    SELECT CASE WHEN p_filtro = 'DIFERENCIA' AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
                THEN 'TODOS' ELSE p_filtro END AS filtro
  ),
  base AS MATERIALIZED (
    SELECT ci.erp_product_id, ci.estado_item, ci.diferencia, ci.lote, ci.presentacion,
           p.nombre AS product_nombre, l.nombre AS laboratorio_nombre,
           COALESCE(p.laboratorio_id, 0) AS laboratorio_id
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_laboratorio_id IS NULL OR COALESCE(p.laboratorio_id, 0) = p_laboratorio_id)
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_products_count(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteo_products_count(uuid, text, text, integer) TO authenticated, service_role;

-- ── Página de productos, con laboratorio y orden ────────────────────────────
DROP FUNCTION IF EXISTS public.get_conteo_products_page(uuid, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_conteo_products_page(
  p_conteo_id      uuid,
  p_search         text    DEFAULT NULL,
  p_filtro         text    DEFAULT 'TODOS',
  p_limit          integer DEFAULT 25,
  p_offset         integer DEFAULT 0,
  p_laboratorio_id integer DEFAULT NULL,
  p_order_by       text    DEFAULT NULL,
  p_order_dir      text    DEFAULT 'asc'
)
RETURNS TABLE(erp_product_id integer, product_nombre text, laboratorio_nombre text, es_antibiotico boolean, foto_url text, item_count integer, contados_count integer, sistema_total integer, fisico_total integer, diferencia_total integer, con_diferencia_count integer, con_vencidos_count integer, con_proximos_count integer, sin_ubicar_count integer, ver_sistema boolean)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_ob text;
  v_asc boolean := lower(coalesce(p_order_dir, 'asc')) <> 'desc';
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  v_filtro := CASE WHEN p_filtro = 'DIFERENCIA' AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  -- Lista blanca: cualquier otra cosa cae al orden por defecto. Y en conteo
  -- ciego, ordenar por sistema o por diferencia se ignora — ordenar la lista
  -- por el número que no se muestra lo revela igual, solo más despacio
  -- (es el mismo razonamiento que apaga el filtro "con diferencia").
  v_ob := CASE
            WHEN p_order_by IN ('sistema', 'diferencia') AND NOT v_ver THEN NULL
            WHEN p_order_by IN ('producto', 'laboratorio', 'lotes', 'progreso',
                                'sistema', 'fisico', 'diferencia') THEN p_order_by
            ELSE NULL
          END;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre, COALESCE(p.laboratorio_id, 0) AS p_lab_id
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_laboratorio_id IS NULL OR COALESCE(p.laboratorio_id, 0) = p_laboratorio_id)
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
  ),
  -- Dos claves de orden calculadas —una numérica y una de texto— en vez de SQL
  -- dinámico: la consulta queda estática (se lee, se explica y no admite
  -- inyección ni por descuido), y cada fila solo llena la que corresponde.
  ordenable AS (
    SELECT pp.*,
           CASE v_ob
             WHEN 'lotes'      THEN pp.item_count::numeric
             WHEN 'progreso'   THEN pp.contados_count::numeric / greatest(pp.item_count, 1)
             WHEN 'sistema'    THEN pp.sistema_total::numeric
             WHEN 'fisico'     THEN pp.fisico_total::numeric
             WHEN 'diferencia' THEN pp.diferencia_total::numeric
           END AS ord_num,
           CASE v_ob
             WHEN 'producto'    THEN pp.product_nombre
             WHEN 'laboratorio' THEN pp.laboratorio_nombre
           END AS ord_txt
    FROM per_product pp
  )
  SELECT
    o.erp_product_id, o.product_nombre, o.laboratorio_nombre, o.es_antibiotico, o.foto_url,
    o.item_count, o.contados_count,
    CASE WHEN v_ver THEN o.sistema_total END,
    o.fisico_total,
    CASE WHEN v_ver THEN o.diferencia_total END,
    CASE WHEN v_ver THEN o.con_diferencia_count END,
    o.con_vencidos_count, o.con_proximos_count,
    o.sin_ubicar_count,
    v_ver
  FROM ordenable o
  WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
         OR (v_filtro = 'PENDIENTES' AND o.contados_count < o.item_count)
         OR (v_filtro = 'DIFERENCIA' AND o.con_diferencia_count > 0)
         OR (v_filtro = 'SIN_UBICAR' AND o.sin_ubicar_count > 0))
  ORDER BY
    CASE WHEN v_asc     THEN o.ord_num END ASC  NULLS LAST,
    CASE WHEN NOT v_asc THEN o.ord_num END DESC NULLS LAST,
    CASE WHEN v_asc     THEN o.ord_txt END ASC  NULLS LAST,
    CASE WHEN NOT v_asc THEN o.ord_txt END DESC NULLS LAST,
    -- Desempate y orden por defecto: laboratorio y después producto, que es el
    -- orden del anaquel y por eso el que sirve para recorrerlo contando.
    o.laboratorio_nombre NULLS LAST, o.product_nombre
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_products_page(uuid, text, text, integer, integer, integer, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteo_products_page(uuid, text, text, integer, integer, integer, text, text) TO authenticated, service_role;
