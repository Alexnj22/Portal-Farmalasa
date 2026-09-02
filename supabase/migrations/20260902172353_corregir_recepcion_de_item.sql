SET lock_timeout = '5s';

-- Corregir lo contado de un producto YA confirmado.
--
-- Existía el hueco al revés: `receive_pedido_sucursal` sólo toca renglones
-- `pendiente` —y está bien, es lo que impide contar dos veces el mismo
-- producto—, así que una vez confirmado el renglón no se puede volver a
-- escribir. Y anotarlo como extra tampoco: `agregar_extra_a_pedido` lo rechaza
-- con «ese producto tiene su propio renglón; escribí ahí la cantidad que
-- contaste», que era un consejo imposible de seguir.
--
-- Medido el 2026-09-02 en Salud 5, pedido #150: SECUFEM salió con 1 en el
-- sistema y venían 3 en la caja. La sala confirmó 1 —lo que decía la hoja— y
-- las otras 2 se quedaron sin poder entrar a ninguna pantalla.
--
-- Lo que esta función NO hace es mover existencias. La corrección deja el
-- renglón `con_diferencia` y de ahí lo toma la conversación que ya existe
-- (`decidir_diferencia_pedido`): la sala propone, bodega contesta, y el
-- traslado de la cantidad de más lo emite ese acuerdo. Corregir en la pantalla
-- de una sala no puede bajarle la existencia a bodega sin que bodega se entere.
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

    -- Un extra tiene su propia pantalla y su propia función: acá se corrige lo
    -- que vino EN el pedido.
    IF v_it.es_extra THEN
        RAISE EXCEPTION 'ES_EXTRA: lo que llegó de más se corrige en su propia pantalla';
    END IF;

    -- La corrige la sala que contó. Con alcance ALL también supervisión, que es
    -- la que destraba cuando la sala no está.
    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo corrige la sala que contó el pedido';
    END IF;

    IF v_it.status NOT IN ('recibido', 'con_diferencia') THEN
        RAISE EXCEPTION 'NO_CONTADO: ese producto todavía no se confirmó; se cuenta en su hoja';
    END IF;

    -- Mismo freno que el extra: con una propuesta en curso la cantidad es la
    -- que aceptó la otra parte y no se reescribe por un costado.
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

    -- Dos clics no son dos correcciones.
    IF p_cantidad = v_antes AND v_nota IS NOT DISTINCT FROM v_it.nota_diferencia THEN
        RETURN jsonb_build_object('cambio', false, 'cantidad', v_antes,
                                  'error_tipo', v_it.error_tipo, 'status', v_it.status);
    END IF;

    -- La corrección es de CUÁNTOS llegaron. Un daño o un vencimiento ya
    -- anotados sobreviven: son otra cosa, y borrarlos acá los perdería sin que
    -- nadie lo pida. Sólo se recorta la cantidad con problema si ya no cabe.
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

    -- `received_by` NO se pisa: sigue siendo quien contó. Quién corrigió y de
    -- cuánto a cuánto vive en el evento, que es donde se puede leer entero.
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

    -- El estado del pedido, con la misma regla que `receive_pedido_sucursal` —
    -- una corrección puede devolver a «parcial» un pedido que ya se daba por
    -- completado, que es justo el caso de quien nota el error al terminar.
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
                              'status', CASE WHEN v_error IS NULL THEN 'recibido' ELSE 'con_diferencia' END);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.corregir_recepcion_de_item(integer, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corregir_recepcion_de_item(integer, integer, text) TO authenticated, service_role;
