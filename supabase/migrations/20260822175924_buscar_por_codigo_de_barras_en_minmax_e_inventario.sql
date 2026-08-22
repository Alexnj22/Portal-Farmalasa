-- El código de barras entra a las búsquedas de producto del portal.
--
-- Pedido del usuario el 2026-08-22: «agrega el código de barras también a la
-- búsqueda donde hayan productos». Empieza en el Conteo (migración anterior) y
-- sigue por el resto: Mín·Máx y el buscador global de existencias acá.
--
-- ── El resolvedor, y por qué existe ───────────────────────────────────────
-- Hay dos clases de buscador en el portal:
--
--   a) Los que ya leen `products` (Mín·Máx, existencias, conteo). Ahí el código
--      se suma al mismo saco de texto y no cuesta nada: son ~4,400 filas y la
--      tabla ya se recorría por el nombre.
--   b) Los que buscan sobre el TEXTO DE LA FACTURA (`get_product_sales_agg`
--      mira `sales_invoice_items.descripcion`, 548K+ filas). Ahí meter un join
--      a `products` para leer una columna sería cambiarle el plan a la consulta
--      más pesada de Ventas.
--
-- `productos_por_codigo` resuelve el código a ids UNA vez, sobre las 4,400
-- filas de `products`, y el buscador pesado sólo agrega una prueba de
-- pertenencia sobre una columna que ya tiene índice.
--
-- ⚠️ Se llama SIEMPRE envuelto en `(SELECT …)`. Sin el initplan, Postgres la
-- evalúa POR FILA — es la misma trampa que costó el pico de CPU del 2026-07-08
-- con las funciones `auth_*` en las policies, y acá el multiplicador sería el
-- de una tabla de medio millón de filas.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.productos_por_codigo(p_search text)
 RETURNS integer[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Cadena vacía o sin tokens ⇒ array vacío, NUNCA null: `= ANY(null)` es null,
  -- o sea que un `OR` con null nunca es verdadero pero tampoco es falso, y el
  -- planificador pierde la chance de descartarlo. Con `'{}'` la prueba es
  -- barata y explícitamente falsa.
  SELECT coalesce(array_agg(p.id), '{}')
  FROM public.products p
  WHERE coalesce(btrim(p.codigo_barras), '') <> ''
    AND EXISTS (
      SELECT 1
      WHERE public.norm_search(p.codigo_barras) LIKE ALL (
        ARRAY(SELECT '%' || tok || '%'
              FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok
              WHERE tok <> '')
      )
    )
    -- Sin búsqueda no hay códigos que resolver. La comprobación va acá y no
    -- arriba para que la función siga siendo una sola sentencia.
    AND coalesce(btrim(p_search), '') <> '';
$function$
;

REVOKE EXECUTE ON FUNCTION public.productos_por_codigo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.productos_por_codigo(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.productos_por_codigo(text) IS
  'Ids de productos cuyo código de barras coincide con la búsqueda. Para buscadores que NO leen products (ej. sobre el texto de la factura). Llamar siempre como (SELECT productos_por_codigo(...)) para que se evalúe una vez y no por fila.';

-- ── Mín·Máx ──────────────────────────────────────────────────────────────
-- Este ya lee `products`: el código se suma al saco de texto. La rama de
-- parecido (`word_similarity`) no lo necesita — un código no se escribe "casi
-- bien", o coincide en la rama exacta o no era un código.
CREATE OR REPLACE FUNCTION public.buscar_productos_minmax(p_search text, p_limit integer DEFAULT 20)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
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
           || coalesce(public.norm_search(l.nombre), '') || ' '
           || coalesce(public.norm_search(p.codigo_barras), '')) LIKE ALL (v_pats)
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
$function$
;

-- ── Buscador global de existencias ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.buscar_inventario_global_v2(p_search text, p_max_productos integer DEFAULT 60)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH toks AS MATERIALIZED (
    SELECT array_agg(tok) AS lista
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
    WHERE tok <> ''
  ),
  pats AS MATERIALIZED (
    SELECT (SELECT array_agg('%' || t || '%') FROM unnest(lista) t) AS todos,
           '%' || array_to_string(lista, '%') || '%'                AS ordenado
    FROM toks
    WHERE lista IS NOT NULL
  ),
  prods AS (
    SELECT p.id, p.principio_activo, p.foto_url,
           -- Por qué entró: por algo que IDENTIFICA al producto —su nombre o su
           -- código de barras— o sólo por su composición. El código pesa como
           -- el nombre a propósito: quien escanea una caja quiere esa caja
           -- primero, no los que comparten principio activo.
           (p.nombre_norm LIKE ALL (pats.todos)
            OR public.norm_search(p.codigo_barras) LIKE ALL (pats.todos)) AS por_nombre
    FROM public.products p, pats
    WHERE p.nombre_norm LIKE ALL (pats.todos)
       OR (coalesce(btrim(p.codigo_barras), '') <> ''
           AND public.norm_search(p.codigo_barras) LIKE ALL (pats.todos))
       OR (p.pactivo_norm <> '' AND p.pactivo_norm LIKE pats.ordenado)
  ),
  base AS (
    SELECT i.erp_sucursal_id, i.erp_product_id, i.descripcion, i.presentacion,
           i.detalle, i.factor, i.lote, i.fecha_vencimiento, i.cantidad, i.is_vencidos,
           pr.principio_activo, pr.foto_url, pr.por_nombre
    FROM public.v_inventario_lotes i
    JOIN prods pr ON pr.id = i.erp_product_id
    WHERE i.cantidad > 0
  ),
  -- Un renglón por producto. `por_nombre` es propiedad del producto, así que
  -- dentro del grupo es constante; `min(descripcion)` fija una clave estable
  -- cuando la misma referencia viene escrita distinto en dos salas.
  orden AS (
    SELECT b.erp_product_id,
           bool_or(b.por_nombre) AS por_nombre,
           min(b.descripcion)    AS descripcion_min
    FROM base b
    GROUP BY b.erp_product_id
  ),
  -- El desempate por id hace que dos búsquedas iguales elijan lo mismo. Sin él,
  -- cuáles entran al tope podría cambiar entre llamadas.
  elegidos AS (
    SELECT o.erp_product_id
    FROM orden o
    ORDER BY (NOT o.por_nombre), o.descripcion_min, o.erp_product_id
    LIMIT greatest(p_max_productos, 1)
  )
  SELECT json_build_object(
    'total_productos', (SELECT count(*) FROM orden),
    'filas', coalesce(
      (SELECT json_agg(json_build_object(
                'erp_sucursal_id',   f.erp_sucursal_id,
                'erp_product_id',    f.erp_product_id,
                'descripcion',       f.descripcion,
                'presentacion',      f.presentacion,
                'detalle',           f.detalle,
                -- El factor ya resuelto. Antes iba sólo `detalle` y el
                -- navegador lo deducía: por ahí entró la discrepancia del
                -- 2026-08-18 con `v_inventario_disponible`.
                'factor',            f.factor,
                'lote',              f.lote,
                'fecha_vencimiento', f.fecha_vencimiento,
                'cantidad',          f.cantidad,
                'is_vencidos',       f.is_vencidos,
                'principio_activo',  f.principio_activo,
                'foto_url',          f.foto_url)
              ORDER BY (NOT f.por_nombre), f.descripcion, f.fecha_vencimiento NULLS LAST,
                       f.erp_sucursal_id, f.lote NULLS LAST, f.presentacion NULLS LAST)
       FROM base f
       JOIN elegidos e ON e.erp_product_id = f.erp_product_id),
      '[]'::json)
  );
$function$
;
