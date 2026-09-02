SET lock_timeout = '5s';

-- ── Una palabra: MATERIALIZED ────────────────────────────────────────────────
-- `traslados_en_vuelo()` costaba **5,513 bloques para devolver una fila**, y su
-- mismo cuerpo escrito a mano costaba 292. La diferencia entera estaba en el CTE
-- `ultima`, que sin la cerca se INLINEA en el join y se vuelve a calcular **una
-- vez por cada solicitud de traslado** — 694 vueltas, cada una releyendo
-- `erp_sucursal_map` y `inventory_sync_log` para el mismo resultado de 7 filas:
--
--     Index Only Scan erp_sucursal_map   ... loops=694   1,388 bloques
--     Index Only Scan inventory_sync_log ... loops=694   2,780 bloques
--
-- Con `MATERIALIZED` se calcula UNA vez: 7 filas, 33 bloques. Medido sobre el
-- cuerpo completo: **4,418 -> 346 bloques, 12.8x más barato**.
--
-- ── Por qué importa más de lo que parece ─────────────────────────────────────
-- No es una función de una pantalla: la lee `v_inventario_disponible`, o sea
-- todo el módulo de inventario. Y como el costo NO depende de cuántas filas
-- devuelve —era el mismo con cero traslados en vuelo—, era un peaje fijo de
-- ~4,500 bloques en cada lectura de existencia disponible del portal.
--
-- Medido de punta a punta en `get_faltantes_con_stock_en_otra_sala`, las 7 salas,
-- contra el original de antes de las dos migraciones de hoy:
--
--     sala 1  60,507 -> 27,317   -55%
--     sala 2  57,871 -> 23,283   -60%
--     sala 3  57,967 -> 23,697   -59%
--     sala 4  57,674 -> 22,409   -61%
--     sala 5  57,698 -> 21,292   -63%
--     sala 6  69,155 -> 66,283    -4%   (2,604 productos con mínimo, 594 faltantes)
--     sala 7  56,870 -> 14,130   -75%
--
-- La sala 6 es la que casi no baja, y es la misma razón por la que con la
-- migración anterior sola había quedado 8% PEOR: al tener 594 faltantes contra
-- ~100 de las demás, el ahorro de preguntar sólo por lo que falta no alcanzaba a
-- pagar el peaje de evaluar `traslados_en_vuelo` dos veces. Con el peaje casi
-- eliminado, las 7 mejoran.
--
-- ── Verificado, no deducido ──────────────────────────────────────────────────
-- `MATERIALIZED` cambia CUÁNDO se evalúa el CTE, no qué contiene, así que el
-- resultado «tiene que» ser el mismo. Con el filtro tal como está las dos ramas
-- devuelven cero filas, y comparar dos conjuntos vacíos no prueba nada: se
-- corrió el reloj 30 días atrás para forzar un conjunto de verdad y se
-- enfrentaron las dos versiones — **660 filas cada una, 0 diferencias en los dos
-- sentidos, suma idéntica (8,800)**.
CREATE OR REPLACE FUNCTION public.traslados_en_vuelo()
 RETURNS TABLE(erp_sucursal_id integer, erp_product_id integer, unidades numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    -- MATERIALIZED, y no es cosmético: sin la cerca este CTE se vuelve a
    -- calcular una vez por solicitud de traslado. Ver el encabezado.
    WITH ultima AS MATERIALIZED (
        -- El margen va acá y no en la comparación para que se lea una sola vez
        -- qué significa: «el sistema se leyó, como muy tarde, 15 s antes de que
        -- lo anotáramos».
        SELECT m.erp_sucursal_id AS suc, u.at
        FROM public.erp_sucursal_map m
        CROSS JOIN LATERAL (
            SELECT max(l.synced_at) - interval '15 seconds' AS at
            FROM public.inventory_sync_log l
            WHERE l.erp_sucursal_id = m.erp_sucursal_id
              AND l.success AND l.is_vencidos = false
        ) u
    )
    SELECT (a.metadata->>'origen_erp_sucursal_id')::integer,
           (it->>'erp_product_id')::integer,
           sum(coalesce((it->>'cantidad')::numeric, 0) * coalesce((it->>'factor')::numeric, 1))
    FROM public.approval_requests a
    CROSS JOIN LATERAL jsonb_array_elements(a.metadata->'items') it
    LEFT JOIN ultima u ON u.suc = (a.metadata->>'origen_erp_sucursal_id')::integer
    WHERE a.type = 'INVENTORY_TRANSFER_REQUEST'
      AND a.status = 'APPROVED'
      AND a.metadata ? 'erp_traslado'
      AND (a.metadata->'erp_traslado'->>'at')::timestamptz > coalesce(u.at, '-infinity'::timestamptz)
      -- Lo que salió del área de vencidos no bajó el estante normal.
      AND NOT coalesce((a.metadata->>'origen_vencidos')::boolean, false)
    GROUP BY 1, 2;
$function$;
