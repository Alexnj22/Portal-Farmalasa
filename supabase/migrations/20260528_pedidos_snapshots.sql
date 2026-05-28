-- ============================================================
-- pedidos_snapshots: historial de pedidos generados
-- Permite reproducir el estado del pedido en cualquier momento pasado.
-- ============================================================

CREATE TABLE IF NOT EXISTS pedidos_snapshots (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text        NOT NULL,
  sucursal_ids   integer[]   NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        REFERENCES auth.users(id),
  total_filas    integer     NOT NULL DEFAULT 0,
  total_packs    integer     NOT NULL DEFAULT 0,
  datos          jsonb       NOT NULL
);

ALTER TABLE pedidos_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_select" ON pedidos_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "snapshots_insert" ON pedidos_snapshots
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "snapshots_delete" ON pedidos_snapshots
  FOR DELETE TO authenticated USING (created_by = auth.uid());

CREATE OR REPLACE FUNCTION save_pedido_snapshot(
  p_sucursal_ids integer[],
  p_nombre       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id          uuid;
  v_datos       jsonb;
  v_total_filas integer;
  v_total_packs integer;
BEGIN
  SELECT
    jsonb_agg(row_to_json(r)),
    COUNT(*)::integer,
    COALESCE(SUM(r.cantidad_asignada), 0)::integer
  INTO v_datos, v_total_filas, v_total_packs
  FROM get_pedido_preview(p_sucursal_ids) r;

  INSERT INTO pedidos_snapshots (nombre, sucursal_ids, created_by, total_filas, total_packs, datos)
  VALUES (p_nombre, p_sucursal_ids, auth.uid(), v_total_filas, v_total_packs, COALESCE(v_datos, '[]'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION save_pedido_snapshot(integer[], text) TO authenticated;
