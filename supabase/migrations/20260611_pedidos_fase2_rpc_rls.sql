-- ============================================================
-- Pedidos FASE 2 — Integridad de RPCs + RLS
--
-- 2.1  receive_pedido_sucursal: guards contra pedido anulado/completado
--      y contra items que ya no están pendientes.
-- 2.2  anular_pedido: nuevas columnas anulado_por/anulado_at/motivo_anulacion
--      + parámetros opcionales para registrar quién anuló y por qué.
-- 2.3  confirm_pedido: validación de inputs (array no vacío,
--      cantidad_asignada >= 0, sucursal válida).
-- 2.4  RLS en pedidos, pedido_items, dispatch_rules.
-- ============================================================


-- ── 2.2a Columnas de trazabilidad de anulación ──────────────

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS anulado_por      uuid,
  ADD COLUMN IF NOT EXISTS anulado_at       timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_anulacion text;


-- ── 2.1 receive_pedido_sucursal con guards ───────────────────

CREATE OR REPLACE FUNCTION receive_pedido_sucursal(
  p_pedido_id   uuid,
  p_sucursal_id integer,
  p_items       jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status   text;
  v_item     jsonb;
  v_has_diff boolean;
BEGIN
  SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_status IN ('anulado', 'completado') THEN
    RAISE EXCEPTION 'El pedido ya está % y no puede ser modificado.', v_status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT (pi.cantidad_asignada IS DISTINCT FROM (v_item->>'cantidad_recibida')::integer)
    INTO v_has_diff
    FROM pedido_items pi
    WHERE pi.id             = (v_item->>'pedido_item_id')::integer
      AND pi.erp_sucursal_id = p_sucursal_id
      AND pi.pedido_id       = p_pedido_id
      AND pi.status          = 'pendiente';

    -- Si no encontró fila pendiente, skip (item ya procesado o inválido)
    CONTINUE WHEN v_has_diff IS NULL;

    UPDATE pedido_items SET
      cantidad_recibida = (v_item->>'cantidad_recibida')::integer,
      nota_diferencia   = v_item->>'nota_diferencia',
      status            = CASE WHEN v_has_diff THEN 'con_diferencia' ELSE 'recibido' END,
      received_at       = now()
    WHERE id              = (v_item->>'pedido_item_id')::integer
      AND erp_sucursal_id = p_sucursal_id
      AND pedido_id       = p_pedido_id
      AND status          = 'pendiente';
  END LOOP;

  -- Actualizar status del pedido
  IF NOT EXISTS (
    SELECT 1 FROM pedido_items
    WHERE pedido_id = p_pedido_id AND status = 'pendiente'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pedido_items
      WHERE pedido_id = p_pedido_id AND status = 'con_diferencia'
    ) THEN
      UPDATE pedidos SET status = 'parcial'    WHERE id = p_pedido_id;
    ELSE
      UPDATE pedidos SET status = 'completado' WHERE id = p_pedido_id;
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM pedido_items
    WHERE pedido_id = p_pedido_id AND status = 'con_diferencia'
  ) THEN
    UPDATE pedidos SET status = 'parcial' WHERE id = p_pedido_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION receive_pedido_sucursal(uuid, integer, jsonb) TO authenticated;


-- ── 2.2 anular_pedido con trazabilidad ──────────────────────

CREATE OR REPLACE FUNCTION anular_pedido(
  p_pedido_id  uuid,
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

  IF v_status IN ('completado', 'anulado') THEN
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

-- Mantener compatibilidad con firma anterior (sin parámetros extra)
GRANT EXECUTE ON FUNCTION anular_pedido(uuid, uuid, text) TO authenticated;


-- ── 2.3 confirm_pedido con validación de inputs ──────────────

CREATE OR REPLACE FUNCTION confirm_pedido(
  p_created_by  uuid,
  p_notes       text,
  p_items       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pedido_id   uuid;
  v_item        jsonb;
  v_qty         integer;
  v_suc_valid   boolean;
BEGIN
  -- Validar array no vacío
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un ítem.';
  END IF;

  -- Validar cada ítem antes de insertar
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'cantidad_asignada')::integer, 0);

    IF v_qty < 0 THEN
      RAISE EXCEPTION 'cantidad_asignada no puede ser negativa (product_id=%).', v_item->>'erp_product_id';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM erp_sucursal_map
      WHERE erp_sucursal_id = (v_item->>'erp_sucursal_id')::integer
    ) INTO v_suc_valid;

    IF NOT v_suc_valid THEN
      RAISE EXCEPTION 'erp_sucursal_id % no existe.', v_item->>'erp_sucursal_id';
    END IF;
  END LOOP;

  -- Insertar pedido
  INSERT INTO pedidos (created_by, notes)
  VALUES (p_created_by, p_notes)
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'cantidad_asignada')::integer, 0);

    INSERT INTO pedido_items (
      pedido_id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
      cantidad_asignada, sin_stock, revision_minmax,
      stock_packs_snapshot, max_qty_snapshot, min_qty_snapshot, urgencia_pct_snapshot,
      lotes_asignados,
      status, cantidad_recibida, received_at
    ) VALUES (
      v_pedido_id,
      (v_item->>'erp_sucursal_id')::integer,
      (v_item->>'erp_product_id')::integer,
      (v_item->>'erp_presentacion_id')::integer,
      v_qty,
      COALESCE((v_item->>'sin_stock')::boolean,       false),
      COALESCE((v_item->>'revision_minmax')::boolean,  false),
      (v_item->>'stock_packs_snapshot')::numeric,
      (v_item->>'max_qty_snapshot')::integer,
      (v_item->>'min_qty_snapshot')::integer,
      (v_item->>'urgencia_pct_snapshot')::integer,
      CASE WHEN v_qty > 0 THEN (v_item->'lotes_asignados') ELSE NULL END,
      CASE WHEN v_qty = 0 THEN 'recibido' ELSE 'pendiente' END,
      CASE WHEN v_qty = 0 THEN 0           ELSE NULL        END,
      CASE WHEN v_qty = 0 THEN now()       ELSE NULL        END
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_pedido(uuid, text, jsonb) TO authenticated;


-- ── 2.4 RLS ─────────────────────────────────────────────────

-- pedidos: lectura pública para autenticados; escritura solo vía RPCs SECURITY DEFINER
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedidos_select"    ON pedidos;
DROP POLICY IF EXISTS "pedidos_no_insert" ON pedidos;
DROP POLICY IF EXISTS "pedidos_no_update" ON pedidos;
DROP POLICY IF EXISTS "pedidos_no_delete" ON pedidos;

CREATE POLICY "pedidos_select" ON pedidos
  FOR SELECT TO authenticated USING (true);

-- pedido_items: lectura pública para autenticados; escritura solo vía RPCs
ALTER TABLE pedido_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedido_items_select" ON pedido_items;

CREATE POLICY "pedido_items_select" ON pedido_items
  FOR SELECT TO authenticated USING (true);

-- dispatch_rules: acceso completo para autenticados (TabReglas la gestiona directo)
ALTER TABLE dispatch_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dispatch_rules_all" ON dispatch_rules;

CREATE POLICY "dispatch_rules_all" ON dispatch_rules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
