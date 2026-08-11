SET lock_timeout = '5s';

-- Lo que Bodega REALMENTE mandó.
--
-- El pedido guardaba lo asignado (lo que el reparto decidió) y lo recibido (lo
-- que la sucursal contó), y entre esos dos faltaba el dato del medio: qué salió
-- de la bodega. Se daba por hecho que salía lo asignado, y no es cierto — entre
-- que se arma el pedido y que se despacha, la bodega se mueve. Medido el
-- 2026-08-11 sobre el pedido #96: de 476 productos, 13 ya no estaban.
--
-- Es además el dato que tiene que viajar al traslado del sistema. Mandar lo
-- asignado movería inventario que no salió.
ALTER TABLE public.pedido_items
    ADD COLUMN IF NOT EXISTS cantidad_enviada  integer,
    ADD COLUMN IF NOT EXISTS enviado_at        timestamptz,
    ADD COLUMN IF NOT EXISTS enviado_por       uuid,
    ADD COLUMN IF NOT EXISTS motivo_no_envio   text;

COMMENT ON COLUMN public.pedido_items.cantidad_enviada IS
    'Lo que Bodega confirmó que sale, al finalizar. NULL = todavía sin confirmar. Puede ser menor, igual o mayor que cantidad_asignada.';

-- `no_enviado` es un estado TERMINAL propio, y no se reusa `anulado`: ese lo
-- pone `anular_pedido` cuando se cancela el pedido entero, y confundirlos haría
-- que un renglón que no salió se lea como un pedido cancelado. Sin un estado
-- terminal, el renglón se quedaría en 'pendiente' para siempre — que es
-- exactamente el atraso de 16,221 ítems que hubo que cerrar a mano hoy.
ALTER TABLE public.pedido_items DROP CONSTRAINT IF EXISTS pedido_items_status_check;
ALTER TABLE public.pedido_items ADD CONSTRAINT pedido_items_status_check
    CHECK (status = ANY (ARRAY['pendiente','recibido','con_diferencia','anulado','no_enviado']));

