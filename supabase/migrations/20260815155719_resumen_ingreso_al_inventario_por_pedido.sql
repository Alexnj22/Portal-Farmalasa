SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- ¿Lo que la sala dio por recibido está en el inventario?
--
-- Confirmar una recepción escribe en DOS sitios: el renglón queda 'recibido' en
-- `pedido_items` y su línea de `pedido_traslado_linea` pasa a 'recibida', que es
-- lo que de verdad mueve existencias. El segundo va en su propio try a propósito
-- —un tropiezo del otro lado no puede deshacer un conteo ya guardado—, así que
-- el estado «lo conté y NO entró» existe por diseño y deja a la sala sin poder
-- facturar.
--
-- Hasta hoy ese estado no se veía en ninguna pantalla: el aviso era un toast que
-- se va solo y la píldora de la tarjeta sólo hablaba del despacho. Esto es lo que
-- le falta a la tarjeta para decirlo.
--
-- INVOKER a propósito (sin SECURITY DEFINER): las policies de las dos tablas son
-- por `erp_sucursal_id`, así que cada sala ve lo suyo y quien tiene alcance ALL
-- ve todo — exactamente lo que ya hace la tarjeta. Con DEFINER, una sala vería
-- los pedidos de las demás.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resumen_ingreso_pedidos(p_pedido_ids uuid[])
RETURNS TABLE (
    pedido_id       uuid,
    erp_sucursal_id integer,
    lineas          integer,
    ingresadas      integer,
    sin_ingresar    integer,
    con_error       integer
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
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
              AND pi.status IN ('recibido', 'con_diferencia')
        )::integer,
        count(*) FILTER (WHERE l.estado = 'error')::integer
    FROM public.pedido_traslado_linea l
    JOIN public.pedido_items pi ON pi.id = l.pedido_item_id
    WHERE l.pedido_id = ANY (p_pedido_ids)
    GROUP BY l.pedido_id, l.erp_sucursal_id;
$$;

REVOKE EXECUTE ON FUNCTION public.resumen_ingreso_pedidos(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resumen_ingreso_pedidos(uuid[]) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Qué renglones hay que reintentar. Los devuelve para que quien reintenta mande
-- la lista EXACTA: la recepción sin `pedido_item_ids` ni `hoja` toma todo lo
-- pendiente de la sucursal, y ahí entrarían al inventario renglones que la sala
-- todavía no contó — justo el defecto inverso.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.items_sin_ingresar(p_pedido_id uuid, p_sucursal_id integer)
RETURNS integer[]
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    SELECT coalesce(array_agg(l.pedido_item_id ORDER BY l.hoja, l.pedido_item_id), '{}')
    FROM public.pedido_traslado_linea l
    JOIN public.pedido_items pi ON pi.id = l.pedido_item_id
    WHERE l.pedido_id       = p_pedido_id
      AND l.erp_sucursal_id = p_sucursal_id
      AND l.estado <> 'recibida'
      AND pi.status IN ('recibido', 'con_diferencia');
$$;

REVOKE EXECUTE ON FUNCTION public.items_sin_ingresar(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.items_sin_ingresar(uuid, integer) TO authenticated, service_role;
