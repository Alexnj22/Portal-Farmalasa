SET lock_timeout = '5s';

-- ── El freno también para la devolución ─────────────────────────────────────
-- La devolución mueve inventario real, así que necesita su propio interruptor.
-- Y son DOS por el mismo motivo que el traslado: pausar la salida y la entrada a
-- la vez deja varado lo que ya salió de la sala y todavía no entró en Bodega.
-- Ante un problema se pausa la salida y se deja abierta la entrada, para poder
-- cerrar lo que está en camino.
ALTER TABLE public.traslado_interruptor
    DROP CONSTRAINT IF EXISTS traslado_interruptor_accion_check;

ALTER TABLE public.traslado_interruptor
    ADD CONSTRAINT traslado_interruptor_accion_check
    CHECK (accion IN ('enviar', 'recibir', 'devolver_enviar', 'devolver_recibir'));

INSERT INTO public.traslado_interruptor (accion, pausado)
VALUES ('devolver_enviar', false), ('devolver_recibir', false)
ON CONFLICT (accion) DO NOTHING;

-- La lista vive en dos lugares —el CHECK y esta función— y las dos tienen que
-- decir lo mismo: una acción que el CHECK acepta y la función no es un
-- interruptor que existe y no se puede mover.
--
-- Idéntica a la de `20260812021730` salvo esa lista. La autoría sigue saliendo
-- de `auth_employee_id()`: `employees.user_id` no existe, y volver a la versión
-- anterior dejaría el interruptor otra vez inmovible.
CREATE OR REPLACE FUNCTION public.set_traslado_interruptor(
    p_accion  text,
    p_pausado boolean,
    p_motivo  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_accion NOT IN ('enviar', 'recibir', 'devolver_enviar', 'devolver_recibir') THEN
        RAISE EXCEPTION 'ACCION_INVALIDA';
    END IF;

    IF NOT (SELECT auth_has_module_permission('pedidos', 'can_edit')) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    UPDATE public.traslado_interruptor
       SET pausado      = p_pausado,
           motivo       = nullif(btrim(coalesce(p_motivo, '')), ''),
           cambiado_por = (SELECT auth_employee_id()),
           cambiado_at  = now()
     WHERE accion = p_accion;

    RETURN jsonb_build_object('accion', p_accion, 'pausado', p_pausado);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_traslado_interruptor(text, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_traslado_interruptor(text, boolean, text) TO authenticated, service_role;


-- ── Y el cierre del pedido pasa a ser uno solo ──────────────────────────────
-- Idéntica a la anterior salvo el final de la rama «confirmar», que ahora llama
-- a `cerrar_pedido_si_todo_resuelto` en vez de repetir la condición. La
-- devolución cierra renglones por otro camino y las dos copias se habrían
-- separado en el primer cambio.
--
-- Los tres últimos parámetros conservan su DEFAULT: quitarlos no es un cambio
-- de cuerpo sino de firma, y Postgres lo rechaza de plano.
CREATE OR REPLACE FUNCTION public.resolve_pedido_item(
    p_item_id integer,
    p_action  text,
    p_user_id uuid DEFAULT NULL,
    p_tipo    text DEFAULT NULL,
    p_nota    text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_pedido_id UUID;
    v_suc_id    INTEGER;
    v_cur_res   TEXT;
    v_actor     uuid := auth_employee_id();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT pedido_id, erp_sucursal_id, resolucion_status
    INTO   v_pedido_id, v_suc_id, v_cur_res
    FROM   pedido_items WHERE id = p_item_id FOR UPDATE;

    IF v_pedido_id IS NULL THEN
        RAISE EXCEPTION 'Item no encontrado.';
    END IF;

    IF p_action = 'proponer' THEN
        UPDATE pedido_items SET
            resolucion_status  = 'propuesta',
            resolucion_tipo    = p_tipo,
            resolucion_nota    = NULLIF(TRIM(COALESCE(p_nota, '')), ''),
            resuelto_por       = v_actor,
            resuelto_at        = NOW(),
            rechazado_por      = NULL,
            rechazado_at       = NULL,
            nota_rechazo       = NULL,
            confirmado_suc_por = NULL,
            confirmado_suc_at  = NULL
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_propuesta',
             p_tipo, NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

    ELSIF p_action = 'confirmar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede confirmar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status  = 'confirmada',
            confirmado_suc_por = v_actor,
            confirmado_suc_at  = NOW()
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_confirmada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

        PERFORM public.cerrar_pedido_si_todo_resuelto(v_pedido_id, v_suc_id, v_actor);

    ELSIF p_action = 'rechazar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede rechazar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status = 'rechazada',
            rechazado_por     = v_actor,
            rechazado_at      = NOW(),
            nota_rechazo      = NULLIF(TRIM(COALESCE(p_nota, '')), '')
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_rechazada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

    ELSE
        RAISE EXCEPTION 'Acción desconocida: %', p_action;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_pedido_item(integer, text, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolve_pedido_item(integer, text, uuid, text, text) TO authenticated, service_role;
