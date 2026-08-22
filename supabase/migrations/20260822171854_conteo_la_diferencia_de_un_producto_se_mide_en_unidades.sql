-- Conteo de inventario: la diferencia de un producto se mide en UNIDADES.
--
-- Reportado el 2026-08-21 sobre VENDA DE GASA MIGASA 2X10 YDS. en Salud 4: el
-- sistema tiene 14 unidades y 0 paquetes; en el anaquel hay 1 paquete de 10 sin
-- abrir y 4 sueltas. Es la MISMA cantidad —14 unidades— y la pantalla mostraba
-- «-9» en el producto, «-10» en la línea de UNIDAD y «+1» en la de PAQUETE.
--
-- El -9 no era un error de conteo sino de aritmética: `sum(diferencia)` sumaba
-- 1 paquete con -10 unidades como si fueran la misma cosa. Un paquete NO es una
-- unidad, y el factor —que ya vive en `grupo_key` como 'F<factor>' desde
-- 20260807214106— dice exactamente cuántas trae.
--
-- La regla, y vale para las seis RPC que resumen un conteo:
--
--   * Las presentaciones del mismo producto/lote/vencimiento son UNA PILA. Su
--     grupo se llama acá «grupo neto». Si dentro hay más de un factor, todo se
--     mide en unidades base (cantidad × factor); si hay uno solo, se deja tal
--     cual — un producto que solo viene en CAJA X 100 seguiría diciendo «1
--     caja» y no «100», que es lo que su contador tiene en la mano.
--   * Un renglón cuyo `grupo_key` no es 'F<n>' (los conteos anteriores al
--     20260807214106 son todos 'P:<PRESENTACION>') se queda SOLO en su propio
--     grupo. Sin factor conocido no se puede convertir nada, y agrupar por
--     ignorancia haría que dos renglones reclamaran la misma existencia. Su
--     resultado es idéntico al de hoy.
--   * El neto del grupo decide QUÉ es una diferencia: la cuenta de renglones a
--     ajustar, el filtro «Con diferencia», la valuación y las tarjetas del
--     encabezado. Un grupo que cuadra en unidades no tiene nada que ajustar.
--   * Los números POR RENGLÓN no cambian: son los que el ERP guarda por
--     presentación y los que hay que teclear cuando el grupo NO cuadra. La
--     pantalla los muestra apagados cuando su grupo cuadra, para que «-10» deje
--     de leerse como diez unidades perdidas.
--
-- Sin esto la valuación también mentía por partida doble: -10 unidades ×
-- $1.0156 daba «faltante $10.16» y +1 paquete × $10.1556 daba «sobrante
-- $10.16», con la mercadería completa en el anaquel.
SET lock_timeout = '5s';

