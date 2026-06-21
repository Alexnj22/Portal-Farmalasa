-- ============================================================
-- Pedidos — Workflow diferencias/corrección v2.2.255
--
-- 1. Columnas diferencias/corrección en pedido_sucursal_status
-- 2. update_pedido_sucursal_lifecycle: agrega p_nota + stages:
--    reportar_diferencias | corregir_bodega | confirmar_correccion
-- 3. get_pedidos_en_curso v6 — devuelve las nuevas columnas
-- ============================================================

-- ── 1. Nuevas columnas ───────────────────────────────────────
ALTER TABLE pedido_sucursal_status
    ADD COLUMN IF NOT EXISTS diferencias_reportadas_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS diferencias_reportadas_por UUID REFERENCES employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS corregido_bodega_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS corregido_bodega_por       UUID REFERENCES employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS corregido_bodega_nota      TEXT,
    ADD COLUMN IF NOT EXISTS confirmado_correccion_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmado_correccion_por  UUID REFERENCES employees(id) ON DELETE SET NULL;

-- ── 2. Lifecycle RPC v3 — nuevos stages + p_nota ─────────────
DROP FUNCTION IF EXISTS update_pedido_sucursal_lifecycle(uuid, integer, text, uuid, text);

CREATE OR REPLACE FUNCTION update_pedido_sucursal_lifecycle(
    p_pedido_id   UUID,
    p_sucursal_id INTEGER,
    p_stage       TEXT,
    p_user_id     UUID   DEFAULT NULL,
    p_razon       TEXT   DEFAULT NULL,
    p_nota        TEXT   DEFAULT NULL
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
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN RETURN; END IF;
        UPDATE pedido_sucursal_status
        SET pausado_at = NOW(), pausa_razon = p_razon, reanudado_at = NULL
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL;
        INSERT INTO pedido_pausa_historial
            (pedido_id, erp_sucursal_id, pausado_at, razon, pausado_por)
        VALUES (p_pedido_id, p_sucursal_id, NOW(), p_razon, p_user_id);

    ELSIF p_stage = 'reanudar' THEN
        UPDATE pedido_pausa_historial
        SET reanudado_at = NOW()
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND reanudado_at IS NULL;
        UPDATE pedido_sucursal_status
        SET reanudado_at = NOW()
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND pausado_at IS NOT NULL AND reanudado_at IS NULL AND finalizado_at IS NULL;

    ELSIF p_stage = 'finalizar' THEN
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
        UPDATE pedido_sucursal_status
        SET llegada_fisica_at  = NOW(), llegada_fisica_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND llegada_fisica_at IS NULL;

    ELSIF p_stage = 'recibir_erp' THEN
        UPDATE pedido_sucursal_status
        SET recibido_erp_at  = NOW(), recibido_erp_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND recibido_erp_at IS NULL;

    ELSIF p_stage = 'reportar_diferencias' THEN
        UPDATE pedido_sucursal_status
        SET diferencias_reportadas_at  = NOW(),
            diferencias_reportadas_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'corregir_bodega' THEN
        UPDATE pedido_sucursal_status
        SET corregido_bodega_at   = NOW(),
            corregido_bodega_por  = p_user_id,
            corregido_bodega_nota = p_nota
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'confirmar_correccion' THEN
        UPDATE pedido_sucursal_status
        SET confirmado_correccion_at  = NOW(),
            confirmado_correccion_por = p_user_id
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSE
        RAISE EXCEPTION 'stage desconocido: %', p_stage;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION update_pedido_sucursal_lifecycle(uuid, integer, text, uuid, text, text) TO authenticated;

-- ── 3. get_pedidos_en_curso v6 ────────────────────────────────
DROP FUNCTION IF EXISTS get_pedidos_en_curso();

CREATE OR REPLACE FUNCTION get_pedidos_en_curso()
RETURNS TABLE (
    pedido_id                   UUID,
    numero                      INT,
    codigo                      TEXT,
    notes                       TEXT,
    pedido_status               TEXT,
    created_at                  TIMESTAMPTZ,
    enviado_at                  TIMESTAMPTZ,
    erp_sucursal_id             INT,
    iniciado_at                 TIMESTAMPTZ,
    finalizado_at               TIMESTAMPTZ,
    pausado_at                  TIMESTAMPTZ,
    reanudado_at                TIMESTAMPTZ,
    llegada_fisica_at           TIMESTAMPTZ,
    recibido_erp_at             TIMESTAMPTZ,
    diferencias_reportadas_at   TIMESTAMPTZ,
    diferencias_reportadas_por  UUID,
    corregido_bodega_at         TIMESTAMPTZ,
    corregido_bodega_por        UUID,
    corregido_bodega_nota       TEXT,
    confirmado_correccion_at    TIMESTAMPTZ,
    confirmado_correccion_por   UUID,
    min_pausado_total           INT,
    created_by                  UUID,
    iniciado_por                UUID,
    finalizado_por              UUID,
    enviado_por                 UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        p.id                                   AS pedido_id,
        p.numero,
        pss.codigo,
        p.notes,
        p.status                               AS pedido_status,
        p.created_at,
        p.enviado_at,
        pss.erp_sucursal_id,
        pss.iniciado_at,
        pss.finalizado_at,
        pss.pausado_at,
        pss.reanudado_at,
        pss.llegada_fisica_at,
        pss.recibido_erp_at,
        pss.diferencias_reportadas_at,
        pss.diferencias_reportadas_por,
        pss.corregido_bodega_at,
        pss.corregido_bodega_por,
        pss.corregido_bodega_nota,
        pss.confirmado_correccion_at,
        pss.confirmado_correccion_por,
        COALESCE(
            (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at)) / 60)::INT
             FROM   pedido_pausa_historial pph
             WHERE  pph.pedido_id       = p.id
               AND  pph.erp_sucursal_id = pss.erp_sucursal_id),
            0
        )                                      AS min_pausado_total,
        p.created_by,
        pss.iniciado_por,
        pss.finalizado_por,
        p.enviado_por
    FROM   pedidos p
    JOIN   pedido_sucursal_status pss ON pss.pedido_id = p.id
    WHERE  p.status <> 'anulado'
    ORDER BY
        CASE WHEN p.status IN ('completado', 'parcial') THEN 1 ELSE 0 END,
        p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_pedidos_en_curso() TO authenticated;
