SET lock_timeout = '5s';

-- Dos huecos que aparecieron al preguntarse qué pasa DESPUÉS de cerrar.
--
-- 1. Una diferencia ya cerrada de acuerdo entre las dos partes caía en la misma
--    guarda que una con propuesta en curso, y el aviso decía «ya se está
--    resolviendo» sobre algo que ya se resolvió. El freno es correcto —una
--    cantidad que la otra parte aceptó, y cuyo traslado ya se hizo, no se
--    reescribe por un costado— pero tiene que decir por qué.
--
-- 2. Un problema NUEVO sobre un renglón de un pedido ya cerrado dejaba el acuse
--    viejo en pie: `corregido_bodega_at` y `confirmado_correccion_at` no los
--    limpia nadie, así que al resolverse la diferencia nueva la tarjeta volvía a
--    decir «Cerrado. La sala confirmó que recibió la corrección» con la fecha de
--    la vuelta ANTERIOR. Un acuse viejo firmando una corrección que nadie vio.
--
--    Ahora, en cuanto una corrección crea una diferencia, el cierre de esa sala
--    se borra: bodega tiene que volver a marcar y la sala a confirmar. Es la
--    misma idea que ya tiene el renglón —una diferencia nueva no hereda la firma
--    de la anterior— aplicada al pedido.
CREATE OR REPLACE FUNCTION public.corregir_recepcion_de_item(
    p_item_id  integer,
    p_cantidad integer,
    p_nota     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor   uuid := auth_employee_id();
    v_it      record;
    v_ped     text;
    v_enviado integer;
    v_antes   integer;
    v_error   text;
    v_prob    integer;
    v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
    v_reabre  boolean := false;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT * INTO v_it FROM public.pedido_items WHERE id = p_item_id FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;

    IF v_it.es_extra THEN
        RAISE EXCEPTION 'ES_EXTRA: lo que llegó de más se corrige en su propia pantalla';
    END IF;

    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo corrige la sala que contó el pedido';
    END IF;

    IF v_it.status NOT IN ('recibido', 'con_diferencia') THEN
        RAISE EXCEPTION 'NO_CONTADO: ese producto todavía no se confirmó; se cuenta en su hoja';
    END IF;

    -- Ya cerrada de acuerdo entre las dos partes. No es lo mismo que «en
    -- curso», y decírselo así mandaba a esperar algo que ya pasó.
    IF v_it.resolucion_status = 'confirmada' THEN
        RAISE EXCEPTION 'YA_RESUELTA: esta diferencia ya se cerró de acuerdo entre la sala y bodega, '
                        'y el producto ya se movió. Si apareció un problema nuevo, hay que levantarlo '
                        'con supervisión: no se reescribe la cantidad que las dos partes firmaron';
    END IF;
    IF v_it.resolucion_status IS NOT NULL THEN
        RAISE EXCEPTION 'YA_EN_CURSO: esta diferencia ya se está resolviendo; '
                        'la cantidad es la que aceptó la otra parte';
    END IF;

    IF p_cantidad IS NULL OR p_cantidad < 0 THEN
        RAISE EXCEPTION 'CANTIDAD_INVALIDA: escribí cuántos contaste';
    END IF;

    SELECT status INTO v_ped FROM public.pedidos WHERE id = v_it.pedido_id FOR UPDATE;
    IF v_ped = 'anulado' THEN
        RAISE EXCEPTION 'PEDIDO_ANULADO: no se corrige el conteo de un pedido anulado';
    END IF;

    v_enviado := coalesce(v_it.cantidad_enviada, v_it.cantidad_asignada);
    v_antes   := coalesce(v_it.cantidad_recibida, 0);

    IF p_cantidad = v_antes AND v_nota IS NOT DISTINCT FROM v_it.nota_diferencia THEN
        RETURN jsonb_build_object('cambio', false, 'cantidad', v_antes,
                                  'error_tipo', v_it.error_tipo, 'status', v_it.status);
    END IF;

    v_error := CASE
        WHEN p_cantidad < v_enviado                    THEN 'faltante'
        WHEN p_cantidad > v_enviado                    THEN 'sobrante'
        WHEN v_it.error_tipo IN ('danado', 'vencido')  THEN v_it.error_tipo
        ELSE NULL
    END;
    v_prob := CASE
        WHEN v_error IN ('danado', 'vencido')
            THEN least(coalesce(v_it.cantidad_problema, 1), greatest(p_cantidad, 1))
        ELSE NULL
    END;

    UPDATE public.pedido_items SET
        cantidad_recibida = p_cantidad,
        error_tipo        = v_error,
        cantidad_problema = v_prob,
        nota_diferencia   = v_nota,
        status            = CASE WHEN v_error IS NULL THEN 'recibido' ELSE 'con_diferencia' END
    WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'correccion_conteo',
            format('Contado %s → %s', v_antes, p_cantidad)
              || coalesce(' · ' || v_nota, ''),
            v_actor);

    -- Una diferencia NUEVA reabre el acuse de esa sala. Sin esto, al resolverla
    -- la tarjeta mostraba «Cerrado. La sala confirmó que recibió la corrección»
    -- con la fecha de la vuelta anterior: una firma vieja sobre algo que nadie
    -- vio. Bodega vuelve a marcar y la sala vuelve a confirmar.
    IF v_error IS NOT NULL THEN
        UPDATE public.pedido_sucursal_status
           SET corregido_bodega_at        = NULL,
               corregido_bodega_por       = NULL,
               corregido_bodega_nota      = NULL,
               confirmado_correccion_at   = NULL,
               confirmado_correccion_por  = NULL
         WHERE pedido_id       = v_it.pedido_id
           AND erp_sucursal_id = v_it.erp_sucursal_id
           AND (corregido_bodega_at IS NOT NULL OR confirmado_correccion_at IS NOT NULL);
        v_reabre := FOUND;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.pedido_items WHERE pedido_id = v_it.pedido_id AND status = 'pendiente'
    ) THEN
        IF EXISTS (SELECT 1 FROM public.pedido_items WHERE pedido_id = v_it.pedido_id AND status = 'con_diferencia') THEN
            UPDATE public.pedidos SET status = 'parcial'    WHERE id = v_it.pedido_id AND status <> 'anulado';
        ELSE
            UPDATE public.pedidos SET status = 'completado' WHERE id = v_it.pedido_id AND status <> 'anulado';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM public.pedido_items WHERE pedido_id = v_it.pedido_id AND status = 'con_diferencia') THEN
        UPDATE public.pedidos SET status = 'parcial' WHERE id = v_it.pedido_id AND status <> 'anulado';
    END IF;

    RETURN jsonb_build_object('cambio', true, 'antes', v_antes, 'cantidad', p_cantidad,
                              'enviado', v_enviado, 'error_tipo', v_error,
                              'reabrio_el_cierre', v_reabre,
                              'status', CASE WHEN v_error IS NULL THEN 'recibido' ELSE 'con_diferencia' END);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.corregir_recepcion_de_item(integer, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corregir_recepcion_de_item(integer, integer, text) TO authenticated, service_role;
