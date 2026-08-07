-- Dos buscadores que se resuelven en el servidor, para los modales del tablero.
--
-- Medido el 2026-08-07 en el navegador, con el tablero recién recargado y la
-- mediana de 3 corridas:
--
--   Consulta de Inventario · buscar   2.667 ms  ·  4 peticiones ENCADENADAS
--   Ajuste de Min/Max      · buscar   4.462 ms  ·  6 peticiones (el catálogo)
--
-- Ninguno de los dos es lento por la base. El primero encadena cuatro viajes
-- que se esperan uno al otro; el segundo se BAJA LOS 5.205 PRODUCTOS ACTIVOS al
-- navegador para filtrarlos ahí.
--
-- ── Por qué el texto se busca ahora en `products` y no en `inventory` ───────
-- `search_inventory_descripcion_ids` recorre las 24.226 filas de inventory
-- calculando `norm_search(descripcion)` en cada una: 364 ms de barrido
-- secuencial, medido con EXPLAIN ANALYZE, y sin índice que lo cubra porque es
-- una expresión.
--
-- No hace falta: se contaron las 24.226 filas y en las **24.226**
-- `norm_search(inventory.descripcion) = products.nombre_norm`, con cero filas
-- huérfanas. O sea que la descripción del inventario ES el nombre del producto.
-- Así que el texto se busca en `products` —5.205 filas, con índice GIN de
-- trigramas— y las existencias salen por `erp_product_id`, que sí está
-- indexado. Mismo resultado, medido sobre cinco términos
-- («amoxicilina», «acetaminofen 500», «gel frio», «ibupro», «mk»): idéntico
-- conteo de productos en los cinco. La consulta fusionada corre en **16,7 ms**.
--
-- ⚠️ Eso vale mientras el sync siga escribiendo `descripcion` desde el mismo
-- nombre del producto. Si algún día divergen, esta función deja de ver esas
-- filas — la comprobación es la consulta de arriba, y está escrita para poder
-- repetirla.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Consulta de Inventario: los cuatro viajes en uno
-- ─────────────────────────────────────────────────────────────────────────────
-- Reemplaza la cadena products(principio activo) → rpc(ids por descripción) →
-- inventory(por esos ids) → products(fotos). Devuelve `json` y no `SETOF`
-- —Patrón C de CLAUDE.md— así que además se salta el corte de 1.000 filas de
-- PostgREST sin paginar.
--
-- Los dos criterios se conservan TAL CUAL estaban, con sus diferencias:
--   · por nombre: todos los tokens, en cualquier orden (`LIKE ALL`), que es lo
--     que hacía `search_inventory_descripcion_ids`;
--   · por principio activo: un solo patrón con los tokens EN ORDEN, que es lo
--     que arma `likePattern()` en el navegador.
-- Son distintos entre sí desde antes; unificarlos sería otra decisión.
CREATE OR REPLACE FUNCTION public.buscar_inventario_global(p_search text)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH toks AS (
    SELECT array_agg(tok) AS lista
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
    WHERE tok <> ''
  ),
  pats AS (
    SELECT (SELECT array_agg('%' || t || '%') FROM unnest(lista) t) AS todos,
           '%' || array_to_string(lista, '%') || '%'                AS ordenado
    FROM toks
    WHERE lista IS NOT NULL
  ),
  prods AS (
    SELECT p.id, p.principio_activo, p.foto_url
    FROM public.products p, pats
    WHERE p.nombre_norm LIKE ALL (pats.todos)
       OR (p.pactivo_norm <> '' AND p.pactivo_norm LIKE pats.ordenado)
  )
  SELECT coalesce(
           json_agg(to_json(f) ORDER BY f.descripcion, f.fecha_vencimiento NULLS LAST),
           '[]'::json)
  FROM (
    SELECT i.erp_sucursal_id, i.erp_product_id, i.descripcion, i.presentacion,
           i.lote, i.fecha_vencimiento, i.cantidad, i.is_vencidos,
           pr.principio_activo, pr.foto_url
    FROM public.inventory i
    JOIN prods pr ON pr.id = i.erp_product_id
    WHERE i.cantidad > 0
  ) f;
$$;

