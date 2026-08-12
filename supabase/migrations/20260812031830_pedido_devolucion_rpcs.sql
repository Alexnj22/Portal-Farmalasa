SET lock_timeout = '5s';

-- ── El cierre del pedido, en UN solo lugar ──────────────────────────────────
-- `resolve_pedido_item` lo tenía adentro de su rama de «confirmar». Ahora la
-- devolución también cierra renglones —cuando el movimiento entra en Bodega—, y
-- dos copias de esta condición se separan el día que alguien toque una: un
-- pedido que no cierra es una tarjeta que se queda para siempre en la pantalla
-- de todos.
CREATE OR REPLACE FUNCTION public.cerrar_pedido_si_todo_resuelto(
    p_pedido_id uuid,
    p_suc_id    integer,
    p_actor     uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
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
$$;

REVOKE EXECUTE ON FUNCTION public.cerrar_pedido_si_todo_resuelto(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cerrar_pedido_si_todo_resuelto(uuid, integer, uuid) TO authenticated, service_role;


-- ── La sala pide la devolución ──────────────────────────────────────────────
--
-- Sólo la PIDE: acá no se mueve nada. El movimiento lo hace la edge function
-- cuando Bodega acepta, porque nada se mueve sin que las dos partes coincidan —
-- un traslado sin acuerdo es peor que una diferencia anotada: después hay que
-- ir a buscar mercadería.
CREATE OR REPLACE FUNCTION public.solicitar_devolucion_pedido(
    p_pedido_item_id integer,
    p_motivo         text,
    p_cantidad       integer,
    p_nota           text  DEFAULT NULL,
    p_evidencia      jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor  uuid := auth_employee_id();
    v_it     record;
    v_numero integer;
    v_max    integer;
    v_id     uuid;
    v_clave  text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    IF p_motivo IS NULL OR p_motivo NOT IN ('faltante', 'danado', 'vencido') THEN
        RAISE EXCEPTION 'MOTIVO_INVALIDO: %', coalesce(p_motivo, '(vacío)');
    END IF;

    SELECT pi.id, pi.pedido_id, pi.erp_sucursal_id, pi.erp_product_id, pi.status,
           pi.cantidad_asignada, pi.cantidad_enviada, pi.cantidad_recibida
      INTO v_it
      FROM public.pedido_items pi
     WHERE pi.id = p_pedido_item_id
       FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;

    -- La devolución la pide la sala que recibió. Es la que contó la caja y la
    -- única que sabe qué no llegó; y sobre todo, es de donde va a salir el
    -- producto. Alcance ALL (supervisión) puede hacerlo por ella.
    IF NOT auth_can_edit_scope_all(ARRAY['pedidos'])
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'SALA_AJENA: la devolución la pide la sala que recibió el pedido';
    END IF;

    IF v_it.status <> 'con_diferencia' THEN
        RAISE EXCEPTION 'SIN_DIFERENCIA: este renglón no quedó con diferencia al recibirlo';
    END IF;

    -- El daño se muestra. Sin foto, Bodega tendría que decidir a ciegas si
    -- amerita la devolución o si el producto todavía se puede vender.
    IF p_motivo = 'danado' AND coalesce(jsonb_array_length(p_evidencia), 0) = 0 THEN
        RAISE EXCEPTION 'FOTO_REQUERIDA: el daño se muestra con una foto, para que Bodega decida '
                        'si amerita la devolución o si el producto todavía se puede vender';
    END IF;

    -- El tope depende del motivo, y son dos cosas distintas:
    --   faltante → lo que NO llegó (se envió 30, se contaron 28 → 2)
    --   dañado/vencido → sale de lo que SÍ llegó, así que el tope es lo contado
    v_max := CASE
        WHEN p_motivo = 'faltante'
        THEN coalesce(v_it.cantidad_enviada, v_it.cantidad_asignada) - coalesce(v_it.cantidad_recibida, 0)
        ELSE coalesce(v_it.cantidad_recibida, 0)
    END;
    IF p_cantidad IS NULL OR p_cantidad <= 0 OR p_cantidad > v_max THEN
        RAISE EXCEPTION 'CANTIDAD_FUERA_DE_RANGO: por % se puede devolver hasta % (se pidió %)',
                        p_motivo, v_max, coalesce(p_cantidad, 0);
    END IF;

    SELECT numero INTO v_numero FROM public.pedidos WHERE id = v_it.pedido_id;

    -- Misma forma que la clave del despacho (`planificar_traslado_pedido`), con
    -- DEV adelante: quien la busque en el sistema reconoce las dos de una mirada.
    v_clave := 'DEV-P' || coalesce(v_numero::text, '0')
            || '-S' || v_it.erp_sucursal_id
            || '-I' || v_it.id;

    INSERT INTO public.pedido_devolucion (
        pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id,
        motivo, viaja, cantidad, nota, evidencia_urls,
        estado, solicitada_por, clave
    ) VALUES (
        v_it.pedido_id, v_it.erp_sucursal_id, v_it.id, v_it.erp_product_id,
        p_motivo, p_motivo <> 'faltante', p_cantidad,
        nullif(btrim(coalesce(p_nota, '')), ''), coalesce(p_evidencia, '[]'::jsonb),
        'solicitada', v_actor, v_clave
    )
    RETURNING id INTO v_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES
        (v_it.id, v_it.pedido_id, v_it.erp_sucursal_id, 'devolucion_solicitada',
         'devolver_bodega', nullif(btrim(coalesce(p_nota, '')), ''), v_actor);

    RETURN jsonb_build_object('id', v_id, 'clave', v_clave, 'viaja', p_motivo <> 'faltante');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.solicitar_devolucion_pedido(integer, text, integer, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.solicitar_devolucion_pedido(integer, text, integer, text, jsonb) TO authenticated, service_role;


-- ── Bodega decide ───────────────────────────────────────────────────────────
--
-- Aceptar NO mueve nada todavía: deja la fila lista para que la edge function
-- arme el movimiento. Se separan a propósito — decidir es una escritura del
-- portal y siempre entra; mover es una conversación con el sistema de origen,
-- que puede fallar, tardar o estar pausado.
CREATE OR REPLACE FUNCTION public.decidir_devolucion_pedido(
    p_id     uuid,
    p_accion text,
    p_nota   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor uuid := auth_employee_id();
    v_dev   record;
    v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    IF p_accion NOT IN ('aceptar', 'rechazar') THEN
        RAISE EXCEPTION 'ACCION_INVALIDA: %', p_accion;
    END IF;

    -- La devolución entra a Bodega, así que la decide Bodega. Es la misma regla
    -- que en el traslado entre salas: decide quien va a recibir el producto.
    IF NOT auth_can_edit_scope_all(ARRAY['pedidos'])
       AND NOT EXISTS (
            SELECT 1 FROM public.erp_sucursal_map m
            WHERE m.es_bodega AND m.erp_sucursal_id = auth_employee_erp_sucursal_id()
       ) THEN
        RAISE EXCEPTION 'SOLO_BODEGA: la devolución la decide quien va a recibir el producto';
    END IF;

    SELECT * INTO v_dev FROM public.pedido_devolucion WHERE id = p_id FOR UPDATE;
    IF v_dev.id IS NULL THEN
        RAISE EXCEPTION 'DEVOLUCION_NO_EXISTE';
    END IF;
    IF v_dev.estado <> 'solicitada' THEN
        RAISE EXCEPTION 'YA_DECIDIDA: esta devolución está %', v_dev.estado;
    END IF;

    IF p_accion = 'rechazar' AND v_nota IS NULL THEN
        RAISE EXCEPTION 'MOTIVO_REQUERIDO: un rechazo sin motivo deja a la sala sin saber qué hacer';
    END IF;

    UPDATE public.pedido_devolucion
       SET estado         = CASE WHEN p_accion = 'aceptar' THEN 'aceptada' ELSE 'rechazada' END,
           decidida_por   = v_actor,
           decidida_at    = now(),
           decision_nota  = CASE WHEN p_accion = 'aceptar' THEN v_nota ELSE decision_nota END,
           motivo_rechazo = CASE WHEN p_accion = 'rechazar' THEN v_nota ELSE motivo_rechazo END,
           updated_at     = now()
     WHERE id = p_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES
        (v_dev.pedido_item_id, v_dev.pedido_id, v_dev.erp_sucursal_id,
         CASE WHEN p_accion = 'aceptar' THEN 'devolucion_aceptada' ELSE 'devolucion_rechazada' END,
         'devolver_bodega', v_nota, v_actor);

    RETURN jsonb_build_object('id', p_id, 'estado',
        CASE WHEN p_accion = 'aceptar' THEN 'aceptada' ELSE 'rechazada' END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decidir_devolucion_pedido(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.decidir_devolucion_pedido(uuid, text, text) TO authenticated, service_role;


-- ── El renglón se cierra cuando el producto ENTRÓ en Bodega ─────────────────
--
-- No cuando la sala lo pide ni cuando Bodega acepta: cuando el movimiento
-- existe en el sistema y alguien lo recibió del otro lado. Antes de eso el
-- producto está en tránsito —fuera de la sala y todavía no en Bodega—, que es
-- el estado que esta pieza entera existe para evitar.
--
-- La llama la edge function con la llave de servicio, después de que el sistema
-- aceptó la recepción. Por eso recibe el actor por parámetro: quien recibe ya
-- salió de su JWT allá, y acá no hay sesión de usuario que consultar.
CREATE OR REPLACE FUNCTION public.cerrar_item_por_devolucion(
    p_devolucion_id uuid,
    p_actor         uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_dev record;
BEGIN
    SELECT * INTO v_dev FROM public.pedido_devolucion WHERE id = p_devolucion_id;
    IF v_dev.id IS NULL OR v_dev.estado <> 'recibida' THEN
        RETURN;   -- sin movimiento recibido no se cierra nada
    END IF;

    UPDATE public.pedido_items SET
        resolucion_status  = 'confirmada',
        resolucion_tipo    = 'devolver_bodega',
        resolucion_nota    = coalesce(resolucion_nota, v_dev.nota),
        resuelto_por       = v_dev.solicitada_por,
        resuelto_at        = v_dev.solicitada_at,
        confirmado_suc_por = p_actor,
        confirmado_suc_at  = now()
    WHERE id = v_dev.pedido_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES
        (v_dev.pedido_item_id, v_dev.pedido_id, v_dev.erp_sucursal_id,
         'devolucion_recibida', 'devolver_bodega',
         'Entró en Bodega — ' || v_dev.clave, p_actor);

    PERFORM public.cerrar_pedido_si_todo_resuelto(v_dev.pedido_id, v_dev.erp_sucursal_id, p_actor);
END;
$$;

-- Sólo la edge function. Un `authenticated` que pudiera llamarla cerraría un
-- renglón sin que el producto se haya movido.
REVOKE EXECUTE ON FUNCTION public.cerrar_item_por_devolucion(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cerrar_item_por_devolucion(uuid, uuid) TO service_role;