-- ── El grupo neto de cada renglón ───────────────────────────────────────────
-- Una sola definición para las seis RPC que la necesitan. Devuelve una fila por
-- renglón con lo que hace falta para resumirlo: cuánto multiplicar, si su grupo
-- mezcla factores, cuánto neteó el grupo entero y a qué costo se valúa ese neto.
--
-- `costo_neto` se divide por el MISMO multiplicador que la cantidad para que
-- las dos hablen de la unidad: con mezcla es el costo de la unidad base
-- ($10.1556 / 10), sin mezcla es el costo del renglón tal como está hoy.
CREATE OR REPLACE FUNCTION public.conteo_lineas_netas(p_conteo_id uuid)
RETURNS TABLE(item_id uuid, grupo_id text, factor integer, mult integer,
              grupo_mixto boolean, neto_grupo integer, costo_neto numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  WITH f AS (
    SELECT ci.id,
           ci.diferencia,
           ci.costo_unitario,
           CASE WHEN ci.grupo_key ~ '^F[0-9]+$' THEN substr(ci.grupo_key, 2)::int END AS factor,
           CASE WHEN ci.grupo_key ~ '^F[0-9]+$'
                THEN 'G:' || ci.erp_product_id::text || '|' || ci.is_vencidos::text || '|'
                     || coalesce(ci.lote, '') || '|' || coalesce(ci.fecha_vencimiento::text, '')
                ELSE 'L:' || ci.id::text
           END AS grupo_id
    FROM public.conteo_inventario_items ci
    WHERE ci.conteo_id = p_conteo_id
  ),
  g AS (
    SELECT f.grupo_id, count(DISTINCT f.factor) > 1 AS mixto
    FROM f GROUP BY f.grupo_id
  ),
  m AS (
    SELECT f.id, f.grupo_id, f.diferencia, f.costo_unitario, f.factor, g.mixto,
           CASE WHEN g.mixto THEN coalesce(f.factor, 1) ELSE 1 END AS mult
    FROM f JOIN g ON g.grupo_id = f.grupo_id
  ),
  n AS (
    SELECT m.grupo_id,
           sum(m.diferencia * m.mult) FILTER (WHERE m.diferencia IS NOT NULL)::int AS neto,
           min(m.costo_unitario / nullif(m.mult, 0)) AS costo_neto
    FROM m GROUP BY m.grupo_id
  )
  SELECT m.id, m.grupo_id, m.factor, m.mult, m.mixto, n.neto, n.costo_neto
  FROM m JOIN n ON n.grupo_id = m.grupo_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.conteo_lineas_netas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteo_lineas_netas(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.conteo_lineas_netas(uuid) IS
  'Por renglón: su grupo neto (producto+lote+vencimiento+área), el multiplicador a unidades base cuando el grupo mezcla factores, el neto del grupo y el costo con el que se valúa ese neto.';

-- ── La banda del producto ───────────────────────────────────────────────────
-- Cambia el tipo de retorno (entra `total_en_unidades`), así que se elimina y
-- se recrea: una firma con el mismo nombre y otra tabla de salida no se puede
-- reemplazar en el lugar.
DROP FUNCTION IF EXISTS public.get_conteo_products_page(uuid, text, text, integer, integer, integer, text, text);

CREATE FUNCTION public.get_conteo_products_page(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_laboratorio_id integer DEFAULT NULL::integer, p_order_by text DEFAULT NULL::text, p_order_dir text DEFAULT 'asc'::text)
 RETURNS TABLE(erp_product_id integer, product_nombre text, laboratorio_nombre text, es_antibiotico boolean, foto_url text, item_count integer, contados_count integer, sistema_total integer, fisico_total integer, diferencia_total integer, con_diferencia_count integer, con_vencidos_count integer, con_proximos_count integer, sin_ubicar_count integer, ver_sistema boolean, total_en_unidades boolean)
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
  v_ob text;
  v_asc boolean := lower(coalesce(p_order_dir, 'asc')) <> 'desc';
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
  WITH neto AS MATERIALIZED (
    SELECT * FROM public.conteo_lineas_netas(p_conteo_id)
  ),
  base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre, COALESCE(p.laboratorio_id, 0) AS p_lab_id,
           nt.mult, nt.grupo_mixto, nt.neto_grupo
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN neto nt ON nt.item_id = ci.id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_laboratorio_id IS NULL OR COALESCE(p.laboratorio_id, 0) = p_laboratorio_id)
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
             WHEN b.fisico_cantidad IS NULL AND NOT b.es_agregado_manual THEN
               CASE WHEN v_fuente = 'HOJA'
                    THEN COALESCE(b.sistema_inicial, b.sistema_cantidad)
                    ELSE COALESCE(li.sistema_live, lg.sistema_live, 0) END
             ELSE b.sistema_cantidad
           END AS sistema_now
    FROM base b
    LEFT JOIN live_inv li ON li.sync_key = b.source_sync_key
    LEFT JOIN live_grp lg ON lg.g_pid = b.erp_product_id
                         AND lg.g_venc = b.is_vencidos
                         AND lg.g_key = b.grupo_key
                         AND lg.g_lote IS NOT DISTINCT FROM b.lote
                         AND lg.g_fecha IS NOT DISTINCT FROM b.fecha_vencimiento
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
      -- Los tres totales van multiplicados por `mult`, que vale 1 salvo cuando
      -- el grupo mezcla factores. Ahí, y solo ahí, la suma pasa a unidades
      -- base: es la única forma de que 1 paquete de 10 y 4 sueltas sumen 14.
      sum(w.sistema_now * coalesce(w.mult, 1))::int AS sistema_total,
      sum(w.fisico_cantidad * coalesce(w.mult, 1))::int AS fisico_total,
      sum(w.diferencia * coalesce(w.mult, 1))::int AS diferencia_total,
      -- Renglones a ajustar: los que tienen diferencia propia Y pertenecen a un
      -- grupo que NO cuadra. Un paquete sin abrir que el sistema tiene como
      -- sueltas no es mercadería de menos, así que no llama al filtro «Con
      -- diferencia» ni pide un ajuste.
      count(*) FILTER (WHERE w.diferencia IS NOT NULL AND w.diferencia != 0
                         AND coalesce(w.neto_grupo, 0) != 0)::int AS con_diferencia_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento < CURRENT_DATE)::int AS con_vencidos_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento >= CURRENT_DATE AND w.fecha_vencimiento <= CURRENT_DATE + 90)::int AS con_proximos_count,
      count(*) FILTER (WHERE w.estado_item = 'SIN_UBICAR')::int AS sin_ubicar_count,
      bool_or(coalesce(w.grupo_mixto, false)) AS total_en_unidades
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
    v_ver,
    o.total_en_unidades
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
GRANT EXECUTE ON FUNCTION public.get_conteo_products_page(uuid, text, text, integer, integer, integer, text, text) TO authenticated, service_role;

