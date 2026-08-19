SET lock_timeout = '5s';

-- Qué recepciones quedaron a medias y hay que retomar solas.
--
-- ── Por qué hace falta ──────────────────────────────────────────────────────
-- El DESPACHO se retoma solo: deja su fila en `pedido_traslado_erp` y el cron
-- `continuar-traslados-pedido` la adopta cada minuto. La RECEPCIÓN no deja
-- ninguna fila, así que lo que no entra en su presupuesto se queda ahí hasta
-- que una persona vea la tarjeta y apriete «Reintentar».
--
-- Medido el 2026-08-19 sobre el pedido 120 de Salud 2: la recepción trabajó
-- **238,8 segundos** contra un techo de 240 y se cortó con 6 renglones sin
-- entrar (364 recibidos, ~656 ms cada uno). Esos 6 —3 de la hoja 11 y las 3
-- cajas de Electrolit, o sea la COLA de la lista— pasaron un día en tránsito:
-- fuera de Bodega y sin entrar a la sala, o sea sin poder venderse. El mismo
-- día, el pedido 119 recibió 383 renglones y entró justo. En ese tamaño la
-- recepción está exactamente en su límite.
--
-- ── El criterio es el del botón, no uno nuevo ───────────────────────────────
-- Lo que se retoma es lo que `items_sin_ingresar` ya llamaba «contado por la
-- sala y sin entrar»: la línea sigue `enviada` y su renglón está `recibido` o
-- `con_diferencia`. Un renglón que nadie contó NO entra acá — que su línea siga
-- `enviada` es lo normal mientras la caja no se haya abierto, y meterlo al
-- inventario por su cuenta sería inventar que llegó.
--
-- `estado = 'enviada'` y no `<> 'recibida'`: una línea en `error` se cerró a
-- propósito (un traslado anulado, por ejemplo) y no se reintenta sola; una en
-- `recibiendo` está en manos de otra corrida ahora mismo.
--
-- `p_minutos` es la distancia con la recepción normal: si la sala confirmó hace
-- un momento, lo que falta probablemente esté entrando en este instante y no
-- hay que empujarlo desde atrás.
CREATE OR REPLACE FUNCTION public.recepciones_por_reintentar(p_minutos integer DEFAULT 10)
RETURNS TABLE(pedido_id uuid, erp_sucursal_id integer, sin_ingresar integer)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    SELECT l.pedido_id,
           l.erp_sucursal_id,
           count(*)::integer
    FROM public.pedido_traslado_linea l
    JOIN public.pedido_items pi ON pi.id = l.pedido_item_id
    WHERE l.estado = 'enviada'
      AND l.id_traslado IS NOT NULL
      AND pi.status IN ('recibido', 'con_diferencia')
      AND pi.received_at IS NOT NULL
      AND pi.received_at < now() - make_interval(mins => p_minutos)
    GROUP BY l.pedido_id, l.erp_sucursal_id;
$$;

REVOKE EXECUTE ON FUNCTION public.recepciones_por_reintentar(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recepciones_por_reintentar(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.recepciones_por_reintentar(integer) IS
  'Recepciones de pedido que quedaron a medias: la sala contó el renglón y el traslado no entró al inventario. La lee el cron reintentar-ingreso-pedido.';
