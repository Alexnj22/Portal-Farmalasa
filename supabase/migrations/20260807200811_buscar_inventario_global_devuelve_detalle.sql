-- `buscar_inventario_global` devuelve también `detalle`.
--
-- Sin él, la Consulta de Inventario no puede sumar: `inventory.cantidad` está
-- en la PRESENTACIÓN de la fila, no en unidades. El mismo lote aparece varias
-- veces —CAJA, BLISTER, UNIDAD— y `detalle` (`1x30`, `1x10`, `1x1`) es el
-- factor que las hace comparables.
--
-- Medido el 2026-08-07 sobre la amoxicilina 500 (producto 2224): el widget
-- mostraba 46 en La Popular y 155 en Bodega, cuando son 836 y 4,494 unidades.
-- Y el orden se invertía: La Popular (46) salía por encima de Salud 1 (39)
-- teniendo 836 contra 1,034. La pantalla que existe para decir «en qué sala
-- hay» apuntaba a la sala equivocada.
--
-- Es la única columna que se agrega; el resto del cuerpo queda igual.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.buscar_inventario_global(p_search text)
RETURNS json
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
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
  )
  -- `json_build_object` y no `to_json(f)`: `por_nombre` se necesita para ordenar
  -- y no tiene por qué viajar al navegador. El navegador agrupa RESPETANDO el
  -- orden de llegada (`groupInventory` inserta en un Map), así que el orden de
  -- acá es el que se ve.
  SELECT coalesce(
           json_agg(json_build_object(
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
           ORDER BY (NOT f.por_nombre), f.descripcion, f.fecha_vencimiento NULLS LAST),
           '[]'::json)
  FROM (
    SELECT i.erp_sucursal_id, i.erp_product_id, i.descripcion, i.presentacion,
           i.detalle, i.lote, i.fecha_vencimiento, i.cantidad, i.is_vencidos,
           pr.principio_activo, pr.foto_url, pr.por_nombre
    FROM public.inventory i
    JOIN prods pr ON pr.id = i.erp_product_id
    WHERE i.cantidad > 0
  ) f;
$function$;
