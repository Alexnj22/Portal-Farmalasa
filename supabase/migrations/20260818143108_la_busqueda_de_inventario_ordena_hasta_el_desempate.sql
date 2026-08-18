SET lock_timeout = '5s';

-- El desempate que la v1 nunca tuvo.
--
-- `ORDER BY (NOT por_nombre), descripcion, fecha_vencimiento` deja sin definir
-- el orden de las filas empatadas en las tres — el mismo producto, con la misma
-- descripción, venciendo el mismo día, en dos salas distintas. Postgres las
-- devuelve en el orden que le convenga, y ese orden puede cambiar. Ya había
-- mordido antes: el detalle por sucursal filtraba por `presentacion`, y cuáles
-- salas desaparecían cambiaba entre dos búsquedas iguales.
--
-- Verificado contra la v1 sobre 11 términos reales: MISMO conjunto de filas,
-- cero diferencias en los dos sentidos. Lo único que cambiaba era ese orden
-- accidental. Acá se fija: sala, lote y presentación cierran la clave, así que
-- dos búsquedas iguales pintan la misma pantalla.
CREATE OR REPLACE FUNCTION public.buscar_inventario_global_v2(
    p_search        text,
    p_max_productos integer DEFAULT 60
)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
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
