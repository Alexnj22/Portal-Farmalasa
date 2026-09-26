-- `resumen_ingreso_pedidos` leía 214 MB por llamada (27,425 bloques) y se
-- llama ~1,000 veces: `gate:perf` sección F la marcó el 2026-09-26.
--
-- El costo no era el plan genérico (usa índices bien): era que, para contar
-- los renglones «contados y sin ingresar», buscaba el ítem de CADA renglón uno
-- por uno en `pedido_items` por su llave —3,933 búsquedas para 20 pedidos,
-- ~4 bloques cada una—. Sólo hacía falta saber qué ítems de ESOS pedidos
-- están recibidos: se traen de una vez por `idx_pedido_items_pedido_status`
-- y se cruzan en memoria.
--
-- Medido con 20 pedidos reales y el plan genérico que usa la función:
-- 16,445 → 1,343 bloques, 159 → 26 ms. Resultado idéntico al anterior con 20
-- recientes, 200 al azar, todos los pedidos, y un id que no existe. Es válido
-- porque el ítem de un renglón es siempre del mismo pedido que el renglón
-- (medido: 0 de 17,027 renglones cruzan de pedido).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.resumen_ingreso_pedidos(p_pedido_ids uuid[])
 RETURNS TABLE(pedido_id uuid, erp_sucursal_id integer, lineas integer, ingresadas integer, sin_ingresar integer, con_error integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    -- Los ítems ya contados en el portal, de estos pedidos, de una sola vez.
    WITH ok AS MATERIALIZED (
        SELECT pi.id
          FROM public.pedido_items pi
         WHERE pi.pedido_id = ANY (p_pedido_ids)
           AND pi.status IN ('recibido', 'con_diferencia')
    )
    SELECT
        l.pedido_id,
        l.erp_sucursal_id,
        count(*)::integer,
        count(*) FILTER (WHERE l.estado = 'recibida')::integer,
        -- EL número: contado en el portal y sin entrar al inventario. Un renglón
        -- todavía pendiente NO cuenta acá — que su línea siga 'enviada' es lo
        -- normal mientras nadie lo haya contado.
        count(*) FILTER (
            WHERE l.estado <> 'recibida'
              AND ok.id IS NOT NULL
        )::integer,
        count(*) FILTER (WHERE l.estado = 'error')::integer
    FROM public.pedido_traslado_linea l
    LEFT JOIN ok ON ok.id = l.pedido_item_id
    WHERE l.pedido_id = ANY (p_pedido_ids)
    GROUP BY l.pedido_id, l.erp_sucursal_id;
$function$;