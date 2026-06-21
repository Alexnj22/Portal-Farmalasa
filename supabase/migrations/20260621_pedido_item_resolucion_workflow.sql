-- ============================================================
-- Pedido item resolution workflow v2.2.257
-- 1. Columnas resolución en pedido_items (por ítem)
-- 2. Tabla pedido_item_eventos — historial completo de actividad
-- 3. RPC resolve_pedido_item: proponer | confirmar | rechazar
-- ============================================================

-- ── 1. Columnas resolución en pedido_items ────────────────────
ALTER TABLE pedido_items
    ADD COLUMN IF NOT EXISTS resolucion_status  TEXT,
    ADD COLUMN IF NOT EXISTS resolucion_tipo    TEXT,
    ADD COLUMN IF NOT EXISTS resolucion_nota    TEXT,
    ADD COLUMN IF NOT EXISTS resuelto_por       UUID REFERENCES employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS resuelto_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmado_suc_por UUID REFERENCES employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS confirmado_suc_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rechazado_por      UUID REFERENCES employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rechazado_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS nota_rechazo       TEXT;

-- ── 2. Historial de actividad por ítem ───────────────────────
CREATE TABLE IF NOT EXISTS pedido_item_eventos (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_item_id   INTEGER     NOT NULL REFERENCES pedido_items(id)  ON DELETE CASCADE,
    pedido_id        UUID        NOT NULL REFERENCES pedidos(id)        ON DELETE CASCADE,
    erp_sucursal_id  INTEGER     NOT NULL,
    tipo             TEXT        NOT NULL,
    resolucion_tipo  TEXT,
    nota             TEXT,
    hecho_por        UUID        REFERENCES employees(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pie_pedido ON pedido_item_eventos (pedido_id, erp_sucursal_id);
CREATE INDEX IF NOT EXISTS idx_pie_item   ON pedido_item_eventos (pedido_item_id);

ALTER TABLE pedido_item_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pie_all_auth" ON pedido_item_eventos
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. RPC resolve_pedido_item ────────────────────────────────
CREATE OR REPLACE FUNCTION resolve_pedido_item(
    p_item_id  INTEGER,
    p_action   TEXT,
    p_user_id  UUID    DEFAULT NULL,
    p_tipo     TEXT    DEFAULT NULL,
    p_nota     TEXT    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pedido_id UUID;
    v_suc_id    INTEGER;
    v_cur_res   TEXT;
BEGIN
    SELECT pedido_id, erp_sucursal_id, resolucion_status
    INTO   v_pedido_id, v_suc_id, v_cur_res
    FROM   pedido_items WHERE id = p_item_id FOR UPDATE;

    IF v_pedido_id IS NULL THEN
        RAISE EXCEPTION 'Item no encontrado.';
    END IF;

    IF p_action = 'proponer' THEN
        UPDATE pedido_items SET
            resolucion_status  = 'propuesta',
            resolucion_tipo    = p_tipo,
            resolucion_nota    = NULLIF(TRIM(COALESCE(p_nota, '')), ''),
            resuelto_por       = p_user_id,
            resuelto_at        = NOW(),
            rechazado_por      = NULL,
            rechazado_at       = NULL,
            nota_rechazo       = NULL,
            confirmado_suc_por = NULL,
            confirmado_suc_at  = NULL
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_propuesta',
             p_tipo, NULLIF(TRIM(COALESCE(p_nota, '')), ''), p_user_id);

    ELSIF p_action = 'confirmar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede confirmar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status  = 'confirmada',
            confirmado_suc_por = p_user_id,
            confirmado_suc_at  = NOW()
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_confirmada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), p_user_id);

        IF NOT EXISTS (
            SELECT 1 FROM pedido_items
            WHERE  pedido_id = v_pedido_id
              AND  status = 'con_diferencia'
              AND  (resolucion_status IS NULL OR resolucion_status IN ('propuesta', 'rechazada'))
        ) THEN
            UPDATE pedidos SET status = 'completado' WHERE id = v_pedido_id;
            UPDATE pedido_sucursal_status
               SET confirmado_correccion_at  = NOW(),
                   confirmado_correccion_por = p_user_id
             WHERE pedido_id = v_pedido_id AND erp_sucursal_id = v_suc_id;
        END IF;

    ELSIF p_action = 'rechazar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede rechazar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status = 'rechazada',
            rechazado_por     = p_user_id,
            rechazado_at      = NOW(),
            nota_rechazo      = NULLIF(TRIM(COALESCE(p_nota, '')), '')
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_rechazada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), p_user_id);

    ELSE
        RAISE EXCEPTION 'Acción desconocida: %', p_action;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_pedido_item(integer, text, uuid, text, text) TO authenticated;
