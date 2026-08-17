SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El botón «Devolver a bodega»: dos firmas, y de dos personas distintas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido el 2026-08-17 sobre el pedido 116, con la sesión real de Bodega:
-- Josue Guevara PIDIÓ la devolución en nombre de La Popular y la ACEPTÓ él
-- mismo, en dos llamadas seguidas. Y aceptar es lo que dispara el movimiento,
-- así que una persona sola podía sacar mercadería del sistema de una sala sin
-- que la sala se enterara — no hay aviso todavía.
--
-- Son dos permisos que se suman mal:
--   1. `solicitar_devolucion_pedido` dejaba pedirla a cualquiera con alcance
--      «todas las salas», creyendo que eso era supervisión. Sobre Pedidos ese
--      alcance lo tiene BODEGA (ve los pedidos de las siete salas); la sala
--      tiene alcance «su sala». Mismo error que ya se corrigió en
--      `decidir_diferencia_pedido` — ver `auth_es_supervision()`.
--   2. `decidir_devolucion_pedido` no miraba QUIÉN la había pedido.
--
-- Ninguna de las dos alcanza sola: hay que cerrar las dos. Verificado con las
-- tres sesiones reales y transacción revertida: bodega pidiendo por la sala
-- rebota, la sala sí puede, y supervisión —que es la única que alcanza las dos
-- puntas— puede RETIRAR lo que pidió pero no aceptárselo.

CREATE OR REPLACE FUNCTION public.solicitar_devolucion_pedido(
    p_pedido_item_id integer, p_motivo text, p_cantidad integer,
    p_nota text DEFAULT NULL::text, p_evidencia jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := auth_employee_id();
    v_it     record;
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
    -- producto. Supervisión —el CARGO, no el alcance— puede hacerlo por ella.
    IF NOT public.auth_es_supervision()
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

    -- La clave del despacho de ESTE renglón, reusada y no recalculada: dos
    -- fórmulas separadas se separan más. Vive en `clave_movimiento_de_item`,
    -- que es la misma puerta que usa la decisión de la diferencia.
    v_clave := public.clave_movimiento_de_item(p_pedido_item_id, 'DEV');

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
$function$;


CREATE OR REPLACE FUNCTION public.decidir_devolucion_pedido(p_id uuid, p_accion text, p_nota text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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

    -- Nada se mueve sin que coincidan DOS personas. Aceptar es lo que saca el
    -- producto del sistema de la sala: quien la pidió no puede además darse el
    -- sí. Rechazar sí puede —es retirar lo que uno mismo pidió, y no mueve nada.
    IF p_accion = 'aceptar' AND v_dev.solicitada_por = v_actor THEN
        RAISE EXCEPTION 'NO_TE_ACEPTAS_SOLO: la acepta la otra parte, no quien la pidió';
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
$function$;
