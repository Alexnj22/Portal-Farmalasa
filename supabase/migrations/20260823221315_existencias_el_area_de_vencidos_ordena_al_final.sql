-- Buscador global de existencias: el orden deja de tener empates sin resolver.
--
-- Encontrado al verificar el trabajo del 2026-08-23: la misma búsqueda
-- («amoxicilina») devolvía las mismas 151 filas antes y después de sumarle el
-- código de barras, pero DOS de ellas cambiadas de lugar entre sí. Son el mismo
-- producto y el mismo lote —CLAMICIL BID 600 MG, lote 51484— con la única
-- diferencia de que uno está en el área de vencidos y el otro no.
--
-- La causa: `is_vencidos` NO estaba en el `ORDER BY`, así que esas dos filas
-- empataban en TODAS las claves (nombre, descripción, vencimiento, sucursal,
-- lote, presentación) y su orden relativo lo decidía el plan. Cada versión es
-- estable consigo misma; lo que no está definido es cuál va primero, y por eso
-- basta un cambio de plan para que se den vuelta.
--
-- No es un caso raro: medido sobre `v_inventario_lotes`, **21 grupos de filas
-- empatan hoy en todas las claves de orden**. O sea que 21 pares de renglones
-- del buscador pueden intercambiarse sin que nadie toque nada.
--
-- El desempate es `is_vencidos` y en ese sentido —lo bueno primero, lo vencido
-- al final— por la misma razón por la que el Conteo separó las dos áreas ese
-- mismo día: lo del área de vencidos no es lo que se está buscando cuando se
-- busca un producto, es una nota al pie.
--
-- La función ya tenía escrito el criterio para el otro empate («El desempate por
-- id hace que dos búsquedas iguales elijan lo mismo»); a este le faltaba.
SET lock_timeout = '5s';

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
  cods AS MATERIALIZED (
    SELECT public.productos_por_codigo(p_search) AS ids
  ),
  prods AS (
    SELECT p.id, p.principio_activo, p.foto_url,
           -- Por qué entró: por algo que IDENTIFICA al producto —su nombre o su
           -- código de barras— o sólo por su composición. El código pesa como
           -- el nombre a propósito: quien escanea una caja quiere esa caja
           -- primero, no los que comparten principio activo.
           (p.nombre_norm LIKE ALL (pats.todos)
            OR p.id = ANY (cods.ids)) AS por_nombre
    FROM public.products p, pats, cods
    WHERE p.nombre_norm LIKE ALL (pats.todos)
       OR p.id = ANY (cods.ids)
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
              -- `is_vencidos` cierra el orden: sin él, el mismo producto y el
              -- mismo lote en las dos áreas empatan en TODAS las claves y su
              -- orden lo decide el plan. Medido: 21 grupos empatan hoy así.
              -- Y va en ese sentido —lo bueno primero— porque lo del área de
              -- vencidos es una nota al pie de lo que se está buscando.
              ORDER BY (NOT f.por_nombre), f.descripcion, f.fecha_vencimiento NULLS LAST,
                       f.erp_sucursal_id, f.lote NULLS LAST, f.presentacion NULLS LAST,
                       f.is_vencidos)
       FROM base f
       JOIN elegidos e ON e.erp_product_id = f.erp_product_id),
      '[]'::json)
  );
$function$;
