SET lock_timeout = '5s';

-- `sin_resolver`: las diferencias de esa sala que TODAVÍA esperan algo.
--
-- `con_diferencia` ya estaba, pero cuenta el `status` del renglón, y ese status
-- se queda en `con_diferencia` para siempre — es el registro de que hubo una.
-- O sea que una sala con todo acordado y el traslado hecho seguía contando 1, y
-- cualquier pantalla que lo usara diría que le falta algo.
--
-- Lo que dice si falta algo es `resolucion_status`, cuyo único estado terminal
-- es `confirmada`: `acordada` todavía tiene un movimiento en vuelo,
-- `propuesta`/`contrapropuesta`/`escalada` esperan a alguien, y NULL es que
-- nadie propuso nada. `IS DISTINCT FROM` y no `<>` justamente por ese NULL.
--
-- Se calcula acá y no en el navegador para que haya UNA respuesta: la usan el
-- orden del tablero —lo que necesita atención va arriba, sin importar la
-- fecha— y el chip «difs. pendientes» de la tarjeta. Dos copias de esta regla
-- son dos números que se pueden contradecir en la misma pantalla.
--
-- Medido al aplicarla, pedido #150: La Popular `con_diferencia 1 · sin_resolver
-- 1` (el REGUTOL, en contrapropuesta) y Salud 5 `con_diferencia 1 ·
-- sin_resolver 0` (el SECUFEM, cerrado y con su traslado hecho).
--
-- Va con DROP porque agregar una columna de salida cambia el tipo de retorno y
-- `CREATE OR REPLACE` no lo admite. El DROP toma lock sobre la función, no
-- sobre `pedido_items`.
DROP FUNCTION IF EXISTS public.get_pedido_item_stats(uuid[]);

CREATE FUNCTION public.get_pedido_item_stats(p_pedido_ids uuid[])
 RETURNS TABLE(pedido_id uuid, erp_sucursal_id integer, enviados integer,
               sin_stock integer, por_regla integer, agotamiento integer,
               pendientes integer, con_diferencia integer, no_enviados integer,
               sin_resolver integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT
        pedido_id,
        erp_sucursal_id,
        COUNT(*) FILTER (WHERE cantidad_asignada > 0 AND NOT agotamiento)::INT AS enviados,
        COUNT(*) FILTER (WHERE sin_stock = true)::INT                          AS sin_stock,
        COUNT(*) FILTER (WHERE revision_minmax = true)::INT                    AS por_regla,
        COUNT(*) FILTER (WHERE agotamiento = true)::INT                        AS agotamiento,
        COUNT(*) FILTER (WHERE status = 'pendiente')::INT                      AS pendientes,
        COUNT(*) FILTER (WHERE status = 'con_diferencia')::INT                 AS con_diferencia,
        COUNT(*) FILTER (WHERE status = 'no_enviado')::INT                     AS no_enviados,
        COUNT(*) FILTER (WHERE status = 'con_diferencia'
                           AND resolucion_status IS DISTINCT FROM 'confirmada')::INT AS sin_resolver
    FROM pedido_items
    WHERE pedido_id = ANY(p_pedido_ids)
    GROUP BY pedido_id, erp_sucursal_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_pedido_item_stats(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pedido_item_stats(uuid[]) TO authenticated, service_role;
