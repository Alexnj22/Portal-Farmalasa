SET lock_timeout = '5s';

-- (2026-11-13) Una devolución por dañado o vencido de un regulado que llegó
-- SIN lote asignado lleva el lote y el vencimiento que trae la caja: la sala
-- los escribe al pedirla y `devolver-pedido-erp` se los asigna a esas unidades
-- antes de moverlas. `asignado` lo marca el servidor para no repetirlo.
ALTER TABLE public.pedido_devolucion ADD COLUMN IF NOT EXISTS caja jsonb;
COMMENT ON COLUMN public.pedido_devolucion.caja IS
  'Lote y vencimiento de la caja ({lote, vence, asignado?}) para lo que llegó sin lote asignado; sólo dañado/vencido.';

DROP FUNCTION IF EXISTS public.solicitar_devolucion_pedido(integer, text, integer, text, jsonb);

CREATE FUNCTION public.solicitar_devolucion_pedido(
    p_pedido_item_id integer, p_motivo text, p_cantidad integer,
    p_nota text DEFAULT NULL::text, p_evidencia jsonb DEFAULT '[]'::jsonb,
    p_caja jsonb DEFAULT NULL::jsonb)
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
    v_caja   jsonb;
    v_lote   text;
    v_vence  text;
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

    -- El lote de la caja (2026-11-13): sólo viaja algo que sale de la sala.
    IF p_caja IS NOT NULL AND p_motivo IN ('danado', 'vencido') THEN
        v_lote  := upper(btrim(coalesce(p_caja->>'lote', '')));
        v_vence := left(coalesce(p_caja->>'vence', ''), 10);
        IF v_lote = '' OR v_lote ~* '^gen[eé]rico$' OR length(v_lote) > 40 THEN
            RAISE EXCEPTION 'LOTE_INVALIDO: escribe el lote que trae la caja';
        END IF;
        IF v_vence !~ '^\d{4}-\d{2}-\d{2}$' OR v_vence::date <= current_date THEN
            RAISE EXCEPTION 'VENCE_INVALIDO: el vencimiento de la caja tiene que ser un mes futuro';
        END IF;
        v_caja := jsonb_build_object('lote', v_lote, 'vence', v_vence);
    END IF;

    -- La clave del despacho de ESTE renglón, reusada y no recalculada: dos
    -- fórmulas separadas se separan más. Vive en `clave_movimiento_de_item`,
    -- que es la misma puerta que usa la decisión de la diferencia.
    v_clave := public.clave_movimiento_de_item(p_pedido_item_id, 'DEV');

    INSERT INTO public.pedido_devolucion (
        pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id,
        motivo, viaja, cantidad, nota, evidencia_urls,
        estado, solicitada_por, clave, caja
    ) VALUES (
        v_it.pedido_id, v_it.erp_sucursal_id, v_it.id, v_it.erp_product_id,
        p_motivo, p_motivo <> 'faltante', p_cantidad,
        nullif(btrim(coalesce(p_nota, '')), ''), coalesce(p_evidencia, '[]'::jsonb),
        'solicitada', v_actor, v_clave, v_caja
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

REVOKE EXECUTE ON FUNCTION public.solicitar_devolucion_pedido(integer, text, integer, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_devolucion_pedido(integer, text, integer, text, jsonb, jsonb) TO authenticated, service_role;
