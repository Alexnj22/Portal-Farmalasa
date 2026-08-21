SET lock_timeout = '5s';

-- Las dos funciones de conteo con `WITH cfg AS (...)` resolvían el permiso
-- UNA VEZ en la lectura del SQL y MILES DE VECES en la ejecución: un CTE de
-- una fila y sin efectos NO se materializa —Postgres lo aplana dentro del
-- `WHERE`—, así que `conteo_puede_ver_sistema()` (y con ella
-- `auth_has_module_permission`, que consulta employees + role_permissions)
-- quedaba evaluada por cada fila del cross join.
--
-- Medido el 2026-08-21 sobre el conteo de 3,473 renglones / 2,800 productos
-- de Bodega (f6e4a0d8…): `get_conteo_products_count` tardaba **6,712 ms** con
-- 43,511 buffers, y la MISMA consulta escrita a mano —sin el CTE— **13 ms**
-- con 397. La página (`get_conteo_products_page`) ya andaba en 66 ms porque
-- es plpgsql y guarda el permiso en una variable: ahí está el contraste que
-- lo delata.
--
-- Es la regla del initplan de CLAUDE.md («toda llamada a `auth_*` en una
-- policy va envuelta en `(SELECT ...)`») aplicada fuera de una policy: el
-- lugar no importa, lo que importa es que la función quede en un nodo que se
-- ejecuta una vez. `MATERIALIZED` es ese nodo.
--
-- El resultado no cambia en ninguna fila: el CTE devuelve un único valor
-- escalar y materializarlo sólo decide CUÁNTAS veces se calcula, no cuál es.

CREATE OR REPLACE FUNCTION public.get_conteo_products_count(
  p_conteo_id uuid,
  p_search text DEFAULT NULL::text,
  p_filtro text DEFAULT 'TODOS'::text,
  p_laboratorio_id integer DEFAULT NULL::integer
)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS MATERIALIZED (
    SELECT CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
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
$function$;

-- El mismo defecto, y peor: acá el cross join es contra `base` (los 3,473
-- RENGLONES, no los 2,800 productos), así que el permiso se preguntaba una
-- vez por renglón. La llama `fetchConteoPendientesCount` justo antes de
-- finalizar un conteo, que es el peor momento para esperar siete segundos.
CREATE OR REPLACE FUNCTION public.get_conteo_items_count(
  p_conteo_id uuid,
  p_search text DEFAULT NULL::text,
  p_filtro text DEFAULT 'TODOS'::text,
  p_erp_product_id integer DEFAULT NULL::integer
)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS MATERIALIZED (
    SELECT CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
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

REVOKE EXECUTE ON FUNCTION public.get_conteo_products_count(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteo_products_count(uuid, text, text, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_conteo_items_count(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteo_items_count(uuid, text, text, integer) TO authenticated, service_role;
