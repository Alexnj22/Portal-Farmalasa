SET lock_timeout = '5s';

-- La clave de la devolución lleva la hoja del despacho.
--
-- Hasta ahora se armaba aparte y sin `-H`, con el argumento de que una
-- devolución no sale de una hoja. Pero SÍ sale de una: la hoja en la que ese
-- producto llegó, que es justo lo que hay que ir a revisar cuando algo no
-- cuadra. Así que la clave de la devolución pasa a ser la del despacho con
-- `DEV-` adelante, carácter por carácter — buscar `P102-S5-H1-I71445` en el
-- kardex encuentra las dos puntas del mismo renglón, la salida y el retorno.
CREATE OR REPLACE FUNCTION public.solicitar_devolucion_pedido(p_pedido_item_id integer, p_motivo text, p_cantidad integer, p_nota text DEFAULT NULL::text, p_evidencia jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := auth_employee_id();
    v_it     record;
    v_numero integer;
    v_suc    text;
    v_base   text;
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

    -- La clave del despacho de ESTE renglón. Es la que ya lleva la hoja
    -- resuelta —incluido el `HA` de las cajas adicionales—, así que se reusa
    -- en vez de recalcularla: dos fórmulas separadas se separan más.
    SELECT l.clave INTO v_base
      FROM public.pedido_traslado_linea l
     WHERE l.pedido_id       = v_it.pedido_id
       AND l.erp_sucursal_id = v_it.erp_sucursal_id
       AND l.pedido_item_id  = v_it.id;

    IF v_base IS NOT NULL THEN
        v_clave := 'DEV-' || v_base;
    ELSE
        -- El pedido no se despachó por el portal —o es anterior al traslado
        -- automático—, así que no hay hoja que citar. Misma forma, con H0, para
        -- que la clave siga siendo única y reconocible.
        SELECT numero INTO v_numero FROM public.pedidos WHERE id = v_it.pedido_id;

        SELECT codigo INTO v_suc FROM public.erp_sucursal_map
         WHERE erp_sucursal_id = v_it.erp_sucursal_id;
        IF v_suc IS NULL THEN
            RAISE EXCEPTION 'SALA_SIN_CODIGO: la sala % no tiene código en el registro de salas',
                            v_it.erp_sucursal_id;
        END IF;

        v_clave := 'DEV-P' || coalesce(v_numero::text, '0')
                || '-' || v_suc || '-H0-I' || v_it.id;
    END IF;

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
