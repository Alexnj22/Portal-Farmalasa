SET lock_timeout = '5s';

-- El carrito de la app (2026-10-07): varios productos del catálogo que se
-- reservan JUNTOS para retirar en una sucursal. Cada producto es una fila de
-- `app_reservas` (así la sucursal las prepara y la caja las cobra igual que
-- hoy) y todas comparten `pedido`: el tope de 3 reservas activas cuenta un
-- pedido como UNA.
ALTER TABLE public.app_reservas ADD COLUMN pedido text CHECK (pedido IS NULL OR pedido ~ '^P-[A-Z0-9]{6}$');
CREATE INDEX app_reservas_pedido_idx ON public.app_reservas (pedido) WHERE pedido IS NOT NULL;

-- Dónde hay de cada producto del carrito, por sucursal: para elegir la sala
-- que tiene todo. Lo lee sólo `app-clientes`.
CREATE FUNCTION public.app_carrito_existencias(p_ids integer[])
RETURNS json LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(json_build_object('product_id', s.product_id, 'branch_id', s.branch_id, 'cantidad', s.cant)), '[]'::json)
    FROM (SELECT i.erp_product_id AS product_id, m.branch_id, sum(i.cantidad) AS cant
            FROM public.inventory i
            JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
           WHERE i.erp_product_id = ANY (p_ids) AND NOT coalesce(i.is_vencidos, false)
           GROUP BY 1, 2 HAVING sum(i.cantidad) > 0) s;
$$;
REVOKE EXECUTE ON FUNCTION public.app_carrito_existencias(integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_carrito_existencias(integer[]) TO service_role;