-- ── Confirmar el envío ──────────────────────────────────────────────────────
-- Por EXCEPCIÓN: lo normal es que salga lo asignado, así que eso se aplica solo
-- y `p_ajustes` trae únicamente los renglones que cambian. Pedirle a alguien que
-- confirme 476 productos uno por uno es pedirle que apriete "sí" 476 veces, que
-- no es confirmar nada.
--
-- Idempotente: el default solo toca lo que todavía no se confirmó, así que
-- llamarla dos veces no borra los ajustes de la primera.
CREATE OR REPLACE FUNCTION public.confirmar_envio_pedido(
    p_pedido_id   uuid,
    p_sucursal_id integer,
    p_ajustes     jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor  uuid := auth_employee_id();
    v_status text;
    v_aj     jsonb;
    v_id     integer;
    v_qty    integer;
    v_ajustados integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
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

        IF v_qty IS NULL OR v_qty < 0 THEN
            RAISE EXCEPTION 'cantidad_enviada inválida para el ítem %.', v_id;
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
$$;

REVOKE EXECUTE ON FUNCTION public.confirmar_envio_pedido(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_envio_pedido(uuid, integer, jsonb) TO authenticated, service_role;

-- ── La recepción se compara contra lo ENVIADO, no contra lo asignado ────────
-- Si Bodega mandó 3 de 5, recibir 3 está bien y no es una diferencia. Con el
-- COALESCE los pedidos viejos —sin cantidad_enviada— siguen comportándose igual.
-- El DEFAULT de p_received_by se conserva: quitarlo rompe el CREATE OR REPLACE
-- («cannot remove parameter defaults») y, si se recreara sin él, dejaría dos
-- sobrecargas conviviendo.
CREATE OR REPLACE FUNCTION public.receive_pedido_sucursal(
    p_pedido_id uuid, p_sucursal_id integer, p_items jsonb, p_received_by uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_status    text;
  v_item      jsonb;
  v_qty_diff  boolean;
  v_has_diff  boolean;
  v_error     text;
  v_cant_prob integer;
  v_actor     uuid := auth_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;

  SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_status IN ('anulado', 'completado') THEN
    RAISE EXCEPTION 'El pedido ya está % y no puede ser modificado.', v_status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_error     := NULLIF(TRIM(v_item->>'error_tipo'), '');
    v_cant_prob := NULLIF(v_item->>'cantidad_problema', '')::integer;

    SELECT (COALESCE(pi.cantidad_enviada, pi.cantidad_asignada)
              IS DISTINCT FROM (v_item->>'cantidad_recibida')::integer)
    INTO v_qty_diff
    FROM pedido_items pi
    WHERE pi.id              = (v_item->>'pedido_item_id')::integer
      AND pi.erp_sucursal_id = p_sucursal_id
      AND pi.pedido_id       = p_pedido_id
      AND pi.status          = 'pendiente'
      AND NOT COALESCE(pi.falta_caja, false);

    CONTINUE WHEN v_qty_diff IS NULL;

    v_has_diff := v_qty_diff OR (v_error IS NOT NULL);

    UPDATE pedido_items SET
      cantidad_recibida = (v_item->>'cantidad_recibida')::integer,
      nota_diferencia   = NULLIF(TRIM(v_item->>'nota_diferencia'), ''),
      error_tipo        = v_error,
      cantidad_problema = v_cant_prob,
      status            = CASE WHEN v_has_diff THEN 'con_diferencia' ELSE 'recibido' END,
      received_at       = now(),
      received_by       = v_actor
    WHERE id              = (v_item->>'pedido_item_id')::integer
      AND erp_sucursal_id = p_sucursal_id
      AND pedido_id       = p_pedido_id
      AND status          = 'pendiente'
      AND NOT COALESCE(falta_caja, false);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'pendiente'
  ) THEN
    IF EXISTS (SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'con_diferencia') THEN
      UPDATE pedidos SET status = 'parcial'    WHERE id = p_pedido_id;
    ELSE
      UPDATE pedidos SET status = 'completado' WHERE id = p_pedido_id;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'con_diferencia') THEN
    UPDATE pedidos SET status = 'parcial' WHERE id = p_pedido_id;
  END IF;
END;
$$;

-- ── Las tarjetas necesitan ver los que no salieron ──────────────────────────
DROP FUNCTION IF EXISTS public.get_pedido_item_stats(uuid[]);
CREATE FUNCTION public.get_pedido_item_stats(p_pedido_ids uuid[])
RETURNS TABLE(
    pedido_id uuid, erp_sucursal_id integer,
    enviados integer, sin_stock integer, por_regla integer, agotamiento integer,
    pendientes integer, con_diferencia integer, no_enviados integer
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    SELECT
        pedido_id,
        erp_sucursal_id,
        COUNT(*) FILTER (WHERE cantidad_asignada > 0 AND NOT agotamiento)::INT AS enviados,
        COUNT(*) FILTER (WHERE sin_stock = true)::INT                          AS sin_stock,
        COUNT(*) FILTER (WHERE revision_minmax = true)::INT                    AS por_regla,
        COUNT(*) FILTER (WHERE agotamiento = true)::INT                        AS agotamiento,
        COUNT(*) FILTER (WHERE status = 'pendiente')::INT                      AS pendientes,
        COUNT(*) FILTER (WHERE status = 'con_diferencia')::INT                 AS con_diferencia,
        COUNT(*) FILTER (WHERE status = 'no_enviado')::INT                     AS no_enviados
    FROM pedido_items
    WHERE pedido_id = ANY(p_pedido_ids)
    GROUP BY pedido_id, erp_sucursal_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_pedido_item_stats(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pedido_item_stats(uuid[]) TO authenticated, service_role;