-- ── El total de la paginación, con el mismo criterio ────────────────────────
-- Si la página y el contador no aplican la MISMA definición de «con
-- diferencia», el filtro dice «12 productos» y muestra 9.
CREATE OR REPLACE FUNCTION public.get_conteo_products_count(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_laboratorio_id integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS MATERIALIZED (
    SELECT CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
                THEN 'TODOS' ELSE p_filtro END AS filtro
  ),
  neto AS MATERIALIZED (
    SELECT * FROM public.conteo_lineas_netas(p_conteo_id)
  ),
  base AS MATERIALIZED (
    SELECT ci.erp_product_id, ci.estado_item, ci.diferencia, ci.lote, ci.presentacion,
           p.nombre AS product_nombre, l.nombre AS laboratorio_nombre,
           COALESCE(p.laboratorio_id, 0) AS laboratorio_id,
           nt.neto_grupo
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN neto nt ON nt.item_id = ci.id
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
           count(*) FILTER (WHERE b.diferencia IS NOT NULL AND b.diferencia != 0
                              AND coalesce(b.neto_grupo, 0) != 0) AS con_diferencia_count,
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

REVOKE EXECUTE ON FUNCTION public.get_conteo_products_count(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_products_count(uuid, text, text, integer) TO authenticated, service_role;

-- ── Los renglones ───────────────────────────────────────────────────────────
-- Entran tres columnas: `factor` y `grupo_mixto` (para que la pantalla sepa que
-- este renglón comparte pila con otra presentación) y `diferencia_grupo`, el
-- neto en unidades. `diferencia_grupo` es una cifra del sistema y por eso viaja
-- bajo la misma condición que `diferencia`: en un conteo ciego no sale.
DROP FUNCTION IF EXISTS public.get_conteo_items_search(uuid, text, text, integer, integer, integer, integer[]);

CREATE FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_erp_product_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, erp_product_id integer, presentacion text, detalle text, lote text, fecha_vencimiento date, is_vencidos boolean, sistema_cantidad integer, fisico_cantidad integer, diferencia integer, estado_item text, nota text, costo_unitario numeric, es_agregado_manual boolean, product_nombre text, es_antibiotico boolean, foto_url text, laboratorio_nombre text, contado_por_nombre text, contado_at timestamp with time zone, fisico_primer_conteo integer, recontado_at timestamp with time zone, recontado_por_nombre text, contado_por_photo_url text, recontado_por_photo_url text, ediciones_count integer, ver_sistema boolean, factor integer, grupo_mixto boolean, diferencia_grupo integer)
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
           e.photo_url AS e_photo, r.photo_url AS r_photo,
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
             coalesce(b.l_nombre,'') || ' ' || coalesce(b.presentacion,'')
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
    CASE WHEN v_ver THEN f.n_neto END
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

REVOKE EXECUTE ON FUNCTION public.get_conteo_items_search(uuid, text, text, integer, integer, integer, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_search(uuid, text, text, integer, integer, integer, integer[]) TO authenticated, service_role;

-- ── El contador de renglones, con el mismo criterio ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_conteo_items_count(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_erp_product_id integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS MATERIALIZED (
    SELECT CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
                THEN 'TODOS' ELSE p_filtro END AS filtro
  ),
  neto AS MATERIALIZED (
    SELECT * FROM public.conteo_lineas_netas(p_conteo_id)
  ),
  base AS MATERIALIZED (
    SELECT ci.estado_item, ci.diferencia, ci.lote, ci.presentacion, ci.erp_product_id,
           p.nombre AS product_nombre, l.nombre AS laboratorio_nombre,
           nt.neto_grupo
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN neto nt ON nt.item_id = ci.id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_erp_product_id IS NULL OR ci.erp_product_id = p_erp_product_id)
  )
  SELECT count(*) FROM base, cfg
  WHERE (cfg.filtro = 'TODOS' OR cfg.filtro IS NULL
         OR (cfg.filtro = 'PENDIENTES' AND base.estado_item = 'PENDIENTE')
         OR (cfg.filtro = 'DIFERENCIA' AND base.diferencia IS NOT NULL AND base.diferencia != 0
             AND coalesce(base.neto_grupo, 0) != 0)
         OR (cfg.filtro = 'SIN_UBICAR' AND base.estado_item = 'SIN_UBICAR'))
    AND (p_search IS NULL OR p_search = ''
         OR public.norm_search(
              coalesce(base.product_nombre,'') || ' ' || coalesce(base.lote,'') || ' ' ||
              coalesce(base.laboratorio_nombre,'') || ' ' || coalesce(base.presentacion,'')
            ) LIKE ALL (
              ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
            ));
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_items_count(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_count(uuid, text, text, integer) TO authenticated, service_role;

-- ── El volcado completo (hoja impresa, reporte y CSV de ajuste) ─────────────
CREATE OR REPLACE FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid)
 RETURNS json
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
BEGIN
  SELECT c.branch_id, c.modo, c.fuente_sistema INTO v_branch_id, v_modo, v_fuente
  FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  RETURN (
    WITH neto AS MATERIALIZED (
      SELECT * FROM public.conteo_lineas_netas(p_conteo_id)
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
    )
    SELECT coalesce(json_agg(to_json(t)), '[]'::json)
    FROM (
      SELECT ci.id, ci.erp_product_id, ci.presentacion, ci.detalle, ci.lote, ci.fecha_vencimiento, ci.is_vencidos,
        CASE WHEN NOT v_ver THEN NULL
             WHEN ci.fisico_cantidad IS NULL AND NOT ci.es_agregado_manual THEN
               CASE WHEN v_fuente = 'HOJA'
                    THEN COALESCE(ci.sistema_inicial, ci.sistema_cantidad)
                    ELSE COALESCE(li.sistema_live, lg.sistema_live, 0) END
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
        v_ver AS ver_sistema,
        nt.factor,
        coalesce(nt.grupo_mixto, false) AS grupo_mixto,
        CASE WHEN v_ver THEN nt.neto_grupo END AS diferencia_grupo
      FROM public.conteo_inventario_items ci
      LEFT JOIN public.products p ON p.id = ci.erp_product_id
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      LEFT JOIN public.employees e ON e.id = ci.contado_por
      LEFT JOIN public.employees r ON r.id = ci.recontado_por
      LEFT JOIN neto nt ON nt.item_id = ci.id
      LEFT JOIN live_inv li ON li.sync_key = ci.source_sync_key
      LEFT JOIN live_grp lg ON lg.g_pid = ci.erp_product_id
                           AND lg.g_venc = ci.is_vencidos
                           AND lg.g_key = ci.grupo_key
                           AND lg.g_lote IS NOT DISTINCT FROM ci.lote
                           AND lg.g_fecha IS NOT DISTINCT FROM ci.fecha_vencimiento
      WHERE ci.conteo_id = p_conteo_id
      -- `presentacion` cierra el orden: en sencillo el lote es NULL en todos los
      -- renglones y sin ella dos presentaciones del mismo producto salían en
      -- orden arbitrario, distinto entre la hoja y el reporte.
      ORDER BY l.nombre NULLS LAST, p.nombre, ci.lote, ci.presentacion
    ) t
  );
END;
$function$;

-- ── Las tarjetas del encabezado ─────────────────────────────────────────────
-- `con_diferencia` cuenta renglones a ajustar (los de un grupo que no cuadra) y
-- el dinero se valúa UNA vez por grupo, sobre el neto. Antes, un paquete sin
-- abrir producía «faltante $10.16» y «sobrante $10.16» a la vez, con la
-- mercadería entera en el anaquel.
CREATE OR REPLACE FUNCTION public.get_conteo_resumen(p_conteo_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  -- Mismo predicado que las cinco RPCs de lectura: sin el permiso y con el
  -- conteo abierto, las cifras del sistema no salen de la base. Una tarjeta
  -- "faltante $109,591" arriba de una tabla ciega revelaría de un golpe todo lo
  -- que la tabla está tapando renglón por renglón.
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_falt numeric := 0;
  v_sobra numeric := 0;
BEGIN
  IF v_ver THEN
    SELECT COALESCE(SUM(GREATEST(-g.neto_grupo, 0) * COALESCE(g.costo_neto, 0)), 0),
           COALESCE(SUM(GREATEST( g.neto_grupo, 0) * COALESCE(g.costo_neto, 0)), 0)
      INTO v_falt, v_sobra
      FROM (SELECT DISTINCT n.grupo_id, n.neto_grupo, n.costo_neto
              FROM public.conteo_lineas_netas(p_conteo_id) n) g;
  END IF;

  RETURN (
    SELECT to_json(t)
    FROM (
      SELECT
        count(*)::int                                                                  AS total_items,
        count(DISTINCT ci.erp_product_id)::int                                         AS total_productos,
        count(*) FILTER (WHERE ci.estado_item <> 'PENDIENTE')::int                     AS contados,
        count(*) FILTER (WHERE ci.estado_item = 'PENDIENTE')::int                      AS pendientes,
        count(*) FILTER (WHERE ci.estado_item = 'SIN_UBICAR')::int                     AS sin_ubicar,
        count(*) FILTER (WHERE ci.recontado_at IS NOT NULL)::int                       AS recontados,
        count(*) FILTER (WHERE ci.es_agregado_manual)::int                             AS agregados,
        count(DISTINCT ci.contado_por)::int                                            AS contadores,
        CASE WHEN v_ver THEN count(*) FILTER (WHERE ci.diferencia IS NOT NULL AND ci.diferencia <> 0
                                                AND COALESCE(nt.neto_grupo, 0) <> 0)::int END AS con_diferencia,
        CASE WHEN v_ver THEN v_falt END                                                AS valor_faltante,
        CASE WHEN v_ver THEN v_sobra END                                               AS valor_sobrante,
        v_ver                                                                          AS ver_sistema
      FROM public.conteo_inventario_items ci
      LEFT JOIN public.conteo_lineas_netas(p_conteo_id) nt ON nt.item_id = ci.id
      WHERE ci.conteo_id = p_conteo_id
    ) t
  );
END;
$function$;

-- ── Los totales guardados en la cabecera ────────────────────────────────────
-- Los lee la LISTA de conteos («N dif · $x»), el aviso de ajuste pendiente y el
-- candado que impide dar por cerrado un conteo con ajuste sin registrar. Misma
-- definición que el resumen: si difieren, la lista y el detalle del mismo
-- conteo dicen dos cosas.
CREATE OR REPLACE FUNCTION public.recalcular_totales_conteo(p_conteo_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH neto AS MATERIALIZED (
    SELECT * FROM public.conteo_lineas_netas(p_conteo_id)
  ),
  grupos AS (
    SELECT DISTINCT n.grupo_id, n.neto_grupo, n.costo_neto FROM neto n
  ),
  dinero AS (
    SELECT COALESCE(SUM(GREATEST(-g.neto_grupo, 0) * COALESCE(g.costo_neto, 0)), 0) AS falt,
           COALESCE(SUM(GREATEST( g.neto_grupo, 0) * COALESCE(g.costo_neto, 0)), 0) AS sobra
    FROM grupos g
  ),
  renglones AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE ci.estado_item != 'PENDIENTE') AS contados,
           count(*) FILTER (WHERE ci.diferencia IS NOT NULL AND ci.diferencia != 0
                              AND COALESCE(nt.neto_grupo, 0) != 0) AS difs,
           count(*) FILTER (WHERE ci.recontado_at IS NOT NULL) AS recontados
    FROM public.conteo_inventario_items ci
    LEFT JOIN neto nt ON nt.item_id = ci.id
    WHERE ci.conteo_id = p_conteo_id
  )
  UPDATE public.conteos_inventario c
  SET total_items = r.n,
      total_contados = r.contados,
      total_diferencias = r.difs,
      total_recontados = r.recontados,
      valor_faltante = d.falt,
      valor_sobrante = d.sobra
  FROM renglones r, dinero d
  WHERE c.id = p_conteo_id;
$function$;
