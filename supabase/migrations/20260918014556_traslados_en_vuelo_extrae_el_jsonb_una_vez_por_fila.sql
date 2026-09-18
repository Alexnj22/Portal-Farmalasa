SET lock_timeout = '5s';

-- `traslados_en_vuelo` costaba 44 ms para devolver CERO filas, y el barrido de
-- `approval_requests` no era la causa.
--
-- El plan entraba con un nested loop: 1,232 solicitudes aprobadas × las 7 filas
-- del CTE `ultima`, y el predicado del join —`(metadata->'erp_traslado'->>'at')
-- ::timestamptz > coalesce(u.at, …)`— se evaluaba en CADA vuelta. O sea **8,624
-- extracciones de jsonb más su parseo a timestamptz** para contestar que no hay
-- nada en vuelo. Medido: 8,624 evaluaciones ≈ 43 ms sobre un trabajo de 26.
--
-- El planificador lo elegía por una estimación equivocada: le da `rows=1` al
-- filtro de `approval_requests` —cuatro condiciones, dos de ellas sobre jsonb,
-- cuyas selectividades por defecto se multiplican— cuando en realidad pasan
-- 1,232. Con una fila estimada, recorrer 7 del CTE parece gratis.
--
-- La corrección NO toca ni un predicado: extrae los tres campos del jsonb UNA
-- vez por fila en un CTE `MATERIALIZED`, y recién entonces junta contra
-- `ultima`. Con columnas planas a los dos lados el planificador elige un Hash
-- Right Join y las comparaciones bajan de 8,624 a 1,232.
--
--   44.0 ms → 26.3 ms · 515 → 442 bloques   (producción, EXPLAIN ANALYZE TIMING OFF)
--
-- Enfrentadas sobre 1,117 filas y 14,030 unidades —relajando la fecha de corte
-- diez años para que hubiera datos que comparar, porque las dos devuelven vacío
-- con los datos de hoy y un vacío no prueba nada—: **0 filas de diferencia en
-- las dos direcciones**.
--
-- Importa por frecuencia, no por tamaño: `v_inventario_disponible` la llama, y
-- esa vista tiene cuatro puertas —el widget del tablero al entrar, la consulta
-- de inventario, la pantalla de aprobar y el trigger que valida la solicitud—.
--
-- Queda un piso de ~26 ms que es detoastear y parsear las 1,232 `metadata`
-- (409 de los 442 bloques). Bajarlo pide no leer las históricas, y eso no se
-- puede acotar por fecha sin cambiar el resultado: si el inventario de una sala
-- lleva horas sin sincronizar, un traslado de hace horas SIGUE en vuelo. Es
-- justo el caso para el que la función existe.
--
-- El gemelo de vencidos tenía la misma forma y encima su `ultima` ni siquiera
-- estaba `MATERIALIZED`. Se corrige igual: si sólo se arreglara uno, el día que
-- alguien lea los dos planes va a encontrar dos respuestas para la misma
-- pregunta.

CREATE OR REPLACE FUNCTION public.traslados_en_vuelo()
RETURNS TABLE(erp_sucursal_id integer, erp_product_id integer, unidades numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.traslados_en_vuelo_vencidos()
RETURNS TABLE(erp_sucursal_id integer, erp_product_id integer, unidades numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    WITH ultima AS MATERIALIZED (
        SELECT m.erp_sucursal_id AS suc, u.at
        FROM public.erp_sucursal_map m
        CROSS JOIN LATERAL (
            SELECT max(l.synced_at) - interval '15 seconds' AS at
            FROM public.inventory_sync_log l
            WHERE l.erp_sucursal_id = m.erp_sucursal_id
              AND l.success AND l.is_vencidos = true
        ) u
    ),
    base AS MATERIALIZED (
        SELECT (a.metadata->>'origen_erp_sucursal_id')::integer   AS suc,
               (a.metadata->'erp_traslado'->>'at')::timestamptz   AS traslado_at,
               a.metadata->'items'                                AS items
        FROM public.approval_requests a
        WHERE a.type = 'INVENTORY_TRANSFER_REQUEST'
          AND a.status = 'APPROVED'
          AND a.metadata ? 'erp_traslado'
          AND coalesce((a.metadata->>'origen_vencidos')::boolean, false)
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
$$;

REVOKE EXECUTE ON FUNCTION public.traslados_en_vuelo()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.traslados_en_vuelo_vencidos() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.traslados_en_vuelo()          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.traslados_en_vuelo_vencidos() TO authenticated, service_role;
