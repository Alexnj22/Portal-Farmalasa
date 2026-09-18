SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- «No reenviar»: bodega decide que una caja especial que no llegó ya no se
-- manda (2026-09-17, pedido del usuario a partir del #178 de Salud 4).
--
-- Hasta hoy una caja que la sala reportaba como no llegada tenía UNA salida:
-- reenviarla. Si bodega ya no la iba a mandar, el pendiente quedaba abierto
-- para siempre, y el producto seguía en el sistema como un traslado que salió
-- de Bodega y nunca entró a la sala — fuera de los dos lados.
--
-- Decisiones del usuario:
--   · Sólo para producto SUELTO (cajas especiales: una caja, un producto). Una
--     caja numerada lleva muchos y se sigue reenviando entera.
--   · Si salió traslado, el traslado se ANULA y el producto regresa a Bodega.
--     Lo dice el propio sistema en su confirmación: «El traslado solo será
--     anulado y el stock del producto regresará al local de origen».
--   · Si no salió (se despachó en 0), no hay nada que regresar: sólo se cierra.
--
-- La anulación la hace `no-reenviar-pedido-erp`; esta función sólo cierra en el
-- portal, y se niega mientras quede un traslado vivo de esos renglones. El orden
-- es ése a propósito: primero el sistema, después el portal. Al revés, un fallo
-- a mitad dejaría el pendiente cerrado y el producto todavía en tránsito.
-- ─────────────────────────────────────────────────────────────────────────────

-- `anulando` es el candado, igual que `enviando`/`recibiendo`: dos personas de
-- bodega apretando «No reenviar» a la vez no pueden anular dos veces.
ALTER TABLE public.pedido_traslado_linea DROP CONSTRAINT IF EXISTS pedido_traslado_linea_estado_check;
ALTER TABLE public.pedido_traslado_linea ADD CONSTRAINT pedido_traslado_linea_estado_check
    CHECK (estado IN ('planificada', 'enviando', 'enviada', 'recibiendo', 'recibida', 'error', 'omitida',
                      'anulando', 'anulada'));

-- El freno, como los otros seis. Nace ABIERTO: el usuario pidió la función y la
-- anulación la ofrece el mismo sistema desde su menú; lo que no está probado es
-- que la llame el portal, y la función verifica antes y después.
ALTER TABLE public.traslado_interruptor DROP CONSTRAINT IF EXISTS traslado_interruptor_accion_check;
ALTER TABLE public.traslado_interruptor ADD CONSTRAINT traslado_interruptor_accion_check
    CHECK (accion IN ('enviar', 'recibir', 'devolver_enviar', 'devolver_recibir',
                      'sobrante_enviar', 'sobrante_recibir', 'anular'));
INSERT INTO public.traslado_interruptor (accion, pausado, motivo)
VALUES ('anular', false,
        'Abierto el 2026-09-17 con «No reenviar» de Pedidos: anula el traslado de una caja especial que no llegó y el sistema devuelve el producto a Bodega.')
ON CONFLICT (accion) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cerrar_no_reenviadas(
    p_pedido_id uuid,
    p_suc_id    integer,
    p_labels    text[],
    p_actor     uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_especiales jsonb;
    v_llegadas   jsonb;
    v_items      integer[];
    v_label      text;
    v_n          integer;
BEGIN
    IF p_labels IS NULL OR cardinality(p_labels) = 0 THEN
        RAISE EXCEPTION 'SIN_CAJAS: no se dijo qué caja no se reenvía';
    END IF;

    SELECT CASE WHEN jsonb_typeof(cajas_especiales) = 'array' THEN cajas_especiales ELSE '[]'::jsonb END,
           CASE WHEN jsonb_typeof(cajas_especiales_llegadas) = 'object' THEN cajas_especiales_llegadas ELSE '{}'::jsonb END
      INTO v_especiales, v_llegadas
      FROM public.pedido_sucursal_status
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_suc_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_EXISTE: la sala no tiene este pedido';
    END IF;

    -- Sólo lo que la sala reportó como no llegado.
    FOREACH v_label IN ARRAY p_labels LOOP
        IF v_llegadas ->> v_label IS DISTINCT FROM 'faltante' THEN
            RAISE EXCEPTION 'NO_FALTA: la caja % no figura como no llegada', v_label;
        END IF;
    END LOOP;

    SELECT array_agg(DISTINCT (x ->> 'pedido_item_id')::integer)
      INTO v_items
      FROM jsonb_array_elements(v_especiales) x
     WHERE x ->> 'label' = ANY (p_labels);
    IF v_items IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_labels) l
         WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_especiales) x WHERE x ->> 'label' = l)
    ) THEN
        RAISE EXCEPTION 'SIN_RENGLON: una de esas cajas no está en la lista del despacho';
    END IF;

    -- El renglón ENTERO. Un producto que viajó en dos cajas va en un solo
    -- traslado: si una de sus cajas sí llegó, anularlo regresaría también la que
    -- la sala tiene en la mano.
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_especiales) x
         WHERE (x ->> 'pedido_item_id')::integer = ANY (v_items)
           AND NOT (x ->> 'label' = ANY (p_labels))
    ) THEN
        RAISE EXCEPTION 'PARCIAL: parte de ese producto sí llegó';
    END IF;

    -- Nada puede quedar en tránsito: primero se anula en el sistema.
    IF EXISTS (
        SELECT 1 FROM public.pedido_traslado_linea l
         WHERE l.pedido_item_id = ANY (v_items)
           AND l.estado NOT IN ('anulada', 'omitida')
    ) THEN
        RAISE EXCEPTION 'TRASLADO_VIVO: el traslado de ese producto sigue sin anular';
    END IF;

    UPDATE public.pedido_items
       SET status            = 'no_enviado',
           cantidad_enviada  = 0,
           cantidad_recibida = 0,
           falta_caja        = false,
           motivo_no_envio   = coalesce(motivo_no_envio, 'No se reenvió: la caja no llegó a la sala')
     WHERE id = ANY (v_items)
       AND pedido_id = p_pedido_id
       AND erp_sucursal_id = p_suc_id
       AND status IN ('pendiente', 'no_enviado');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> cardinality(v_items) THEN
        RAISE EXCEPTION 'ESTADO: ese producto ya se contó o se resolvió de otra forma';
    END IF;

    INSERT INTO public.pedido_item_eventos (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
    SELECT i, p_pedido_id, p_suc_id, 'no_reenviado',
           'La caja no llegó y bodega decidió no reenviarla', p_actor
      FROM unnest(v_items) i;

    UPDATE public.pedido_sucursal_status
       SET cajas_especiales_llegadas = v_llegadas
                                     || (SELECT jsonb_object_agg(l, 'no_reenviada') FROM unnest(p_labels) l)
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_suc_id;

    PERFORM public.cerrar_pedido_si_todo_resuelto(p_pedido_id, p_suc_id, p_actor);

    RETURN json_build_object('items', v_items, 'labels', p_labels);
END;
$$;

REVOKE ALL ON FUNCTION public.cerrar_no_reenviadas(uuid, integer, text[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_no_reenviadas(uuid, integer, text[], uuid) TO service_role;
