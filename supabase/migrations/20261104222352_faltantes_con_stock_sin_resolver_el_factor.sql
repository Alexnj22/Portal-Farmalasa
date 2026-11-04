-- get_faltantes_con_stock_en_otra_sala: «¿tengo?» sin resolver el factor
-- (2026-11-04). El factor de v_inventario_lotes es >= 1 siempre, así que sin
-- traslado en vuelo basta con una fila con cantidad > 0; lo que tiene traslado
-- en vuelo sigue por v_inventario_disponible. Parte de la definición VIVA.
--
-- Medido en transacción revertida, salida IDÉNTICA (md5, límite 200) en las
-- 7 salas: sala 1 52 → 23 ms y 25,658 → 9,745 bloques; Bodega 115 → 69 ms y
-- 59,636 → 34,019 bloques; las demás 45 → 21 ms.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_faltantes_con_stock_en_otra_sala(p_erp_sucursal_id integer, p_limite integer DEFAULT 40)
 RETURNS TABLE(erp_product_id integer, descripcion text, min_units integer, donde jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH mio AS MATERIALIZED (
        SELECT sp.erp_product_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units) AS min_mio
        FROM public.product_stock_params sp
        WHERE sp.erp_sucursal_id = p_erp_sucursal_id
          AND coalesce(sp.manual_min, sp.calc_min, sp.min_units) > 0
    ),
    -- Sólo MI sala: alcanza para saber de qué no tengo ni una unidad, y evita
    -- resolver el factor de las otras seis salas para 1,350 productos.
    --
    -- (2026-11-04) Sin resolver el factor: `v_inventario_lotes` da factor >= 1
    -- siempre (COALESCE(…, 1) sobre factores > 0), así que sin traslado en
    -- vuelo «tengo unidades» es lo mismo que «hay una fila con cantidad > 0».
    -- Resolver el factor de ~1,500 lotes era el 63% de los bloques de la
    -- función. Lo que tiene traslado en vuelo sigue por la vista: ahí la resta
    -- sí puede dejarlo en cero.
    vuelo AS MATERIALIZED (
        SELECT v.erp_product_id
        FROM public.traslados_en_vuelo() v(erp_sucursal_id, erp_product_id, unidades)
        WHERE v.erp_sucursal_id = p_erp_sucursal_id
    ),
    tengo AS MATERIALIZED (
        SELECT i.erp_product_id
        FROM public.inventory i
        WHERE i.erp_product_id = ANY (ARRAY(SELECT m.erp_product_id FROM mio m))
          AND i.erp_sucursal_id = p_erp_sucursal_id
          AND i.is_vencidos = false
          AND i.cantidad > 0
          AND i.erp_product_id <> ALL (ARRAY(SELECT erp_product_id FROM vuelo))
        UNION
        SELECT d.erp_product_id
        FROM public.v_inventario_disponible d
        WHERE d.erp_product_id = ANY (ARRAY(SELECT erp_product_id FROM vuelo))
          AND d.erp_sucursal_id = p_erp_sucursal_id
          AND d.unidades > 0
    ),
    faltan AS MATERIALIZED (
        SELECT m.erp_product_id, m.min_mio
        FROM mio m
        WHERE NOT EXISTS (SELECT 1 FROM tengo t WHERE t.erp_product_id = m.erp_product_id)
    ),
    -- Las OTRAS salas, y sólo para lo que falta. `= ANY(ARRAY(…))` y no
    -- `IN (SELECT …)`: es lo que hace que el filtro llegue al índice.
    base AS MATERIALIZED (
        SELECT d.erp_product_id, d.erp_sucursal_id, d.unidades::integer AS unidades
        FROM public.v_inventario_disponible d
        WHERE d.erp_product_id = ANY (ARRAY(SELECT f.erp_product_id FROM faltan f))
          AND d.erp_sucursal_id <> p_erp_sucursal_id
          AND d.unidades > 0
    ),
    nombres AS (
        SELECT i.erp_product_id, max(i.descripcion) AS descripcion
        FROM public.inventory i
        WHERE i.cantidad > 0
          AND i.erp_product_id = ANY (ARRAY(SELECT f.erp_product_id FROM faltan f))
        GROUP BY 1
    ),
    ajenas AS (
        SELECT b.erp_product_id, b.erp_sucursal_id, b.unidades,
               coalesce(m.nombre, 'Sucursal ' || b.erp_sucursal_id) AS sala,
               m.branch_id,
               coalesce(sp2.manual_min, sp2.calc_min, sp2.min_units, 0) AS min_suyo,
               v.primero AS vence
        FROM base b
        JOIN public.product_stock_params sp2
          ON sp2.erp_product_id = b.erp_product_id
         AND sp2.erp_sucursal_id = b.erp_sucursal_id
        LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = b.erp_sucursal_id
        LEFT JOIN LATERAL (
            SELECT min(i.fecha_vencimiento) AS primero
            FROM public.inventory i
            WHERE i.erp_product_id = b.erp_product_id
              AND i.erp_sucursal_id = b.erp_sucursal_id
              AND i.is_vencidos = false AND i.cantidad > 0
              AND i.fecha_vencimiento IS NOT NULL
        ) v ON true
    )
    SELECT a.erp_product_id,
           max(n.descripcion) AS descripcion,
           max(f.min_mio)     AS min_units,
           jsonb_agg(jsonb_build_object(
                       'sala',            a.sala,
                       'unidades',        a.unidades,
                       'minimo',          a.min_suyo,
                       'vence',           a.vence,
                       'erp_sucursal_id', a.erp_sucursal_id,
                       'branch_id',       a.branch_id)
                     ORDER BY a.unidades DESC, a.erp_sucursal_id) AS donde
    FROM ajenas a
    JOIN faltan f ON f.erp_product_id = a.erp_product_id
    LEFT JOIN nombres n ON n.erp_product_id = a.erp_product_id
    GROUP BY a.erp_product_id
    ORDER BY max(f.min_mio) DESC, max(n.descripcion)
    LIMIT greatest(1, least(p_limite, 200));
$function$;
