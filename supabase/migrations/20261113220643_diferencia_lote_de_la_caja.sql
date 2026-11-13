SET lock_timeout = '5s';

-- (2026-11-13) Lo que llegó dañado o vencido SIN lote asignado vuelve con el
-- lote de la caja. Lo escribe la SALA —es la que tiene la caja— al proponer o
-- al aceptar la salida; quien acuerda puede ser Bodega, que no la tiene. Se
-- guarda en el renglón y se copia a la devolución (`pedido_devolucion.caja`),
-- que es lo que lee `devolver-pedido-erp`.
ALTER TABLE public.pedido_items ADD COLUMN IF NOT EXISTS caja_devolucion jsonb;
COMMENT ON COLUMN public.pedido_items.caja_devolucion IS
  'Lote y vencimiento de la caja ({lote, vence}) que la sala escribió para devolver lo que llegó sin lote asignado.';

DROP FUNCTION IF EXISTS public.decidir_diferencia_pedido(integer, text, text, text, jsonb);

CREATE FUNCTION public.decidir_diferencia_pedido(
    p_item_id integer, p_accion text, p_tipo text DEFAULT NULL::text,
    p_nota text DEFAULT NULL::text, p_evidencia jsonb DEFAULT '[]'::jsonb,
    p_caja jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor    uuid := auth_employee_id();
    v_it       record;
    v_op       record;
    v_es_sala  boolean;
    v_es_super boolean;
    v_nota     text := nullif(btrim(coalesce(p_nota, '')), '');
    v_nuevo    text;
    v_cant     integer;
    v_dev_id   uuid;
    v_clave    text;
    v_vence    timestamptz;
    v_caja     jsonb;
    v_lote     text;
    v_vcaja    text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT pi.* INTO v_it FROM public.pedido_items pi WHERE pi.id = p_item_id FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;
    IF v_it.status <> 'con_diferencia' THEN
        RAISE EXCEPTION 'SIN_DIFERENCIA: este renglón no quedó con diferencia al recibirlo';
    END IF;
    IF v_it.resolucion_status = 'confirmada' THEN
        RAISE EXCEPTION 'YA_CERRADA: esta diferencia ya está resuelta';
    END IF;

    v_es_super := public.auth_es_supervision();
    v_es_sala  := auth_employee_erp_sucursal_id() IS NOT DISTINCT FROM v_it.erp_sucursal_id;

    -- ── El lote de la caja (2026-11-13) ───────────────────────────────────
    -- Sólo lo escribe quien tiene la caja (la sala, o supervisión por ella), y
    -- sólo para lo que sale de la sala: dañado o vencido.
    IF p_caja IS NOT NULL AND v_it.error_tipo IN ('danado', 'vencido') AND (v_es_sala OR v_es_super) THEN
        v_lote  := upper(btrim(coalesce(p_caja->>'lote', '')));
        v_vcaja := left(coalesce(p_caja->>'vence', ''), 10);
        IF v_lote = '' OR v_lote ~* '^gen[eé]rico$' OR length(v_lote) > 40 THEN
            RAISE EXCEPTION 'LOTE_INVALIDO: escribe el lote que trae la caja';
        END IF;
        IF v_vcaja !~ '^\d{4}-\d{2}-\d{2}$' OR v_vcaja::date <= current_date THEN
            RAISE EXCEPTION 'VENCE_INVALIDO: el vencimiento de la caja tiene que ser un mes futuro';
        END IF;
        v_caja := jsonb_build_object('lote', v_lote, 'vence', v_vcaja);
        UPDATE public.pedido_items SET caja_devolucion = v_caja WHERE id = p_item_id;
    END IF;
    v_caja := coalesce(v_caja, v_it.caja_devolucion);

    IF p_accion = 'proponer' THEN
        IF v_it.resolucion_status IS NOT NULL THEN
            RAISE EXCEPTION 'YA_PROPUESTA: esta diferencia ya tiene una propuesta en curso';
        END IF;
        IF NOT v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'PROPONE_LA_SALA: la propone la sala que recibió el pedido';
        END IF;
        v_nuevo := 'propuesta';

    ELSIF p_accion = 'contraproponer' THEN
        IF v_it.resolucion_status <> 'propuesta' THEN
            RAISE EXCEPTION 'FUERA_DE_TURNO: sólo se contrapropone sobre una propuesta de la sala';
        END IF;
        IF v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'CONTRAPROPONE_BODEGA: la sala ya propuso; le toca a bodega';
        END IF;
        IF p_tipo IS NOT DISTINCT FROM v_it.resolucion_tipo THEN
            RAISE EXCEPTION 'MISMA_OPCION: contraproponer es elegir la OTRA salida';
        END IF;
        v_nuevo := 'contrapropuesta';

    ELSIF p_accion = 'aceptar' THEN
        IF v_it.resolucion_status NOT IN ('propuesta', 'contrapropuesta') THEN
            RAISE EXCEPTION 'NADA_QUE_ACEPTAR';
        END IF;
        -- El acuerdo es de DOS partes: quien propuso no lo cierra solo, tenga
        -- el alcance que tenga.
        IF v_it.resuelto_por = v_actor THEN
            RAISE EXCEPTION 'NO_TE_ACEPTAS_SOLO: la acepta la otra parte';
        END IF;
        -- Y le toca al otro lado del mostrador, no a cualquiera.
        IF v_it.resolucion_status = 'propuesta'      AND v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'LE_TOCA_A_BODEGA: la propuesta de la sala la contesta bodega';
        END IF;
        IF v_it.resolucion_status = 'contrapropuesta' AND NOT v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'LE_TOCA_A_LA_SALA: la contrapropuesta de bodega la contesta la sala';
        END IF;
        p_tipo  := v_it.resolucion_tipo;
        v_nuevo := 'acordada';

    ELSIF p_accion = 'rechazar' THEN
        IF v_it.resolucion_status <> 'contrapropuesta' THEN
            RAISE EXCEPTION 'FUERA_DE_TURNO: sólo se rechaza una contrapropuesta';
        END IF;
        IF NOT v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'LE_TOCA_A_LA_SALA: la contrapropuesta de bodega la contesta la sala';
        END IF;
        IF v_nota IS NULL THEN
            RAISE EXCEPTION 'MOTIVO_REQUERIDO: decí por qué, que lo va a leer supervisión';
        END IF;
        UPDATE public.pedido_items SET
            resolucion_status = 'escalada',
            rechazado_por     = v_actor,
            rechazado_at      = now(),
            nota_rechazo      = v_nota
        WHERE id = p_item_id;

        INSERT INTO public.pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
        VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'diferencia_escalada',
                v_it.resolucion_tipo, v_nota, v_actor);

        RETURN jsonb_build_object('estado', 'escalada');

    ELSIF p_accion = 'supervisar' THEN
        IF v_it.resolucion_status <> 'escalada' THEN
            RAISE EXCEPTION 'NO_ESTA_ESCALADA';
        END IF;
        IF NOT v_es_super THEN
            RAISE EXCEPTION 'SOLO_SUPERVISION: esta diferencia la decide supervisión';
        END IF;
        v_nuevo := 'acordada';

    ELSE
        RAISE EXCEPTION 'ACCION_DESCONOCIDA: %', p_accion;
    END IF;

    SELECT * INTO v_op FROM public.diferencia_opcion
     WHERE error_tipo = v_it.error_tipo AND valor = p_tipo;
    IF v_op.valor IS NULL THEN
        RAISE EXCEPTION 'OPCION_INVALIDA: «%» no es una salida de un %',
                        coalesce(p_tipo, '(vacío)'), coalesce(v_it.error_tipo, 'renglón sin tipo');
    END IF;

    IF v_nuevo = 'acordada' AND v_op.cierra_con = 'acuerdo' THEN
        v_nuevo := 'confirmada';
    END IF;

    IF v_nuevo = 'acordada' AND v_op.cierra_con IN ('llegada_sala', 'llegada_bodega') THEN
        v_vence := now() + interval '3 days';
    END IF;

    UPDATE public.pedido_items SET
        resolucion_status   = v_nuevo,
        resolucion_tipo     = p_tipo,
        resolucion_nota     = coalesce(v_nota, resolucion_nota),
        resolucion_ronda    = CASE WHEN p_accion IN ('proponer','contraproponer')
                                   THEN resolucion_ronda + 1 ELSE resolucion_ronda END,
        resolucion_vence_at = v_vence,
        resuelto_por        = CASE WHEN p_accion IN ('proponer','contraproponer','supervisar')
                                   THEN v_actor ELSE resuelto_por END,
        resuelto_at         = CASE WHEN p_accion IN ('proponer','contraproponer','supervisar')
                                   THEN now() ELSE resuelto_at END,
        confirmado_suc_por  = CASE WHEN p_accion = 'aceptar' THEN v_actor ELSE confirmado_suc_por END,
        confirmado_suc_at   = CASE WHEN p_accion = 'aceptar' THEN now()   ELSE confirmado_suc_at END,
        supervisado_por     = CASE WHEN p_accion = 'supervisar' THEN v_actor ELSE supervisado_por END,
        supervisado_at      = CASE WHEN p_accion = 'supervisar' THEN now()   ELSE supervisado_at END,
        rechazado_por       = NULL, rechazado_at = NULL, nota_rechazo = NULL
    WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id,
            'diferencia_' || p_accion, p_tipo, v_nota, v_actor);

    -- ── El movimiento, si la salida acordada tiene uno ────────────────────
    --
    -- Los dos sentidos entran por acá y salen la MISMA fila. La única
    -- diferencia visible es el prefijo de la clave —DEV lo que va a Bodega,
    -- TRA lo que va a la sala—, para que quien la busque en el sistema sepa de
    -- entrada para dónde salió. El `sentido` de la fila lo pone la base sola.
    IF v_nuevo = 'acordada' AND v_op.mueve IN ('devolucion', 'traslado_a_sala') THEN
        v_cant := public.cantidad_de_diferencia(p_item_id);
        IF v_cant IS NULL OR v_cant <= 0 THEN
            RAISE EXCEPTION 'CANTIDAD_EN_CERO: no hay diferencia que mover';
        END IF;
        IF v_it.error_tipo = 'danado'
           AND coalesce(jsonb_array_length(p_evidencia), 0) = 0
           AND NOT EXISTS (SELECT 1 FROM public.pedido_devolucion d
                            WHERE d.pedido_item_id = p_item_id
                              AND coalesce(jsonb_array_length(d.evidencia_urls), 0) > 0) THEN
            RAISE EXCEPTION 'FOTO_REQUERIDA: el daño se muestra con una foto, para que Bodega decida '
                            'si amerita la devolución o si el producto todavía se puede vender';
        END IF;

        v_clave := public.clave_movimiento_de_item(
            p_item_id,
            CASE WHEN v_op.mueve = 'traslado_a_sala' THEN 'TRA' ELSE 'DEV' END);

        INSERT INTO public.pedido_devolucion (
            pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id,
            motivo, viaja, cantidad, nota, evidencia_urls,
            estado, solicitada_por, decidida_por, decidida_at, clave, caja
        ) VALUES (
            v_it.pedido_id, v_it.erp_sucursal_id, v_it.id, v_it.erp_product_id,
            v_it.error_tipo,
            -- Ni el faltante ni el sobrante se suben a ningún camión: uno nunca
            -- salió de Bodega y el otro ya está en la sala.
            v_it.error_tipo NOT IN ('faltante', 'sobrante'),
            v_cant, v_nota, coalesce(p_evidencia, '[]'::jsonb),
            'aceptada', coalesce(v_it.resuelto_por, v_actor), v_actor, now(), v_clave,
            CASE WHEN v_it.error_tipo IN ('danado', 'vencido') THEN v_caja END
        )
        RETURNING id INTO v_dev_id;
    END IF;

    -- Cerrada en el acto (salida que cierra por acuerdo): si era la última
    -- cosa abierta del pedido, el pedido se cierra acá. Sin esto quedaba
    -- «parcial» para siempre — ver 20260918 cerrar_por_acuerdo.
    IF v_nuevo = 'confirmada' THEN
        PERFORM public.cerrar_pedido_si_todo_resuelto(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);
    END IF;

    RETURN jsonb_build_object(
        'estado', v_nuevo, 'opcion', p_tipo, 'rotulo', v_op.rotulo,
        'mueve', v_op.mueve, 'cierra_con', v_op.cierra_con,
        'devolucion_id', v_dev_id, 'vence_at', v_vence
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.decidir_diferencia_pedido(integer, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_diferencia_pedido(integer, text, text, text, jsonb, jsonb) TO authenticated, service_role;