COMMENT ON FUNCTION public.buscar_inventario_global(text) IS
  'Consulta de Inventario del tablero: existencias de todas las salas que '
  'coinciden por nombre o por principio activo, con la foto y el principio '
  'activo ya adentro. Reemplaza cuatro peticiones encadenadas del navegador.';

REVOKE EXECUTE ON FUNCTION public.buscar_inventario_global(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.buscar_inventario_global(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Ajuste de Min/Max: buscar sin bajarse el catálogo
-- ─────────────────────────────────────────────────────────────────────────────
-- El widget pedía `count(products)` y después 5 tandas de 1.000 en paralelo —
-- nombre, laboratorio, foto y principio activo de los 5.205 activos— para
-- filtrarlos con `smartFilter` en memoria. Cada tanda tardó entre 1,0 y 4,2 s.
--
-- Acá se hace el MISMO criterio, del lado del servidor:
--   · `tokenMatch` del navegador junta nombre + principio activo + laboratorio
--     en un solo pajar y exige que cada token esté en ÉL, no en un campo
--     concreto. Por eso acá se concatena igual antes del `LIKE ALL` — un
--     `LIKE ALL` por columna exigiría que todos los tokens cayeran en la misma,
--     que no es lo que hace hoy.
--   · Si eso no da nada y la consulta tiene 4 caracteres o más, cae al
--     aproximado, igual que `smartFilter`. Cambia el algoritmo: allá era
--     Levenshtein palabra a palabra con umbral 0,72; acá es `word_similarity`
--     de pg_trgm con 0,65. El 0,65 está calibrado sobre un error real —
--     «amoxilina» da 0,692 en los siete AMOXICILINA y 0,600 en «AÑILINA
--     AMARILLA», así que el corte separa el acierto del ruido.
CREATE OR REPLACE FUNCTION public.buscar_productos_minmax(p_search text, p_limit integer DEFAULT 20)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_q    text := public.norm_search(p_search);
  v_pats text[];
  v_out  json;
BEGIN
  SELECT array_agg('%' || tok || '%') INTO v_pats
  FROM unnest(string_to_array(v_q, ' ')) AS tok
  WHERE tok <> '';

  IF v_pats IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT coalesce(json_agg(to_json(f) ORDER BY f.nombre), '[]'::json) INTO v_out
  FROM (
    SELECT p.id, p.nombre, p.foto_url, p.principio_activo,
           l.nombre AS laboratorio_nombre
    FROM public.products p
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE p.activo
      AND (coalesce(p.nombre_norm, '') || ' ' || coalesce(p.pactivo_norm, '') || ' '
           || coalesce(public.norm_search(l.nombre), '')) LIKE ALL (v_pats)
    ORDER BY p.nombre
    LIMIT p_limit
  ) f;

  IF json_array_length(v_out) > 0 OR length(v_q) < 4 THEN
    RETURN v_out;
  END IF;

  -- `json_build_object` y no `to_json(f)`: el parecido se necesita para
  -- ordenar y no tiene por qué viajar al navegador.
  SELECT coalesce(json_agg(json_build_object(
             'id',                 f.id,
             'nombre',             f.nombre,
             'foto_url',           f.foto_url,
             'principio_activo',   f.principio_activo,
             'laboratorio_nombre', f.laboratorio_nombre)
           ORDER BY f.sim DESC, f.nombre), '[]'::json) INTO v_out
  FROM (
    SELECT p.id, p.nombre, p.foto_url, p.principio_activo,
           l.nombre AS laboratorio_nombre,
           public.word_similarity(v_q, p.nombre_norm) AS sim
    FROM public.products p
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE p.activo
      AND public.word_similarity(v_q, p.nombre_norm) >= 0.65
    ORDER BY sim DESC, p.nombre
    LIMIT p_limit
  ) f;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.buscar_productos_minmax(text, integer) IS
  'Buscador de producto del widget Ajuste de Min/Max. Mismo criterio que el '
  'smartFilter que corría en el navegador (tokens sobre nombre + principio '
  'activo + laboratorio, con caída a aproximado), sin bajarse el catálogo.';

REVOKE EXECUTE ON FUNCTION public.buscar_productos_minmax(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.buscar_productos_minmax(text, integer) TO authenticated, service_role;
