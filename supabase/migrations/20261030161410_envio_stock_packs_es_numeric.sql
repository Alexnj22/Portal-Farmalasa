-- stock_packs_snapshot es NUMERIC, no texto (2026-10-30).
--
-- La migración de ayer (envio_en_otra_presentacion) lo multiplicaba con un
-- guardado por regex (`stock_packs_snapshot ~ '^-?[0-9]+…'`) como si fuera
-- text. Sobre numeric eso no existe: `operator does not exist: numeric ~
-- unknown`, y toda finalización que pasara un renglón a otra presentación
-- fallaba (pedido #236, Salud 5: METFORMINA de 1 CAJA a 4 BLISTER). Ahora se
-- multiplica directo; NULL sigue NULL. Resto idéntico a la definición VIVA.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.confirmar_envio_pedido(p_pedido_id uuid, p_sucursal_id integer, p_ajustes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := auth_employee_id();
    v_status text;
    v_aj     jsonb;
    v_id     integer;
    v_qty    integer;
    v_fac    numeric;
    v_r      numeric;
    v_prod   integer;
    v_pres   integer;
    v_k      integer;
    v_ajustados integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    -- Confirmar lo que sale es de Bodega (decisión 2026-10-02).
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: confirmar el envío es de Bodega';
    END IF;

    SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;
    IF v_status IN ('anulado', 'completado') THEN
        RAISE EXCEPTION 'El pedido ya está % y no puede confirmarse.', v_status;
    END IF;

    -- 1. Lo normal: sale lo asignado.
    UPDATE pedido_items
    SET cantidad_enviada = cantidad_asignada,
        enviado_at       = now(),
        enviado_por      = v_actor
    WHERE pedido_id       = p_pedido_id
      AND erp_sucursal_id = p_sucursal_id
      AND status          = 'pendiente'
      AND cantidad_enviada IS NULL;

    -- 2. Las excepciones que trajo quien confirma.
    FOR v_aj IN SELECT * FROM jsonb_array_elements(coalesce(p_ajustes, '[]'::jsonb))
    LOOP
        v_id  := (v_aj->>'pedido_item_id')::integer;
        v_qty := (v_aj->>'cantidad_enviada')::integer;
        v_fac := nullif(v_aj->>'factor', '')::numeric;

        IF v_qty IS NULL OR v_qty < 0 THEN
            RAISE EXCEPTION 'cantidad_enviada inválida para el ítem %.', v_id;
        END IF;

        -- 2a. Escrito en otra presentación.
        IF v_fac IS NOT NULL THEN
            SELECT coalesce(nullif(factor, 0), 1), erp_product_id INTO v_r, v_prod
            FROM pedido_items
            WHERE id = v_id AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND status IN ('pendiente', 'no_enviado')
            FOR UPDATE;

            IF FOUND AND v_fac <> v_r AND v_qty > 0 THEN
                IF (v_qty * v_fac) % v_r = 0 THEN
                    -- Cabe entera en la del renglón: se guarda ahí.
                    v_qty := ((v_qty * v_fac) / v_r)::integer;
                ELSE
                    IF v_fac <= 0 OR v_r % v_fac <> 0 THEN
                        RAISE EXCEPTION 'PRESENTACION_NO_CABE: % en presentación de % no se puede guardar en el ítem % (presentación de %).',
                            v_qty, v_fac, v_id, v_r;
                    END IF;
                    SELECT pp.id_presentacion INTO v_pres
                    FROM product_precios pp
                    WHERE pp.product_id = v_prod AND pp.factor = v_fac AND pp.activo
                    ORDER BY pp.id LIMIT 1;
                    IF v_pres IS NULL THEN
                        RAISE EXCEPTION 'PRESENTACION_INEXISTENTE: el producto % no tiene una presentación activa de %.', v_prod, v_fac;
                    END IF;
                    v_k := (v_r / v_fac)::integer;

                    UPDATE pedido_items
                    SET factor              = v_fac,
                        erp_presentacion_id = v_pres,
                        cantidad_asignada   = cantidad_asignada * v_k,
                        max_qty_snapshot    = max_qty_snapshot * v_k,
                        min_qty_snapshot    = min_qty_snapshot * v_k,
                        stock_packs_snapshot = stock_packs_snapshot * v_k,
                        lotes_asignados = CASE WHEN jsonb_typeof(lotes_asignados) = 'array' THEN (
                            SELECT coalesce(jsonb_agg(
                                       CASE WHEN e ? 'take'
                                            THEN jsonb_set(e, '{take}', to_jsonb((e->>'take')::numeric * v_k))
                                            ELSE e END
                                       ORDER BY o), '[]'::jsonb)
                            FROM jsonb_array_elements(lotes_asignados) WITH ORDINALITY AS t(e, o)
                        ) ELSE lotes_asignados END
                    WHERE id = v_id;
                END IF;
            END IF;
        END IF;

        -- El ítem tiene que ser de ESTE pedido y de ESTA sucursal: el id viene
        -- del navegador y sin esto se podría tocar el renglón de otra sala.
        UPDATE pedido_items
        SET cantidad_enviada = v_qty,
            motivo_no_envio  = nullif(trim(v_aj->>'motivo'), ''),
            enviado_at       = now(),
            enviado_por      = v_actor,
            -- Lo que no sale se cierra acá mismo. Decisión del usuario
            -- (2026-08-11): el faltante no queda pendiente, el MIN/MAX lo
            -- vuelve a detectar y lo pide solo en el próximo pedido.
            status           = CASE WHEN v_qty = 0 THEN 'no_enviado' ELSE status END,
            cantidad_recibida = CASE WHEN v_qty = 0 THEN 0 ELSE cantidad_recibida END
        WHERE id              = v_id
          AND pedido_id       = p_pedido_id
          AND erp_sucursal_id = p_sucursal_id
          AND status IN ('pendiente', 'no_enviado');

        IF FOUND THEN
            v_ajustados := v_ajustados + 1;
        END IF;
    END LOOP;

    RETURN (
        SELECT jsonb_build_object(
            'ajustados',    v_ajustados,
            'confirmados',  count(*) FILTER (WHERE cantidad_enviada IS NOT NULL),
            'no_enviados',  count(*) FILTER (WHERE status = 'no_enviado'),
            'packs',        coalesce(sum(cantidad_enviada) FILTER (WHERE status <> 'no_enviado'), 0)
        )
        FROM pedido_items
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
    );
END;
$function$;
