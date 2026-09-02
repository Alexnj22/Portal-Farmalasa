SET lock_timeout = '5s';

-- ── El widget leía 467 MB para contestar sobre 122 productos ─────────────────
-- Medido el 2026-09-01 con la sección F de `gate:perf`, que nació el mismo día:
-- `get_faltantes_con_stock_en_otra_sala` es el segundo consumidor del portal
-- (467 MB x 128 llamadas en cuatro horas) y su costo NO se veía en ningún lado —
-- la sección D ya vigilaba su tiempo (159 ms contra un techo de 400) y pasaba.
--
-- El CTE `base` calculaba la existencia disponible de las 7 salas para los 1,350
-- productos con mínimo: **13,678 combinaciones**, cada una resolviendo el factor
-- de presentación. La respuesta necesita 122. O sea ~9x el trabajo, y el 98% de
-- los bloques se iban ahí.
--
-- ── Por qué el orden viejo no se podía arreglar escribiéndolo distinto ───────
-- `v_inventario_disponible` SÍ acepta que le empujen un filtro por producto
-- —verificado: con un literal el plan usa `Index Cond: erp_product_id = …` y
-- cuesta 79 bloques—, pero **`IN (SELECT … FROM cte)` no se empuja**: se
-- convierte en un semi-join que se aplica DESPUÉS del `GROUP BY` de la vista.
-- Con `= ANY(ARRAY(…))` el conjunto se resuelve antes y entra al índice.
--
-- Sin eso, partir la consulta en dos la deja PEOR y no mejor: el primer intento
-- calculaba la vista dos veces sobre conjuntos anchos y midió 83,642 bloques
-- contra los 57,265 del original. La mejora no es «partirla», es que el filtro
-- llegue al índice.
--
-- ── Lo que ahora hace ────────────────────────────────────────────────────────
-- 1. `tengo`: la existencia de MI sala para los 1,350 con mínimo.
-- 2. `faltan`: los 122 de los que no tengo ni una unidad.
-- 3. `base`: las OTRAS salas, y sólo para esos 122.
--
-- Medido en la sala 1: **57,265 -> 32,720 bloques (467 -> 267 MB), 222 -> 98 ms**.
-- Y el resultado es el MISMO: enfrentadas las dos versiones en las 7 salas
-- (85, 63, 72, 60, 57, 200 y 33 filas), md5 idéntico en las 7.
--
-- Queda sin tocar lo que sigue costando, escrito para quien lo retome:
--   · `traslados_en_vuelo()` cuesta ~4,500 bloques CADA evaluación y devuelve 0
--     filas; acá se evalúa dos veces = 9,371 bloques, el 29% de lo que queda.
--     (Corregido enseguida en 20260902023011: era un CTE sin cerca.)
--   · resolver el factor de las 1,717 filas de `tengo` son 16,897 bloques, el
--     52%. Y para la pregunta de `tengo` —«¿tengo alguna unidad?»— el factor es
--     un multiplicador positivo: sólo cambia la respuesta cuando hay un traslado
--     en vuelo. Ahí hay otro tanto, pero cambia la semántica y hay que medirlo.
CREATE OR REPLACE FUNCTION public.get_faltantes_con_stock_en_otra_sala(
  p_erp_sucursal_id integer, p_limite integer DEFAULT 40)
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
    tengo AS MATERIALIZED (
        SELECT d.erp_product_id
        FROM public.v_inventario_disponible d
        WHERE d.erp_product_id = ANY (ARRAY(SELECT m.erp_product_id FROM mio m))
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
