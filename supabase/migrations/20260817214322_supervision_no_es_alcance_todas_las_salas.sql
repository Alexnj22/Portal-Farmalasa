SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- «Alcance todas las salas» NO es supervisión — lo tiene Bodega
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido el 2026-08-17 ejercitando el circuito con las tres sesiones reales:
-- Josue Guevara (Bodega) pudo PROPONER, que es lo único que la regla del
-- usuario le reserva a la sala. El portillo era `auth_can_edit_scope_all
-- ('pedidos')`, escrito pensando «esto lo tiene supervisión». No: sobre
-- Pedidos, el alcance de Bodega es ALL —tiene que ver los pedidos de las siete
-- salas— y el de la sala es BRANCH. O sea que la excepción para supervisión le
-- daba a Bodega justo el turno de la otra parte.
--
-- Supervisión es `system_role`, y sólo eso: cuatro personas medidas hoy.
-- Es la misma noción que usa `resolver_destinatarios_traslado`.

CREATE OR REPLACE FUNCTION public.auth_es_supervision()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = public.auth_employee_id()
           AND e.system_role IN ('SUPERVISOR', 'ADMIN', 'SUPERADMIN')
    );
$function$;

COMMENT ON FUNCTION public.auth_es_supervision() IS
'Supervisión de verdad: system_role. NO confundir con auth_can_edit_scope_all(), '
'que sobre Pedidos también lo tiene Bodega (2026-08-17).';

REVOKE EXECUTE ON FUNCTION public.auth_es_supervision() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_es_supervision() TO authenticated, service_role;


-- ── Proponer: la sala del renglón, o supervisión ───────────────────────────
CREATE OR REPLACE FUNCTION public.decidir_diferencia_pedido(
    p_item_id  integer,
    p_accion   text,
    p_tipo     text DEFAULT NULL,
    p_nota     text DEFAULT NULL,
    p_evidencia jsonb DEFAULT '[]'::jsonb
)
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

    IF v_nuevo = 'acordada' AND v_op.cierra_con = 'llegada_sala' THEN
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

    IF v_nuevo = 'acordada' AND v_op.mueve = 'devolucion' THEN
        v_cant := public.cantidad_de_diferencia(p_item_id);
        IF v_cant IS NULL OR v_cant <= 0 THEN
            RAISE EXCEPTION 'CANTIDAD_EN_CERO: no hay diferencia que devolver';
        END IF;
        IF v_it.error_tipo = 'danado'
           AND coalesce(jsonb_array_length(p_evidencia), 0) = 0
           AND NOT EXISTS (SELECT 1 FROM public.pedido_devolucion d
                            WHERE d.pedido_item_id = p_item_id
                              AND coalesce(jsonb_array_length(d.evidencia_urls), 0) > 0) THEN
            RAISE EXCEPTION 'FOTO_REQUERIDA: el daño se muestra con una foto, para que Bodega decida '
                            'si amerita la devolución o si el producto todavía se puede vender';
        END IF;

        v_clave := public.clave_movimiento_de_item(p_item_id, 'DEV');

        INSERT INTO public.pedido_devolucion (
            pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id,
            motivo, viaja, cantidad, nota, evidencia_urls,
            estado, solicitada_por, decidida_por, decidida_at, clave
        ) VALUES (
            v_it.pedido_id, v_it.erp_sucursal_id, v_it.id, v_it.erp_product_id,
            CASE WHEN v_it.error_tipo = 'faltante' THEN 'faltante' ELSE v_it.error_tipo END,
            v_it.error_tipo <> 'faltante',
            v_cant, v_nota, coalesce(p_evidencia, '[]'::jsonb),
            'aceptada', coalesce(v_it.resuelto_por, v_actor), v_actor, now(), v_clave
        )
        RETURNING id INTO v_dev_id;
    END IF;

    RETURN jsonb_build_object(
        'estado', v_nuevo, 'opcion', p_tipo, 'rotulo', v_op.rotulo,
        'mueve', v_op.mueve, 'cierra_con', v_op.cierra_con,
        'devolucion_id', v_dev_id, 'vence_at', v_vence
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.decidir_diferencia_pedido(integer, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.decidir_diferencia_pedido(integer, text, text, text, jsonb) TO authenticated, service_role;


-- ── Y lo mismo en la confirmación de llegada ───────────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_llegada_diferencia(p_item_id integer, p_nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor   uuid := auth_employee_id();
    v_it      record;
    v_op      record;
    v_es_sala boolean;
    v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
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
    IF v_it.resolucion_status <> 'acordada' THEN
        RAISE EXCEPTION 'SIN_ACUERDO: todavía no hay una decisión acordada sobre este renglón';
    END IF;

    SELECT * INTO v_op FROM public.diferencia_opcion
     WHERE error_tipo = v_it.error_tipo AND valor = v_it.resolucion_tipo;
    IF v_op.cierra_con NOT IN ('llegada_sala', 'llegada_bodega') THEN
        RAISE EXCEPTION 'NO_SE_CIERRA_ASI: esta decisión no se cierra confirmando una llegada';
    END IF;

    v_es_sala := auth_employee_erp_sucursal_id() IS NOT DISTINCT FROM v_it.erp_sucursal_id;

    -- Lo confirma quien lo RECIBE, y punto. Acá el alcance no sirve de excusa:
    -- Bodega tiene alcance ALL sobre Pedidos y con eso podría dar por llegado a
    -- la sala un producto que nunca salió.
    IF v_op.cierra_con = 'llegada_sala'   AND NOT v_es_sala AND NOT public.auth_es_supervision() THEN
        RAISE EXCEPTION 'LO_CONFIRMA_LA_SALA: el producto llega a la sala, y la sala es quien lo ve';
    END IF;
    IF v_op.cierra_con = 'llegada_bodega' AND v_es_sala AND NOT public.auth_es_supervision() THEN
        RAISE EXCEPTION 'LO_CONFIRMA_BODEGA: el producto vuelve a bodega, y bodega es quien lo ve';
    END IF;

    UPDATE public.pedido_items SET
        resolucion_status   = 'confirmada',
        resolucion_vence_at = NULL,
        resolucion_nota     = coalesce(v_nota, resolucion_nota),
        confirmado_suc_por  = v_actor,
        confirmado_suc_at   = now()
    WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'diferencia_llegada',
            v_it.resolucion_tipo, v_nota, v_actor);

    PERFORM public.cerrar_pedido_si_todo_resuelto(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);

    RETURN jsonb_build_object('estado', 'confirmada');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_llegada_diferencia(integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_llegada_diferencia(integer, text) TO authenticated, service_role;
