-- ============================================================
-- Pedidos — Extended lifecycle v2: pause/resume + codigo
-- ============================================================

-- 1. New columns on pedido_sucursal_status
ALTER TABLE pedido_sucursal_status
  ADD COLUMN IF NOT EXISTS codigo       TEXT,
  ADD COLUMN IF NOT EXISTS pausado_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pausa_razon  TEXT,
  ADD COLUMN IF NOT EXISTS reanudado_at TIMESTAMPTZ;

-- 2. Drop old function (adding a param requires DROP + CREATE)
DROP FUNCTION IF EXISTS update_pedido_sucursal_lifecycle(uuid, integer, text, uuid);

-- 3. Recreate with p_razon + new stages: pausar, reanudar
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
        -- Allow re-pause after resume (overwrites last pause)
        UPDATE pedido_sucursal_status
        SET pausado_at  = NOW(), pausa_razon = p_razon, reanudado_at = NULL
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL;

    ELSIF p_stage = 'reanudar' THEN
        UPDATE pedido_sucursal_status
        SET reanudado_at = NOW()
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND pausado_at IS NOT NULL AND reanudado_at IS NULL
          AND finalizado_at IS NULL;

    ELSIF p_stage = 'finalizar' THEN
        -- Cannot finalize if currently paused
        UPDATE pedido_sucursal_status
        SET finalizado_at = NOW(), finalizado_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL
          AND (pausado_at IS NULL OR reanudado_at IS NOT NULL);

    ELSIF p_stage = 'recibir_erp' THEN
        UPDATE pedido_sucursal_status
        SET recibido_erp_at = NOW(), recibido_erp_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND recibido_erp_at IS NULL;

    ELSE
        RAISE EXCEPTION 'stage desconocido: %', p_stage;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION update_pedido_sucursal_lifecycle(uuid, integer, text, uuid, text)
    TO authenticated;

-- 4. RPC to store codigos right after confirm_pedido
CREATE OR REPLACE FUNCTION init_pedido_sucursal_codigos(
    p_pedido_id UUID,
    p_codigos   JSONB   -- [{erp_sucursal_id, codigo}]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item JSONB;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(p_codigos)
    LOOP
        INSERT INTO pedido_sucursal_status (pedido_id, erp_sucursal_id, codigo)
        VALUES (
            p_pedido_id,
            (item->>'erp_sucursal_id')::INTEGER,
            item->>'codigo'
        )
        ON CONFLICT (pedido_id, erp_sucursal_id) DO UPDATE
            SET codigo = EXCLUDED.codigo
            WHERE pedido_sucursal_status.codigo IS NULL;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION init_pedido_sucursal_codigos(uuid, jsonb)
    TO authenticated;
