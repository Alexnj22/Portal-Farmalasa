-- ============================================================
-- Pedidos — Lifecycle tracking por sucursal
-- Registra tiempos y responsables de cada etapa del ciclo:
--   1. Generado    → pedidos.created_at / created_by  (ya existe)
--   2. Iniciado    → iniciado_at / iniciado_por       (por sucursal)
--   3. Finalizado  → finalizado_at / finalizado_por   (por sucursal)
--   4. Enviado     → pedidos.enviado_at / enviado_por (ya existe)
--   5. Recibido    → pedido_recepcion_firmas           (ya existe)
--   6. Recib. ERP  → recibido_erp_at / recibido_erp_por
-- ============================================================

CREATE TABLE IF NOT EXISTS pedido_sucursal_status (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id        UUID        NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    erp_sucursal_id  INTEGER     NOT NULL,

    iniciado_at      TIMESTAMPTZ,
    iniciado_por     UUID        REFERENCES employees(id) ON DELETE SET NULL,

    finalizado_at    TIMESTAMPTZ,
    finalizado_por   UUID        REFERENCES employees(id) ON DELETE SET NULL,

    recibido_erp_at  TIMESTAMPTZ,
    recibido_erp_por UUID        REFERENCES employees(id) ON DELETE SET NULL,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (pedido_id, erp_sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_pedido_suc_status_pedido
    ON pedido_sucursal_status (pedido_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE pedido_sucursal_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pss_select" ON pedido_sucursal_status
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "pss_insert" ON pedido_sucursal_status
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "pss_update" ON pedido_sucursal_status
    FOR UPDATE TO authenticated USING (true);


-- ── RPC: avanzar una etapa del lifecycle ─────────────────────
-- stage: 'iniciar' | 'finalizar' | 'recibir_erp'
-- Solo avanza si la etapa anterior está completa y la actual no lo está.

CREATE OR REPLACE FUNCTION update_pedido_sucursal_lifecycle(
    p_pedido_id     UUID,
    p_sucursal_id   INTEGER,
    p_stage         TEXT,
    p_user_id       UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Crear fila si no existe
    INSERT INTO pedido_sucursal_status (pedido_id, erp_sucursal_id)
    VALUES (p_pedido_id, p_sucursal_id)
    ON CONFLICT (pedido_id, erp_sucursal_id) DO NOTHING;

    IF p_stage = 'iniciar' THEN
        UPDATE pedido_sucursal_status
        SET iniciado_at  = NOW(),
            iniciado_por = p_user_id
        WHERE pedido_id       = p_pedido_id
          AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NULL;

    ELSIF p_stage = 'finalizar' THEN
        UPDATE pedido_sucursal_status
        SET finalizado_at  = NOW(),
            finalizado_por = p_user_id
        WHERE pedido_id       = p_pedido_id
          AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at     IS NOT NULL
          AND finalizado_at   IS NULL;

    ELSIF p_stage = 'recibir_erp' THEN
        UPDATE pedido_sucursal_status
        SET recibido_erp_at  = NOW(),
            recibido_erp_por = p_user_id
        WHERE pedido_id       = p_pedido_id
          AND erp_sucursal_id = p_sucursal_id
          AND recibido_erp_at IS NULL;

    ELSE
        RAISE EXCEPTION 'stage desconocido: %', p_stage;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION update_pedido_sucursal_lifecycle(uuid, integer, text, uuid)
    TO authenticated;
