-- ============================================================
-- erp_sucursal_map: tabla de mapeo ERP sucursal_id ↔ branch_id
--
-- Reemplaza los VALUES hardcodeados en todas las funciones de pedidos.
-- Agregar una sucursal nueva = INSERT en esta tabla; cero cambios en SQL.
-- ============================================================

CREATE TABLE IF NOT EXISTS erp_sucursal_map (
  erp_sucursal_id integer PRIMARY KEY,
  branch_id       bigint  NOT NULL REFERENCES branches(id),
  nombre          text    NOT NULL,
  es_bodega       boolean NOT NULL DEFAULT false
);

INSERT INTO erp_sucursal_map (erp_sucursal_id, branch_id, nombre, es_bodega) VALUES
  (1,  4,  'Salud 1',    false),
  (2,  25, 'Salud 2',    false),
  (3,  27, 'Salud 3',    false),
  (4,  28, 'Salud 4',    false),
  (5,  2,  'La Popular', false),
  (6,  30, 'Bodega',     true),
  (7,  29, 'Salud 5',    false)
ON CONFLICT (erp_sucursal_id) DO NOTHING;

GRANT SELECT ON erp_sucursal_map TO authenticated;
