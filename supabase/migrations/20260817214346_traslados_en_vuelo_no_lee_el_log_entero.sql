SET lock_timeout = '5s';

-- `traslados_en_vuelo()` necesita SIETE números: la última sincronización buena
-- de cada sala. Los sacaba con un `GROUP BY` sobre `inventory_sync_log` entero
-- —779,411 filas, 108 MB— porque no había índice que sirviera: el único que
-- existe arranca por `is_vencidos`, así que no puede resolver un máximo por
-- sucursal. Medido el 2026-08-17 dentro de
-- `get_faltantes_con_stock_en_otra_sala`: 6,766 bloques leídos de DISCO en ese
-- solo nodo, para devolver 0 filas.
--
-- El log crece 10,080 filas por día (7 salas × cada minuto) y la purga lo deja
-- en 90 días, así que el tamaño es el esperado y va a seguir ahí: el problema
-- no es el log, es leerlo entero.
--
-- Esto pega más lejos de lo que parece: la función la llama la vista
-- `v_inventario_disponible`, que es la base de todo lo que muestra existencias.
CREATE INDEX IF NOT EXISTS idx_inventory_sync_log_suc_synced
  ON public.inventory_sync_log (erp_sucursal_id, synced_at DESC)
  WHERE success AND is_vencidos = false;

-- El `GROUP BY` pasa a ser un lateral por sala: con el índice de arriba cada
-- `max()` es UNA lectura (el primer renglón del índice), no un agregado.
--
-- La lista de salas sale de `erp_sucursal_map`, que es el registro canónico —y
-- se verificó que las siete que escriben en el log (ids 1..7) están todas ahí.
-- La diferencia con el `GROUP BY` viejo es sólo para una sala SIN ninguna
-- sincronización buena: antes no producía fila, ahora produce una con `at` en
-- NULL. Da igual río abajo, porque el `coalesce(u.at, '-infinity')` de la
-- consulta trata los dos casos como «nunca se sincronizó».
CREATE OR REPLACE FUNCTION public.traslados_en_vuelo()
 RETURNS TABLE(erp_sucursal_id integer, erp_product_id integer, unidades numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH ultima AS (
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
    GROUP BY 1, 2;
$function$;
