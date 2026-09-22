-- BORRADOR — NO APLICADO. Preparado el 2026-09-22 (plan D1, `donde-hay-un-producto`
-- en 30.5 ms contra un techo de 30). Espera el OK del usuario.
--
-- `get_donde_hay` cuesta casi entero lo que cuesta `traslados_en_vuelo()` (28 ms,
-- medido aislado). Su CTE `base` recorre TODAS las solicitudes de traslado
-- aprobadas de la historia —1,383 el 22-sep, y crece con cada traslado— y abre el
-- jsonb de cada una para descubrir que casi ninguna salió después de la última
-- lectura de inventario de su sala. O sea que el techo se va a seguir cruzando
-- solo, por el paso del tiempo.
--
-- Prefiltro por `updated_at`, que es exacto por construcción: un traslado vivo
-- cumple `traslado_at > u.at` (la última lectura de su sala), y
-- `approval_requests_updated_at` (BEFORE UPDATE) garantiza
-- `updated_at >= traslado_at` porque el `erp_traslado` se escribe con un UPDATE.
-- Verificado en las 1,383 filas: 0 violan `traslado_at <= updated_at`. Si alguna
-- sala no tiene lectura (u.at NULL), el prefiltro se apaga (-infinity), igual que
-- el `coalesce` de `vivos`.
--
-- Medido: 28.2 ms → 1.7 ms, mismo resultado (hoy vacío: no había traslados en
-- vuelo; volver a comparar md5 en un momento con traslados vivos antes de aplicar).
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
          -- Prefiltro exacto (ver el encabezado del borrador): sólo lo que se
          -- tocó después de la lectura más vieja puede estar en vuelo.
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
    SELECT v.suc,
           (it->>'erp_product_id')::integer,
           sum(coalesce((it->>'cantidad')::numeric, 0) * coalesce((it->>'factor')::numeric, 1))
    FROM vivos v
    CROSS JOIN LATERAL jsonb_array_elements(v.items) it
    GROUP BY 1, 2;
$function$;
