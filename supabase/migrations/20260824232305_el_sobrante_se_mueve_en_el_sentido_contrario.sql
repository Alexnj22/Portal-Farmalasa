-- El brazo que faltaba: «Bodega le pasa la cantidad a la sala».
--
-- El catálogo de un sobrante ofrece las dos salidas desde el 2026-08-17, pero
-- sólo una hacía algo. `decidir_diferencia_pedido` implementaba `mueve =
-- 'devolucion'` y nada más; para `traslado_a_sala` dejaba el acuerdo escrito, y
-- el portal pintaba un aviso —«Falta que salga el traslado de bodega a la
-- sala»— que nadie podía atender porque no había con qué.
--
-- No hacía falta una máquina nueva: es el ESPEJO del faltante. Un faltante hace
-- un traslado de papel sala → Bodega (`viaja = false`, nada se mueve de lugar);
-- un sobrante hace el mismo traslado de papel Bodega → sala, y tampoco se mueve
-- nada porque el producto YA está en la sala. Misma fila, mismos estados, misma
-- clave, mismo reintento — con el origen y el destino cambiados.

SET lock_timeout = '5s';

-- ── 1. Un movimiento de diferencia puede ir para el otro lado ─────────────
ALTER TABLE public.pedido_devolucion DROP CONSTRAINT IF EXISTS pedido_devolucion_motivo_check;
ALTER TABLE public.pedido_devolucion ADD  CONSTRAINT pedido_devolucion_motivo_check
    CHECK (motivo = ANY (ARRAY['faltante'::text, 'danado'::text, 'vencido'::text, 'sobrante'::text]));

-- Qué VIAJA de verdad. Un faltante no salió nunca de Bodega y un sobrante ya
-- está en la sala: en los dos casos el traslado es sólo el asiento. Lo dañado y
-- lo vencido sí se suben al camión.
ALTER TABLE public.pedido_devolucion DROP CONSTRAINT IF EXISTS pedido_devolucion_viaja_segun_motivo;
ALTER TABLE public.pedido_devolucion ADD  CONSTRAINT pedido_devolucion_viaja_segun_motivo
    CHECK (viaja = (motivo <> ALL (ARRAY['faltante'::text, 'sobrante'::text])));

-- El sentido es GENERADO, no una columna que alguien escriba. Si fuera un dato
-- más se podría guardar una fila que diga «sobrante» y apunte a Bodega, y esa
-- fila sacaría producto de la sala que acaba de contarlo de más. Derivarlo del
-- motivo hace que ese estado no exista.
ALTER TABLE public.pedido_devolucion
    ADD COLUMN IF NOT EXISTS sentido text
    GENERATED ALWAYS AS (CASE WHEN motivo = 'sobrante' THEN 'a_sala' ELSE 'a_bodega' END) STORED;

COMMENT ON COLUMN public.pedido_devolucion.sentido IS
    'a_bodega (sale de la sala) | a_sala (sale de Bodega). Generada a partir del '
    'motivo: no se escribe, para que no exista una fila con el sentido torcido.';

-- ── 2. El turno que crea el movimiento, en los dos sentidos ───────────────
CREATE OR REPLACE FUNCTION public.decidir_diferencia_pedido(
    p_item_id integer, p_accion text, p_tipo text DEFAULT NULL::text,
    p_nota text DEFAULT NULL::text, p_evidencia jsonb DEFAULT '[]'::jsonb)
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
            estado, solicitada_por, decidida_por, decidida_at, clave
        ) VALUES (
            v_it.pedido_id, v_it.erp_sucursal_id, v_it.id, v_it.erp_product_id,
            v_it.error_tipo,
            -- Ni el faltante ni el sobrante se suben a ningún camión: uno nunca
            -- salió de Bodega y el otro ya está en la sala.
            v_it.error_tipo NOT IN ('faltante', 'sobrante'),
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

-- ── 3. Cerrar el renglón sin pisar lo que se acordó ───────────────────────
--
-- Escribía `resolucion_tipo = 'devolver_bodega'` fijo, y ése es el valor de un
-- DAÑADO o un VENCIDO. Un faltante se acuerda con `regresar_traslado`, así que
-- al recibirlo en Bodega su tipo quedaba reescrito con una opción que no existe
-- en el catálogo de «faltante»: `opcionElegida()` devolvía null y la pantalla
-- se quedaba sin poder nombrar con qué se resolvió. Medido: 2 de las 3
-- devoluciones reales de producción tenían ese valor imposible.
--
-- El tipo ya lo escribió `decidir_diferencia_pedido` cuando las dos partes
-- coincidieron. Acá no hay nada que decidir: sólo se confirma.
CREATE OR REPLACE FUNCTION public.cerrar_item_por_devolucion(p_devolucion_id uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dev record;
BEGIN
    SELECT * INTO v_dev FROM public.pedido_devolucion WHERE id = p_devolucion_id;
    IF v_dev.id IS NULL OR v_dev.estado <> 'recibida' THEN
        RETURN;   -- sin movimiento recibido no se cierra nada
    END IF;

    UPDATE public.pedido_items SET
        resolucion_status  = 'confirmada',
        resolucion_nota    = coalesce(resolucion_nota, v_dev.nota),
        resuelto_por       = coalesce(resuelto_por, v_dev.solicitada_por),
        resuelto_at        = coalesce(resuelto_at,  v_dev.solicitada_at),
        confirmado_suc_por = p_actor,
        confirmado_suc_at  = now()
    WHERE id = v_dev.pedido_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    SELECT v_dev.pedido_item_id, v_dev.pedido_id, v_dev.erp_sucursal_id,
           CASE WHEN v_dev.sentido = 'a_sala' THEN 'traslado_recibido' ELSE 'devolucion_recibida' END,
           pi.resolucion_tipo,
           CASE WHEN v_dev.sentido = 'a_sala' THEN 'Entró en la sala — ' ELSE 'Entró en Bodega — ' END
             || v_dev.clave,
           p_actor
      FROM public.pedido_items pi WHERE pi.id = v_dev.pedido_item_id;

    PERFORM public.cerrar_pedido_si_todo_resuelto(v_dev.pedido_id, v_dev.erp_sucursal_id, p_actor);
END;
$function$;

-- ── 4. Y las dos filas que ya quedaron con el tipo imposible ──────────────
-- Se reparan a la opción que de verdad se acordó: la única de «faltante» que
-- mueve un traslado. No se inventa nada — es la que las llevó a tener una
-- devolución.
UPDATE public.pedido_items pi
   SET resolucion_tipo = 'regresar_traslado'
 WHERE pi.error_tipo = 'faltante'
   AND pi.resolucion_tipo = 'devolver_bodega'
   AND EXISTS (SELECT 1 FROM public.pedido_devolucion d
                WHERE d.pedido_item_id = pi.id AND d.motivo = 'faltante');
