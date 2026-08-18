SET lock_timeout = '5s';

-- Los patrones se armaban una vez POR PRODUCTO.
--
-- El CTE `pats` construye el arreglo de patrones (`{'%amox%'}`) a partir del
-- texto buscado. Postgres inlinea los CTE por defecto, así que ese `array_agg`
-- terminaba dentro del barrido de `products` y se recalculaba una vez por cada
-- una de las 5,213 filas. Se ve en el plan: `SubPlan 2 -> Aggregate (loops=5213)`.
--
-- `MATERIALIZED` le dice a Postgres que lo calcule una sola vez. No cambia QUÉ
-- se calcula —es el mismo CTE, la misma expresión— sólo cuántas veces.
--
-- Medido aislado sobre la etapa de productos: **13.5 ms → 3.2 ms**, cuatro veces
-- más rápido, en los tres términos probados.
--
-- Verificado con huella md5 de la respuesta completa sobre 10 términos: las diez
-- IDÉNTICAS antes y después. Era de esperar —es una directiva de planificación,
-- no de semántica— pero una directiva que cambia el resultado sería justo el
-- tipo de cosa que nadie nota.
CREATE OR REPLACE FUNCTION public.buscar_inventario_global_v2(
    p_search        text,
    p_max_productos integer DEFAULT 60
)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
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
           -- Por qué entró: por su nombre, o sólo por su composición.
           (p.nombre_norm LIKE ALL (pats.todos)) AS por_nombre
    FROM public.products p, pats
    WHERE p.nombre_norm LIKE ALL (pats.todos)
       OR (p.pactivo_norm <> '' AND p.pactivo_norm LIKE pats.ordenado)
  ),
  base AS (
    SELECT i.erp_sucursal_id, i.erp_product_id, i.descripcion, i.presentacion,
           i.detalle, i.lote, i.fecha_vencimiento, i.cantidad, i.is_vencidos,
           pr.principio_activo, pr.foto_url, pr.por_nombre
    FROM public.inventory i
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
                -- El factor de la presentación: sin esto no se puede sumar.
                'detalle',           f.detalle,
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
$function$;

REVOKE ALL ON FUNCTION public.buscar_inventario_global_v2(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_inventario_global_v2(text, integer) TO authenticated, service_role;
