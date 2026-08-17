SET lock_timeout = '5s';

-- ⚠️ La versión VIVA de `decidir_diferencia_pedido` y de
-- `confirmar_llegada_diferencia` es la de
-- `20260817214322_supervision_no_es_alcance_todas_las_salas.sql`, que corrige
-- las guardas de turno. Este archivo queda como el paso que las creó.

-- ── La clave del renglón, en UN solo lugar ─────────────────────────────────
-- Estaba adentro de `solicitar_devolucion_pedido`. Ahora la necesitan dos
-- caminos (la devolución y la decisión), y dos fórmulas separadas se separan
-- más — es la misma razón por la que la devolución REUSA la clave del despacho
-- en vez de recalcularla.
CREATE OR REPLACE FUNCTION public.clave_movimiento_de_item(p_item_id integer, p_prefijo text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_base   text;
    v_numero integer;
    v_suc    text;
    v_ped    uuid;
    v_erpsuc integer;
BEGIN
    SELECT pi.pedido_id, pi.erp_sucursal_id INTO v_ped, v_erpsuc
      FROM public.pedido_items pi WHERE pi.id = p_item_id;
    IF v_ped IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;

    SELECT l.clave INTO v_base
      FROM public.pedido_traslado_linea l
     WHERE l.pedido_id = v_ped AND l.erp_sucursal_id = v_erpsuc AND l.pedido_item_id = p_item_id;

    IF v_base IS NOT NULL THEN
        RETURN p_prefijo || '-' || v_base;
    END IF;

    -- El pedido no se despachó por el portal: no hay hoja que citar. Misma
    -- forma, con H0, para que la clave siga siendo única y reconocible.
    SELECT numero INTO v_numero FROM public.pedidos WHERE id = v_ped;
    SELECT codigo INTO v_suc FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_erpsuc;
    IF v_suc IS NULL THEN
        RAISE EXCEPTION 'SALA_SIN_CODIGO: la sala % no tiene código en el registro de salas', v_erpsuc;
    END IF;

    RETURN p_prefijo || '-P' || coalesce(v_numero::text, '0') || '-' || v_suc || '-H0-I' || p_item_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clave_movimiento_de_item(integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clave_movimiento_de_item(integer, text) TO authenticated, service_role;


-- ── Cuánto se mueve, por tipo de diferencia ────────────────────────────────
-- Tres cuentas distintas y ninguna es «la cantidad»: el faltante es lo que NO
-- llegó, el sobrante lo que llegó DE MÁS, y el dañado/vencido sale de lo que SÍ
-- llegó (y sólo la parte con problema, si se anotó).
CREATE OR REPLACE FUNCTION public.cantidad_de_diferencia(p_item_id integer)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
    SELECT CASE pi.error_tipo
        WHEN 'faltante' THEN coalesce(pi.cantidad_enviada, pi.cantidad_asignada) - coalesce(pi.cantidad_recibida, 0)
        WHEN 'sobrante' THEN coalesce(pi.cantidad_recibida, 0) - coalesce(pi.cantidad_enviada, pi.cantidad_asignada)
        ELSE coalesce(pi.cantidad_problema, pi.cantidad_recibida, 0)
    END
    FROM public.pedido_items pi WHERE pi.id = p_item_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.cantidad_de_diferencia(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cantidad_de_diferencia(integer) TO authenticated, service_role;


-- ── La conversación ────────────────────────────────────────────────────────
--
--   NULL             → la SALA propone                        → propuesta
--   propuesta        → BODEGA acepta                          → acordada/confirmada
--                    → BODEGA contrapropone la otra           → contrapropuesta
--   contrapropuesta  → la SALA acepta                         → acordada/confirmada
--                    → la SALA rechaza                        → escalada
--   escalada         → SUPERVISIÓN decide con cuál se queda   → acordada/confirmada
--
-- «acordada» es el acuerdo tomado con algo todavía por pasar: que el producto
-- llegue, o que el movimiento termine. «confirmada» es el final, y es lo único
-- que deja cerrar el pedido.
CREATE OR REPLACE FUNCTION public.decidir_diferencia_pedido(
    p_item_id  integer,
    p_accion   text,                       -- proponer | aceptar | contraproponer | rechazar | supervisar
    p_tipo     text DEFAULT NULL,          -- el valor de diferencia_opcion
    p_nota     text DEFAULT NULL,
    p_evidencia jsonb DEFAULT '[]'::jsonb  -- fotos, para el dañado
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

    v_es_super := EXISTS (SELECT 1 FROM public.employees e
                           WHERE e.id = v_actor AND e.system_role IN ('SUPERVISOR','ADMIN','SUPERADMIN'));
    v_es_sala  := auth_employee_erp_sucursal_id() IS NOT DISTINCT FROM v_it.erp_sucursal_id;

    IF p_accion = 'proponer' THEN
        IF v_it.resolucion_status IS NOT NULL THEN
            RAISE EXCEPTION 'YA_PROPUESTA: esta diferencia ya tiene una propuesta en curso';
        END IF;
        IF NOT v_es_sala AND NOT auth_can_edit_scope_all(ARRAY['pedidos']) THEN
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
        IF v_it.resuelto_por = v_actor THEN
            RAISE EXCEPTION 'NO_TE_ACEPTAS_SOLO: la acepta la otra parte';
        END IF;
        p_tipo  := v_it.resolucion_tipo;
        v_nuevo := 'acordada';

    ELSIF p_accion = 'rechazar' THEN
        IF v_it.resolucion_status <> 'contrapropuesta' THEN
            RAISE EXCEPTION 'FUERA_DE_TURNO: sólo se rechaza una contrapropuesta';
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

    -- El movimiento nace ACEPTADO: el acuerdo ya se dio arriba, y pedirlo de
    -- nuevo sería la misma conversación dos veces.
    IF v_nuevo = 'acordada' AND v_op.mueve = 'devolucion' THEN
        v_cant  := public.cantidad_de_diferencia(p_item_id);
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
            v_it.error_tipo <> 'faltante',   -- el faltante nunca salió de bodega: no viaja
            v_cant, v_nota, coalesce(p_evidencia, '[]'::jsonb),
            'aceptada', coalesce(v_it.resuelto_por, v_actor), v_actor, now(), v_clave
        )
        RETURNING id INTO v_dev_id;
    END IF;

    RETURN jsonb_build_object(
        'estado',       v_nuevo,
        'opcion',       p_tipo,
        'rotulo',       v_op.rotulo,
        'mueve',        v_op.mueve,
        'cierra_con',   v_op.cierra_con,
        'devolucion_id', v_dev_id,
        'vence_at',     v_vence
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.decidir_diferencia_pedido(integer, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.decidir_diferencia_pedido(integer, text, text, text, jsonb) TO authenticated, service_role;
