-- F4 · `traslados_en_vuelo()` deja de recorrer la historia entera de traslados.
--
-- Cada lectura de `v_inventario_disponible` la llama (dónde hay un producto,
-- aprobar un traslado, faltantes con stock en otra sala, el buscador global), y
-- costaba 28–32 ms aunque no hubiera NADA en vuelo: su CTE `base` recorría todas
-- las solicitudes aprobadas de la historia —1,388 el 22-sep, y crece con cada
-- traslado— abriendo el jsonb de cada una para descubrir que casi ninguna salió
-- después de la última lectura de inventario de su sala. `get_donde_hay` ya
-- cruzaba su techo de 30 ms en `gate:perf` sólo por el paso del tiempo.
--
-- Prefiltro por `updated_at`, exacto por construcción: un traslado está en vuelo
-- si `traslado_at > u.at` (la última lectura de SU sala), y `traslado_at <=
-- updated_at` siempre, porque `erp_traslado` se escribe con un UPDATE y el
-- trigger `approval_requests_updated_at` sella `updated_at` en ese momento. Así
-- que lo que no se tocó después de la lectura MÁS VIEJA de las salas no puede
-- estar en vuelo, y no hace falta abrirle el jsonb. Si alguna sala no tiene
-- lectura (`u.at` NULL), el prefiltro se apaga (`-infinity`), igual que el
-- `coalesce` de `vivos`.
--
-- Verificado el 2026-09-22 sobre las 1,388 aprobadas: 0 con `traslado_at >
-- updated_at` (la más cercana, 18 ms antes) y 0 con origen fuera de
-- `erp_sucursal_map`. Como a esa hora no había nada en vuelo, la equivalencia se
-- probó en pg_temp moviendo el margen de 15 s a 1 h, 6 h, 1, 3, 7, 30 y 365
-- días —de 0 a 1,225 filas en vuelo—: md5 idéntico en los ocho cortes.
--   caso real (margen 15 s): 32.5 → 2.3 ms
SET lock_timeout = '5s';

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
    ),
    -- Los tres campos del jsonb, UNA vez por fila. `MATERIALIZED` es lo que lo
    -- garantiza: sin la cerca el planificador vuelve a empujar las expresiones
    -- adentro del join y reaparecen las 8,624 extracciones.
    base AS MATERIALIZED (
        SELECT (a.metadata->>'origen_erp_sucursal_id')::integer   AS suc,
               (a.metadata->'erp_traslado'->>'at')::timestamptz   AS traslado_at,
               a.metadata->'items'                                AS items
        FROM public.approval_requests a
        WHERE a.type = 'INVENTORY_TRANSFER_REQUEST'
          AND a.status = 'APPROVED'
          -- Prefiltro exacto: `traslado_at <= updated_at` siempre, así que lo
          -- que no se tocó después de la lectura más vieja no puede estar en
          -- vuelo. Va ANTES de abrir el jsonb (ver el encabezado de la
          -- migración 2026-09-22).
          AND a.updated_at > (SELECT CASE WHEN bool_or(u.at IS NULL) THEN '-infinity'::timestamptz
                                          ELSE min(u.at) END
                                FROM ultima u)
          AND a.metadata ? 'erp_traslado'
          -- Lo que salió del área de vencidos no bajó el estante normal.
          AND NOT coalesce((a.metadata->>'origen_vencidos')::boolean, false)
    ),
    vivos AS MATERIALIZED (
        SELECT b.suc, b.items
        FROM base b
        LEFT JOIN ultima u ON u.suc = b.suc
        WHERE b.traslado_at > coalesce(u.at, '-infinity'::timestamptz)
    )
    -- La expansión del arreglo va DESPUÉS del filtro y no antes: así sólo se
    -- abre el `items` de lo que de verdad está en vuelo. Es además lo que el
    -- plan viejo hacía de hecho (`never executed`), pero por suerte y no por
    -- construcción — otro plan podía abrirlo primero.
    SELECT v.suc,
           (it->>'erp_product_id')::integer,
           sum(coalesce((it->>'cantidad')::numeric, 0) * coalesce((it->>'factor')::numeric, 1))
    FROM vivos v
    CROSS JOIN LATERAL jsonb_array_elements(v.items) it
    GROUP BY 1, 2;
$function$;
