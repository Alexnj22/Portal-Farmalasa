-- El orden de la Consulta de Inventario: primero los que coinciden POR NOMBRE.
--
-- Reportado con una captura buscando «acetaminofen» en La Popular: arriba de
-- todo salían AVAMIGRAN y CILFRIN D, que no se llaman así — coinciden porque
-- llevan acetaminofén entre sus principios activos—, y los tres ACETAMINOFEN de
-- verdad quedaban en el tercer, cuarto y quinto lugar.
--
-- El orden era `descripcion` a secas, o sea alfabético mezclando las dos formas
-- de coincidir. Pero no son lo mismo: quien escribe el nombre de un producto
-- está buscando ESE producto; el que coincide por composición es un hallazgo
-- útil —«esto también lo lleva»— y va después, no antes.
--
-- Se separan en dos bloques y cada uno se ordena alfabéticamente. Medido sobre
-- «acetaminofen» en La Popular: los 6 que se llaman ACETAMINOFEN (o lo llevan en
-- el nombre, como CETRAM PEDIÁTRICO) primero, y después los 6 que sólo lo llevan
-- en la composición.
--
-- El bloque se decide con el MISMO patrón con el que ya se buscaba —`LIKE ALL`
-- sobre `nombre_norm`—, así que no cambia qué filas salen: sólo en qué orden.

SET lock_timeout = '5s';

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
           i.lote, i.fecha_vencimiento, i.cantidad, i.is_vencidos,
           pr.principio_activo, pr.foto_url, pr.por_nombre
    FROM public.inventory i
    JOIN prods pr ON pr.id = i.erp_product_id
    WHERE i.cantidad > 0
  ) f;
$$;

COMMENT ON FUNCTION public.buscar_inventario_global(text) IS
  'Consulta de Inventario del tablero: existencias de todas las salas que '
  'coinciden por nombre o por principio activo, con la foto y el principio '
  'activo ya adentro. Reemplaza cuatro peticiones encadenadas del navegador. '
  'Ordena primero lo que coincide por NOMBRE y después lo que sólo coincide '
  'por composición; alfabético dentro de cada bloque.';

REVOKE EXECUTE ON FUNCTION public.buscar_inventario_global(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.buscar_inventario_global(text) TO authenticated, service_role;
