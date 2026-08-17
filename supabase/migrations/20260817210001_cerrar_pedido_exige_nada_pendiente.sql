SET lock_timeout = '5s';

-- Un pedido NO se da por completado mientras a la sala le queden renglones sin
-- contar. La función miraba sólo las diferencias, así que la última que se
-- resolviera cerraba el pedido aunque faltaran hojas enteras — y de ahí no se
-- vuelve: `receive_pedido_sucursal` rechaza todo pedido «completado» y la
-- tarjeta deja de ofrecer la recepción.
--
-- Medido en el pedido 116 de La Popular el 2026-08-17: la devolución de un
-- renglón se cerró a las 14:58 con 138 renglones pendientes —las hojas 2 a 5 y
-- las 8 cajas especiales—. Lo único que evitó el cierre fue que quedaba OTRA
-- diferencia sin resolver; al resolverla, el pedido se habría cerrado y la sala
-- se quedaba encerrada, esta vez también del lado de la base.
--
-- El criterio es el mismo que ya usa `receive_pedido_sucursal` para pasar a
-- «completado»: que no quede ningún renglón en «pendiente».
CREATE OR REPLACE FUNCTION public.cerrar_pedido_si_todo_resuelto(p_pedido_id uuid, p_suc_id integer, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    -- Todavía se está contando: ni se cierra el pedido ni se firma la
    -- corrección de la sala — pueden aparecer diferencias nuevas en las hojas
    -- que faltan.
    IF EXISTS (
        SELECT 1 FROM public.pedido_items
        WHERE  pedido_id = p_pedido_id
          AND  status = 'pendiente'
    ) THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.pedido_items
        WHERE  pedido_id = p_pedido_id
          AND  status = 'con_diferencia'
          AND  (resolucion_status IS NULL OR resolucion_status IN ('propuesta', 'rechazada'))
    ) THEN
        RETURN;
    END IF;

    UPDATE public.pedidos SET status = 'completado' WHERE id = p_pedido_id;
    UPDATE public.pedido_sucursal_status
       SET confirmado_correccion_at  = now(),
           confirmado_correccion_por = p_actor
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_suc_id;
END;
$function$;
