-- ============================================================
-- pedido_recepcion_extras + get_pedido_item_stats (v2.2.256)
-- ============================================================

-- 1. Tabla pedido_recepcion_extras
CREATE TABLE IF NOT EXISTS pedido_recepcion_extras (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id        UUID        NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    erp_sucursal_id  INTEGER     NOT NULL,
    erp_product_id   INTEGER     NOT NULL,
    cantidad         INTEGER     NOT NULL DEFAULT 0,
    nota             TEXT,
    reported_by      UUID        REFERENCES employees(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pre_pedido ON pedido_recepcion_extras (pedido_id);
CREATE INDEX IF NOT EXISTS idx_pre_suc    ON pedido_recepcion_extras (pedido_id, erp_sucursal_id);

ALTER TABLE pedido_recepcion_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pre_all_auth" ON pedido_recepcion_extras
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. get_pedido_item_stats
DROP FUNCTION IF EXISTS get_pedido_item_stats(uuid[]);

CREATE OR REPLACE FUNCTION get_pedido_item_stats(p_pedido_ids uuid[])
RETURNS TABLE (
    pedido_id       UUID,
    erp_sucursal_id INTEGER,
    enviados        INT,
    sin_stock       INT,
    por_regla       INT,
    pendientes      INT,
    con_diferencia  INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        pedido_id,
        erp_sucursal_id,
        COUNT(*) FILTER (WHERE cantidad_asignada > 0)::INT     AS enviados,
        COUNT(*) FILTER (WHERE sin_stock = true)::INT          AS sin_stock,
        COUNT(*) FILTER (WHERE revision_minmax = true)::INT    AS por_regla,
        COUNT(*) FILTER (WHERE status = 'pendiente')::INT      AS pendientes,
        COUNT(*) FILTER (WHERE status = 'con_diferencia')::INT AS con_diferencia
    FROM pedido_items
    WHERE pedido_id = ANY(p_pedido_ids)
    GROUP BY pedido_id, erp_sucursal_id;
$$;

GRANT EXECUTE ON FUNCTION get_pedido_item_stats(uuid[]) TO authenticated;
