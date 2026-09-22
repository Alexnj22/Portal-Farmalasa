-- F2 · Aprobar un traslado: la existencia de los productos pedidos se calcula UNA vez.
--
-- `get_traslado_disponibilidad` leía `v_inventario_disponible` dos veces (el mapa
-- de las 7 salas y la existencia del origen), cada una filtrada por el producto
-- de cada renglón. Esa vista agrupa los lotes y le resta `traslados_en_vuelo()`,
-- y pedírsela renglón por renglón la rehacía por renglón: 869 MB por llamada, la
-- más cara del portal por llamada.
--
-- Ahora `disp` la calcula una sola vez, SÓLO para los productos de la solicitud
-- (`= ANY (ARRAY(...))`, que el planificador resuelve antes y usa como llave), y
-- las dos lecturas salen de ahí. Sigue INVOKER: el RLS decide igual que antes.
--
-- Y un desempate: `alternativas` se ordenaba sólo por unidades, así que dos salas
-- con la misma existencia salían en el orden que dejara el plan. Cambiar el plan
-- las permutaba —11 de 40 solicitudes— sin cambiar ningún dato. Ahora desempata
-- por sala, y el orden deja de depender de cómo se calcula.
--
-- Comprobado en pg_temp con 60 solicitudes reales (las 10 de vencidos, las 10
-- más largas y las 40 últimas) y dos cuentas, alcance total y Salud 1: 120/120
-- idénticas contra la versión actual con el mismo desempate.
--   alcance total: mediana 259 → 36 ms, promedio 304 → 83 ms
--   Salud 1:       promedio  85 → 20 ms
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_traslado_disponibilidad(p_request_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH sol AS (
        SELECT nullif(a.metadata->>'origen_erp_sucursal_id','')::integer AS origen,
               nullif(a.metadata->>'erp_sucursal_id','')::integer        AS destino,
               nullif(a.metadata->>'origen_branch_id','')::integer       AS origen_bid,
               a.metadata->>'origen_branch_name'                         AS origen_nombre,
               coalesce((a.metadata->>'origen_vencidos')::boolean,false) AS origen_venc,
               coalesce(a.metadata->'items','[]'::jsonb)                 AS items
        FROM public.approval_requests a
        WHERE a.id = p_request_id AND a.type = 'INVENTORY_TRANSFER_REQUEST'
    ),
    -- `WITH ORDINALITY` conserva el ORDEN del array, e `idx` es la posición en
    -- `metadata.items`. Esa posición es el nombre del renglón en todo el
    -- circuito: es como `aplicar-movimiento-inventario` recibe qué líneas entran
    -- («el cliente manda ÍNDICES con su cantidad, nunca las líneas»), y por lo
    -- mismo — con índices, el navegador sólo puede señalar cuáles de las que YA
    -- se guardaron entran, no inventar una.
    lineas AS (
        SELECT (it.ord - 1)::integer AS idx,
               nullif(it.item->>'erp_product_id','')::integer AS prod,
               it.item->>'descripcion' AS descripcion,
               coalesce((it.item->>'cantidad')::numeric, 0)
                 * coalesce((it.item->>'factor')::numeric, 1) AS pedido
        FROM sol, jsonb_array_elements(sol.items) WITH ORDINALITY AS it(item, ord)
    ),
    -- La existencia de los productos pedidos, calculada UNA vez para las dos
    -- lecturas de abajo (ver el encabezado de la migración 2026-09-22).
    disp AS MATERIALIZED (
        SELECT d.erp_product_id, d.erp_sucursal_id, d.unidades, d.en_vuelo
        FROM public.v_inventario_disponible d
        WHERE d.erp_product_id = ANY (ARRAY(SELECT l.prod FROM lineas l))
    ),
    stock AS (
        SELECT l.idx, d.erp_sucursal_id, d.unidades
        FROM lineas l
        JOIN disp d ON d.erp_product_id = l.prod
    ),
    -- El estante del origen: el de vencidos cuando la solicitud lo nombra, el
    -- normal en todos los demás casos.
    stock_origen AS (
        SELECT l.idx, d.unidades, d.en_vuelo
        FROM lineas l CROSS JOIN sol
        JOIN public.v_inventario_disponible_vencidos d
          ON d.erp_product_id = l.prod AND d.erp_sucursal_id = sol.origen
        WHERE sol.origen_venc
        UNION ALL
        SELECT l.idx, d.unidades, d.en_vuelo
        FROM lineas l CROSS JOIN sol
        JOIN disp d
          ON d.erp_product_id = l.prod AND d.erp_sucursal_id = sol.origen
        WHERE NOT sol.origen_venc
    ),
    minimos AS (
        SELECT l.idx, sp.erp_sucursal_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units, 0) AS minimo
        FROM lineas l
        JOIN public.product_stock_params sp ON sp.erp_product_id = l.prod
    ),
    detalle AS (
        SELECT l.idx, l.prod, l.descripcion, l.pedido,
               coalesce(so.unidades, 0) AS unidades,
               coalesce(so.en_vuelo, 0) AS en_vuelo,
               -- El área de vencidos no defiende un mínimo: ahí no se repone nada.
               CASE WHEN sol.origen_venc THEN 0 ELSE coalesce(mo.minimo, 0) END AS minimo,
               (coalesce(so.unidades, 0) >= l.pedido) AS puede,
               -- A quién más pedirle ESTE renglón: las salas que lo cubren
               -- entero, sin contar el origen ni el destino. Es por renglón
               -- porque cada producto tiene su propio mapa de quién lo tiene.
               -- Dos salas con la misma existencia se desempatan por sala: sin
               -- eso, el orden lo decidía el plan.
               coalesce((
                   SELECT json_agg(json_build_object(
                              'erp_sucursal_id', s.erp_sucursal_id,
                              'sala',            coalesce(m.nombre, 'Sucursal ' || s.erp_sucursal_id),
                              'unidades',        s.unidades,
                              'minimo',          coalesce(mi.minimo, 0))
                            ORDER BY s.unidades DESC, s.erp_sucursal_id)
                   FROM stock s
                   LEFT JOIN minimos mi ON mi.idx = s.idx AND mi.erp_sucursal_id = s.erp_sucursal_id
                   LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = s.erp_sucursal_id
                   WHERE s.idx = l.idx
                     AND s.erp_sucursal_id <> sol.origen
                     AND s.erp_sucursal_id <> sol.destino
                     AND s.unidades >= l.pedido
               ), '[]'::json) AS alternativas
        FROM lineas l
        CROSS JOIN sol
        LEFT JOIN stock_origen so ON so.idx = l.idx
        LEFT JOIN minimos mo ON mo.idx = l.idx AND mo.erp_sucursal_id = sol.origen
    )
    SELECT json_build_object(
        'pedido', coalesce(l0.pedido, 0),
        'origen', json_build_object(
            'erp_sucursal_id', sol.origen,
            'vencidos', sol.origen_venc,
            'unidades', coalesce(l0.unidades, 0),
            'en_vuelo', coalesce(l0.en_vuelo, 0),
            'minimo',   coalesce(l0.minimo, 0),
            'puede',    coalesce((SELECT bool_and(d.puede) FROM detalle d), false)
        ),
        'respaldo', CASE
            WHEN sol.origen_bid IS NOT NULL
             AND sol.origen_bid = ANY (COALESCE(public.salas_que_cubro_ahora(), ARRAY[]::integer[]))
            THEN json_build_object('sala', coalesce(nullif(sol.origen_nombre, ''), 'La otra sala'))
            ELSE NULL
        END,
        'alternativas', coalesce(l0.alternativas, '[]'::json),
        'lineas', coalesce((
            SELECT json_agg(json_build_object(
                       'idx',            d.idx,
                       'erp_product_id', d.prod,
                       'descripcion',    d.descripcion,
                       'pedido',         d.pedido,
                       'unidades',       d.unidades,
                       'en_vuelo',       d.en_vuelo,
                       'minimo',         d.minimo,
                       'puede',          d.puede,
                       'alternativas',   d.alternativas)
                     ORDER BY d.idx)
            FROM detalle d), '[]'::json)
    )
    FROM sol LEFT JOIN detalle l0 ON l0.idx = 0;
$function$;
