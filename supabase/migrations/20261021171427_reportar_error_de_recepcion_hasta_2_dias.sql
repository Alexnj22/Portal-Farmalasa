-- Reportar un error de la recepción hasta 2 días después de cerrarla.
--
-- Pedido 07-201026-2-S1 (Salud 1, 21-oct-2026): bodega registró en el sistema
-- LUBRIDERM REPARACIÓN INTENSIVA 400 ML y en la caja iba HUMECTACIÓN DIARIA
-- 400 ML. La sala recibió la Reparación como llegada y anotó el sobrante con
-- la presentación equivocada (200 ML). Las tres puertas que podían corregirlo
-- estaban cerradas: la pantalla de recepción desaparece al cerrarla,
-- `quitar_extra_de_pedido` no deja retirar un extra con propuesta, y el
-- renglón recibido no tenía cómo reabrirse desde la tarjeta.
--
-- Regla del usuario: «permite 2 días después de aceptar. que quede registrado
-- y todo». El plazo vive acá —un solo juez, `recepcion_corregible`— y no en la
-- pantalla, que sólo lo pregunta para decidir si muestra el botón.
--
-- Las tres funciones parten de su definición VIVA del 2026-10-21.
SET lock_timeout = '5s';

-- ── El juez del plazo ────────────────────────────────────────────────────────
-- Corre desde que la sala cerró la recepción (`recibido_erp_at`). Mientras no
-- la cerró, se está contando y todo es corregible. Supervisión no tiene plazo:
-- es la que destraba lo que nadie vio a tiempo.
CREATE OR REPLACE FUNCTION public.recepcion_corregible(p_pedido_id uuid, p_sucursal_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    RETURN coalesce((
        SELECT s.recibido_erp_at IS NULL
            OR s.recibido_erp_at > now() - interval '2 days'
          FROM public.pedido_sucursal_status s
         WHERE s.pedido_id = p_pedido_id AND s.erp_sucursal_id = p_sucursal_id
    ), true) OR public.auth_es_supervision();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.recepcion_corregible(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recepcion_corregible(uuid, integer) TO authenticated, service_role;

-- Una diferencia nacida DESPUÉS de cerrar la recepción tiene que aparecer en
-- la tarjeta: `DifSection` sólo se pinta con `diferencias_reportadas_at`, y
-- un pedido que cerró limpio no lo tiene. Y el pedido vuelve a `parcial`.
CREATE OR REPLACE FUNCTION public.reabrir_diferencias_de_sala(p_pedido_id uuid, p_sucursal_id integer, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    UPDATE public.pedido_sucursal_status
       SET diferencias_reportadas_at  = coalesce(diferencias_reportadas_at, now()),
           diferencias_reportadas_por = coalesce(diferencias_reportadas_por, p_actor),
           corregido_bodega_at        = NULL,
           corregido_bodega_por       = NULL,
           corregido_bodega_nota      = NULL,
           confirmado_correccion_at   = NULL,
           confirmado_correccion_por  = NULL
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
       AND recibido_erp_at IS NOT NULL;

    UPDATE public.pedidos SET status = 'parcial'
     WHERE id = p_pedido_id AND status = 'completado';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reabrir_diferencias_de_sala(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reabrir_diferencias_de_sala(uuid, integer, uuid) TO service_role;

-- ── Corregir lo contado ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.corregir_recepcion_de_item(p_item_id integer, p_cantidad integer, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
    v_cerrada boolean;
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

    IF NOT public.recepcion_corregible(v_it.pedido_id, v_it.erp_sucursal_id) THEN
        RAISE EXCEPTION 'PLAZO_VENCIDO: un error de la recepción se reporta hasta 2 días después '
                        'de cerrarla. Pasado ese plazo lo levanta supervisión';
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

    -- Con la recepción ya cerrada, el motivo es obligatorio: es lo único que
    -- explica después por qué cambió un número que alguien ya había firmado.
    SELECT recibido_erp_at IS NOT NULL INTO v_cerrada
      FROM public.pedido_sucursal_status
     WHERE pedido_id = v_it.pedido_id AND erp_sucursal_id = v_it.erp_sucursal_id;
    IF coalesce(v_cerrada, false) AND v_nota IS NULL THEN
        RAISE EXCEPTION 'MOTIVO_REQUERIDO: la recepción ya se cerró; escribí qué pasó';
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
              || CASE WHEN coalesce(v_cerrada, false) THEN ' · después de cerrar la recepción' ELSE '' END
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
        -- Y si la recepción ya cerró, la diferencia tiene que verse.
        PERFORM public.reabrir_diferencias_de_sala(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);
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

-- ── Anotar lo que llegó de más ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agregar_extra_a_pedido(p_pedido_id uuid, p_sucursal_id integer, p_erp_product_id integer, p_cantidad integer, p_factor integer DEFAULT 1, p_tipo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := auth_employee_id();
    v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
    v_id    integer;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    -- Lo anota la sala que está contando. Con alcance ALL también supervisión,
    -- que es la que destraba cuando la sala no está.
    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM p_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo que llegó de más lo anota la sala que recibe el pedido';
    END IF;

    IF coalesce(p_cantidad, 0) <= 0 THEN
        RAISE EXCEPTION 'CANTIDAD_EN_CERO: escribe cuántos llegaron';
    END IF;
    IF coalesce(p_factor, 0) <= 0 THEN
        RAISE EXCEPTION 'SIN_PRESENTACION: la presentación no trae su factor';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pedidos WHERE id = p_pedido_id) THEN
        RAISE EXCEPTION 'PEDIDO_NO_EXISTE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_erp_product_id) THEN
        RAISE EXCEPTION 'PRODUCTO_NO_EXISTE';
    END IF;

    IF NOT public.recepcion_corregible(p_pedido_id, p_sucursal_id) THEN
        RAISE EXCEPTION 'PLAZO_VENCIDO: un error de la recepción se reporta hasta 2 días después '
                        'de cerrarla. Pasado ese plazo lo levanta supervisión';
    END IF;

    -- Si el producto SÍ venía en el pedido no es un extra, es un sobrante de su
    -- propio renglón: anotarlo aparte lo contaría dos veces y dejaría dos
    -- diferencias del mismo producto conversándose por separado.
    IF EXISTS (SELECT 1 FROM public.pedido_items pi
                WHERE pi.pedido_id       = p_pedido_id
                  AND pi.erp_sucursal_id = p_sucursal_id
                  AND pi.erp_product_id  = p_erp_product_id
                  AND NOT pi.es_extra) THEN
        RAISE EXCEPTION 'YA_VENIA_EN_EL_PEDIDO: ese producto tiene su propio renglón; '
                        'escribí ahí la cantidad que contaste';
    END IF;
    IF EXISTS (SELECT 1 FROM public.pedido_items pi
                WHERE pi.pedido_id       = p_pedido_id
                  AND pi.erp_sucursal_id = p_sucursal_id
                  AND pi.erp_product_id  = p_erp_product_id
                  AND pi.es_extra
                  AND pi.status <> 'anulado') THEN
        RAISE EXCEPTION 'YA_ANOTADO: ese producto ya está anotado como llegado de más';
    END IF;

    INSERT INTO public.pedido_items (
        pedido_id, erp_sucursal_id, erp_product_id,
        cantidad_asignada, cantidad_enviada, cantidad_recibida,
        factor, dispatch_factor, dispatch_tipo,
        status, error_tipo, es_extra,
        received_at, received_by, nota_diferencia
    ) VALUES (
        p_pedido_id, p_sucursal_id, p_erp_product_id,
        0, 0, p_cantidad,
        p_factor, p_factor, nullif(btrim(coalesce(p_tipo, '')), ''),
        'con_diferencia', 'sobrante', true,
        now(), v_actor, v_nota
    ) RETURNING id INTO v_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
    VALUES (v_id, p_pedido_id, p_sucursal_id, 'extra_anotado', v_nota, v_actor);

    -- Anotado con la recepción ya cerrada: que se vea en la tarjeta.
    PERFORM public.reabrir_diferencias_de_sala(p_pedido_id, p_sucursal_id, v_actor);

    RETURN v_id;
END;
$function$;

-- ── Quitar lo que se anotó mal ───────────────────────────────────────────────
-- Ahora también con la propuesta de la sala EN CURSO, mientras nadie la
-- contestó: todavía no se movió nada y nadie aceptó una cantidad. Antes el
-- extra mal anotado quedaba trabado: no se podía quitar «porque ya se está
-- resolviendo», y lo único que había para apretar era aceptar el error.
CREATE OR REPLACE FUNCTION public.quitar_extra_de_pedido(p_item_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := auth_employee_id();
    v_it    record;
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
    IF NOT v_it.es_extra THEN
        RAISE EXCEPTION 'NO_ES_EXTRA: ese renglón venía en el pedido y no se puede quitar';
    END IF;
    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo quita la sala que lo anotó';
    END IF;
    IF v_it.status = 'anulado' THEN
        RETURN;   -- ya estaba quitado: dos clics no son dos eventos
    END IF;
    IF v_it.resolucion_status IS NOT NULL AND v_it.resolucion_status <> 'propuesta' THEN
        RAISE EXCEPTION 'YA_EN_CURSO: bodega ya contestó esta diferencia; '
                        'no se puede quitar sin dejar rastro';
    END IF;
    IF NOT public.recepcion_corregible(v_it.pedido_id, v_it.erp_sucursal_id) THEN
        RAISE EXCEPTION 'PLAZO_VENCIDO: un error de la recepción se reporta hasta 2 días después '
                        'de cerrarla. Pasado ese plazo lo levanta supervisión';
    END IF;

    UPDATE public.pedido_items
       SET status              = 'anulado',
           error_tipo          = NULL,
           resolucion_status   = NULL,
           resolucion_tipo     = NULL,
           resolucion_nota     = NULL,
           resolucion_vence_at = NULL
     WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'extra_quitado',
            v_it.resolucion_tipo,
            CASE WHEN v_it.resolucion_status IS NOT NULL
                 THEN 'Se quitó con su propuesta sin contestar' END,
            v_actor);

    -- Con la recepción ya cerrada, si era lo último abierto de la sala el
    -- pedido se cierra acá. Mientras se cuenta, lo cierra la recepción.
    IF EXISTS (SELECT 1 FROM public.pedido_sucursal_status
                WHERE pedido_id = v_it.pedido_id AND erp_sucursal_id = v_it.erp_sucursal_id
                  AND recibido_erp_at IS NOT NULL) THEN
        PERFORM public.cerrar_pedido_si_todo_resuelto(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);
    END IF;
END;
$function$;
