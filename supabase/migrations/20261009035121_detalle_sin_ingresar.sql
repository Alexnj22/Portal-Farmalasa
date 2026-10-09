SET lock_timeout = '5s';
-- Qué renglón no entró al inventario de la sala y POR QUÉ (2026-10-09).
--
-- `resumen_ingreso_pedidos` sólo cuenta: la tarjeta decía «1 sin ingresar» —y
-- cerrada, ni eso— sin nombrar el producto ni el motivo. #135 (Salud 4) y #136
-- (Salud 5) llevaban desde el 24-ago a la vista sin que nadie supiera que era
-- MEDIBRIZ X 2 TABLETAS rechazado por existencia de bodega.
--
-- Mismo criterio que `sin_ingresar` en el resumen: contado en el portal
-- (`recibido`/`con_diferencia`) y su línea de traslado no 'recibida'. Así la
-- lista y el número no pueden contestar distinto.
--
-- `plpgsql` y no `LANGUAGE sql` + SET (trampa 4 de CLAUDE.md). Devuelve `json`
-- (Patrón C): sin techo de 1000 filas.
CREATE OR REPLACE FUNCTION public.detalle_sin_ingresar(p_pedido_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(json_build_object(
             'pedido_id',       l.pedido_id,
             'erp_sucursal_id', l.erp_sucursal_id,
             'pedido_item_id',  l.pedido_item_id,
             'producto',        coalesce(pr.nombre, 'Producto ' || l.erp_product_id),
             'cantidad',        l.cantidad,
             'estado',          l.estado,
             'motivo',          l.error_msg,
             'desde',           l.updated_at
           ) ORDER BY l.pedido_id, l.erp_sucursal_id, pr.nombre), '[]'::json)
      FROM public.pedido_traslado_linea l
      JOIN public.pedido_items pi ON pi.id = l.pedido_item_id
                                 AND pi.status IN ('recibido', 'con_diferencia')
      LEFT JOIN public.products pr ON pr.id = l.erp_product_id
     WHERE l.pedido_id = ANY (p_pedido_ids)
       AND l.estado <> 'recibida'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.detalle_sin_ingresar(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.detalle_sin_ingresar(uuid[]) TO authenticated, service_role;
