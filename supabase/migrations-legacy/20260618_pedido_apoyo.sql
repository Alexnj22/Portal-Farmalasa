-- ============================================================
-- pedido_apoyo — empleados que apoyaron un despacho
-- Escaneados con lector de carnet durante preparación.
-- ============================================================

CREATE TABLE IF NOT EXISTS pedido_apoyo (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id       UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    erp_sucursal_id INT  NOT NULL,
    employee_id     UUID NOT NULL REFERENCES employees(id),
    registered_by   UUID REFERENCES employees(id),
    registered_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Un mismo empleado no puede aparecer dos veces en el mismo despacho por sucursal
CREATE UNIQUE INDEX IF NOT EXISTS pedido_apoyo_unique
    ON pedido_apoyo(pedido_id, erp_sucursal_id, employee_id);

-- Índice para buscar rápido por pedido
CREATE INDEX IF NOT EXISTS pedido_apoyo_pedido_idx
    ON pedido_apoyo(pedido_id, erp_sucursal_id);
