SET lock_timeout = '5s';

-- La función calculaba el inventario disponible de las SIETE salas enteras
-- —13,749 filas producto×sala, cada una con su búsqueda de factor— y recién
-- después se quedaba con los 82 productos que interesan. `nombres` hacía lo
-- mismo: un Seq Scan de `inventory` agrupando los 17,944 productos con
-- existencia, para ponerle nombre a esos 82.
--
-- Ahora el orden se invierte: primero `mio` (los productos que ESTA sala tiene
-- en su mínimo — 1,363 en Salud 1), y todo lo demás se restringe a ésos. No
-- cambia el resultado por construcción: cualquier producto fuera de `mio` lo
-- descartaba igual el `JOIN mio` del final.
--
-- Medido el 2026-08-17, Salud 1, 40 filas:
--   antes                          912 ms · 98,132 bloques · 9,180 de disco
--   con traslados_en_vuelo arreglado 302 ms
--   con esto                       111 ms · 56,497 bloques · 0 de disco
--
-- Verificado contra la versión vieja en las SIETE salas: mismos productos,
-- mismos nombres, mismos mínimos, mismo contenido de `donde` y mismo orden de
-- filas. Cero diferencias.
--
-- El único cambio deliberado es el desempate de `donde`. El `jsonb_agg` ordenaba
-- sólo por `unidades DESC`, así que dos salas con las mismas unidades salían en
-- orden ARBITRARIO — y el widget pinta `donde.slice(0, 3)`, o sea que cuáles de
-- las tres se veían podía cambiar entre dos cargas de la misma pantalla. El
-- `, a.erp_sucursal_id` lo vuelve estable sin mover ninguna sala de lugar
-- respecto de otra que tenga más unidades.
CREATE OR REPLACE FUNCTION public.get_faltantes_con_stock_en_otra_sala(
  p_erp_sucursal_id integer,
  p_limite integer DEFAULT 40
)
RETURNS TABLE(erp_product_id integer, descripcion text, min_units integer, donde jsonb)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
    -- Los candidatos mandan, y por eso van primero.
    WITH mio AS (
        SELECT sp.erp_product_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units) AS min_mio
        FROM public.product_stock_params sp
        WHERE sp.erp_sucursal_id = p_erp_sucursal_id
          AND coalesce(sp.manual_min, sp.calc_min, sp.min_units) > 0
    ),
    base AS (
        SELECT d.erp_product_id, d.erp_sucursal_id, d.unidades::integer AS unidades
        FROM public.v_inventario_disponible d
        WHERE d.unidades > 0
          AND d.erp_product_id IN (SELECT m.erp_product_id FROM mio m)
    ),
    -- Está en mi mínimo y no tengo ni una unidad disponible.
    faltan AS (
        SELECT m.erp_product_id, m.min_mio
        FROM mio m
        WHERE NOT EXISTS (
            SELECT 1 FROM base b0
            WHERE b0.erp_product_id = m.erp_product_id
              AND b0.erp_sucursal_id = p_erp_sucursal_id
        )
    ),
    nombres AS (
        SELECT i.erp_product_id, max(i.descripcion) AS descripcion
        FROM public.inventory i
        WHERE i.cantidad > 0
          AND i.erp_product_id IN (SELECT f.erp_product_id FROM faltan f)
        GROUP BY 1
    ),
    ajenas AS (
        SELECT b.erp_product_id, b.erp_sucursal_id, b.unidades,
               coalesce(m.nombre, 'Sucursal ' || b.erp_sucursal_id) AS sala,
               m.branch_id,
               coalesce(sp2.manual_min, sp2.calc_min, sp2.min_units, 0) AS min_suyo,
               v.primero AS vence
        FROM base b
        JOIN faltan f ON f.erp_product_id = b.erp_product_id
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
        WHERE b.erp_sucursal_id <> p_erp_sucursal_id
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

DROP FUNCTION IF EXISTS public._tmp_faltantes_nueva(integer, integer);
