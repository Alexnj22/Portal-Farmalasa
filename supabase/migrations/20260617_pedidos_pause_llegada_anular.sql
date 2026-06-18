-- ============================================================
-- Pedidos — Historial de pausas, recepción física, fix anular
-- v2.2.161
--
-- 1. pedido_pausa_historial: historial completo multi-pausa
--    (las columnas pausado_at/reanudado_at de pedido_sucursal_status
--     se mantienen como indicador de "pausa activa" para la UI)
-- 2. llegada_fisica_at/por: Recepción 1 — confirmar llegada física
--    de cajas antes del conteo de ítems (Recepción 2)
-- 3. update_pedido_sucursal_lifecycle: nuevo stage 'confirmar_llegada'
--    + usa pedido_pausa_historial para pausas múltiples sin pérdida
-- 4. anular_pedido: bloquea estado 'parcial' (hay ítems ya recibidos)
-- ============================================================

-- ── 1. Tabla historial de pausas ─────────────────────────────

CREATE TABLE IF NOT EXISTS pedido_pausa_historial (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id        UUID        NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    erp_sucursal_id  INTEGER     NOT NULL,
    pausado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reanudado_at     TIMESTAMPTZ,
    razon            TEXT,
    pausado_por      UUID        REFERENCES employees(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pph_pedido_suc
    ON pedido_pausa_historial (pedido_id, erp_sucursal_id);

ALTER TABLE pedido_pausa_historial ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pph_select" ON pedido_pausa_historial
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "pph_insert" ON pedido_pausa_historial
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "pph_update" ON pedido_pausa_historial
    FOR UPDATE TO authenticated USING (true);


-- ── 2. Columnas llegada física ────────────────────────────────

ALTER TABLE pedido_sucursal_status
    ADD COLUMN IF NOT EXISTS llegada_fisica_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS llegada_fisica_por UUID
        REFERENCES employees(id) ON DELETE SET NULL;


-- ── 3. Lifecycle RPC actualizado ─────────────────────────────

CREATE OR REPLACE FUNCTION update_pedido_sucursal_lifecycle(
    p_pedido_id   UUID,
    p_sucursal_id INTEGER,
    p_stage       TEXT,
    p_user_id     UUID   DEFAULT NULL,
    p_razon       TEXT   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO pedido_sucursal_status (pedido_id, erp_sucursal_id)
    VALUES (p_pedido_id, p_sucursal_id)
    ON CONFLICT (pedido_id, erp_sucursal_id) DO NOTHING;

    IF p_stage = 'iniciar' THEN
        UPDATE pedido_sucursal_status
        SET iniciado_at  = NOW(), iniciado_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NULL;

    ELSIF p_stage = 'pausar' THEN
        -- No-op si ya hay una pausa abierta (evita doble-pausa)
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN
            RETURN;
        END IF;
        -- Actualiza indicador "pausa activa" en el status para la UI
        UPDATE pedido_sucursal_status
        SET pausado_at = NOW(), pausa_razon = p_razon, reanudado_at = NULL
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL;
        -- Registra en historial (persistente, no se sobreescribe)
        INSERT INTO pedido_pausa_historial
            (pedido_id, erp_sucursal_id, pausado_at, razon, pausado_por)
        VALUES
            (p_pedido_id, p_sucursal_id, NOW(), p_razon, p_user_id);

    ELSIF p_stage = 'reanudar' THEN
        -- Cierra la pausa abierta en el historial
        UPDATE pedido_pausa_historial
        SET reanudado_at = NOW()
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND reanudado_at IS NULL;
        -- Actualiza indicador en status
        UPDATE pedido_sucursal_status
        SET reanudado_at = NOW()
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND pausado_at IS NOT NULL AND reanudado_at IS NULL
          AND finalizado_at IS NULL;

    ELSIF p_stage = 'finalizar' THEN
        -- No se puede finalizar con pausa activa en historial
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN
            RAISE EXCEPTION 'No se puede finalizar: hay una pausa activa sin reanudar.';
        END IF;
        UPDATE pedido_sucursal_status
        SET finalizado_at = NOW(), finalizado_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL
          AND (pausado_at IS NULL OR reanudado_at IS NOT NULL);

    ELSIF p_stage = 'confirmar_llegada' THEN
        -- Recepción 1: confirmación física de llegada de cajas
        UPDATE pedido_sucursal_status
        SET llegada_fisica_at  = NOW(),
            llegada_fisica_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND llegada_fisica_at IS NULL;

    ELSIF p_stage = 'recibir_erp' THEN
        UPDATE pedido_sucursal_status
        SET recibido_erp_at  = NOW(),
            recibido_erp_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND recibido_erp_at IS NULL;

    ELSE
        RAISE EXCEPTION 'stage desconocido: %', p_stage;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION
    update_pedido_sucursal_lifecycle(uuid, integer, text, uuid, text)
    TO authenticated;


-- ── 4. anular_pedido: bloquea estado parcial ─────────────────

CREATE OR REPLACE FUNCTION anular_pedido(
    p_pedido_id   uuid,
    p_anulado_por uuid DEFAULT NULL,
    p_motivo      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;

    -- 'parcial' bloqueado: ya existen ítems recibidos o con diferencia
    IF v_status IN ('completado', 'anulado', 'parcial') THEN
        RAISE EXCEPTION 'El pedido está % y no puede ser anulado.', v_status;
    END IF;

    UPDATE pedido_items
    SET status = 'anulado'
    WHERE pedido_id = p_pedido_id AND status = 'pendiente';

    UPDATE pedidos
    SET status           = 'anulado',
        anulado_por      = p_anulado_por,
        anulado_at       = now(),
        motivo_anulacion = p_motivo
    WHERE id = p_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION anular_pedido(uuid, uuid, text) TO authenticated;
