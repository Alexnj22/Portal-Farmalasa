SET lock_timeout = '5s';

-- La búsqueda de la Consulta de Inventario, con tope POR PRODUCTO.
--
-- La v1 devuelve todo lo que empareja, y eso no tiene techo: medido el
-- 2026-08-18 en producción, «a» son 16,722 filas / 4.8 MB / 12,746 tarjetas, y
-- ni siquiera exigir tres letras acota —«mg » son 6,082 filas y «tab» 4,738,
-- porque el emparejamiento es por subcadena y esas letras viven dentro de
-- «500 MG» y «TABLETA»—. El navegador se queda pintando y la pestaña se traba.
--
-- El tope es por PRODUCTO y no por fila, a propósito: cortar por fila parte una
-- tarjeta a la mitad y deja una sala sin aparecer, que es exactamente la
-- pregunta que esta pantalla contesta («¿dónde hay?»). Cortando por producto,
-- cada producto que sale viene con TODOS sus lotes de TODAS las salas.
--
-- Y devuelve `total_productos` para que la pantalla pueda decir cuántos hay en
-- total. Un tope que no se anuncia miente; uno que se anuncia es un resumen.
--
-- El orden de elección es el MISMO de la v1 —primero los que emparejan por
-- nombre, después alfabético— así que los productos que salen son el prefijo de
-- lo que la v1 hubiera mostrado arriba. Cuando `total_productos` no llega al
-- tope, las filas son IDÉNTICAS a las de la v1, en el mismo orden.
--
-- Es función nueva y no un reemplazo: la v1 queda intacta mientras algún
-- navegador con el paquete viejo la siga llamando (pasó el 2026-08-17: un RPC
-- retirado siguió recibiendo llamadas once horas después del despliegue).
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
              ORDER BY (NOT f.por_nombre), f.descripcion, f.fecha_vencimiento NULLS LAST)
       FROM base f
       JOIN elegidos e ON e.erp_product_id = f.erp_product_id),
      '[]'::json)
  );
$function$;

REVOKE ALL ON FUNCTION public.buscar_inventario_global_v2(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_inventario_global_v2(text, integer) TO authenticated, service_role;
