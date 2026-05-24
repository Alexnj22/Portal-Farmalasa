-- ============================================================
-- Pedidos v2: dispatch_rules en preview, snapshots, completado, anular
-- ============================================================

-- ─── 1. Snapshot columns en pedido_items ─────────────────────────────────────
ALTER TABLE pedido_items
  ADD COLUMN IF NOT EXISTS stock_packs_snapshot  numeric,
  ADD COLUMN IF NOT EXISTS max_qty_snapshot      integer,
  ADD COLUMN IF NOT EXISTS min_qty_snapshot      integer,
  ADD COLUMN IF NOT EXISTS urgencia_pct_snapshot integer;

-- ─── 2. Add 'completado' to pedidos.status ───────────────────────────────────
ALTER TABLE pedidos DROP CONSTRAINT pedidos_status_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_status_check
  CHECK (status IN ('confirmado', 'parcial', 'completado', 'anulado'));

-- ─── 3. Rewrite get_pedido_preview (aplica dispatch_rules) ───────────────────
DROP FUNCTION IF EXISTS get_pedido_preview(integer[]);

CREATE FUNCTION get_pedido_preview(p_sucursal_ids integer[])
RETURNS TABLE (
  erp_sucursal_id      integer,
  erp_product_id       integer,
  erp_presentacion_id  integer,
  product_name         text,
  presentacion_tipo    text,
  factor               numeric,
  stock_packs          numeric,
  min_qty              integer,
  max_qty              integer,
  cantidad_reponer     integer,
  bodega_stock_packs   numeric,
  cantidad_asignada    integer,
  sin_stock            boolean,
  revision_minmax      boolean,
  urgencia_pct         integer,
  tiene_regla_despacho boolean,
  regla_multiplo       smallint,
  regla_blister        smallint,
  regla_solo_cajas     boolean
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH

  stock_sucursal AS (
    SELECT
      em.erp_sucursal_id,
      em.erp_product_id,
      em.erp_presentacion_id,
      em.min_qty,
      em.max_qty,
      pr.tipo                                     AS presentacion_tipo,
      COALESCE(pr.factor, 1)::numeric             AS factor,
      ROUND(
        COALESCE(
          SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false),
          0
        )::numeric / NULLIF(COALESCE(pr.factor, 1)::numeric, 0),
        2
      )                                            AS stock_pk
    FROM erp_minmax em
    JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
    LEFT JOIN inventory inv
           ON inv.erp_sucursal_id   = em.erp_sucursal_id
          AND inv.erp_product_id    = em.erp_product_id
    WHERE em.erp_sucursal_id = ANY(p_sucursal_ids)
      AND em.max_qty > 0
    GROUP BY
      em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
      em.min_qty, em.max_qty, pr.tipo, pr.factor
  ),

  necesidades AS (
    SELECT
      ss.*,
      GREATEST(0, ss.max_qty - FLOOR(ss.stock_pk))::integer AS reponer
    FROM stock_sucursal ss
    WHERE GREATEST(0, ss.max_qty - FLOOR(ss.stock_pk)) > 0
  ),

  bodega_raw AS (
    SELECT
      em.erp_product_id,
      em.erp_presentacion_id,
      COALESCE(pr.factor, 1)::numeric AS factor,
      COALESCE(
        SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false),
        0
      )::numeric AS bodega_units_ind
    FROM erp_minmax em
    JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
    LEFT JOIN inventory inv
           ON inv.erp_sucursal_id   = 6
          AND inv.erp_product_id    = em.erp_product_id
    WHERE em.erp_sucursal_id = 6
    GROUP BY em.erp_product_id, em.erp_presentacion_id, pr.factor
  ),

  bodega AS (
    SELECT
      erp_product_id,
      erp_presentacion_id,
      ROUND(bodega_units_ind / NULLIF(factor, 0), 2) AS bodega_pk
    FROM bodega_raw
  ),

  totales_por_producto AS (
    SELECT
      n.erp_product_id,
      n.erp_presentacion_id,
      SUM(n.reponer)             AS total_reponer,
      COALESCE(b.bodega_pk, 0)  AS bodega_disponible
    FROM necesidades n
    LEFT JOIN bodega b
           ON b.erp_product_id     = n.erp_product_id
          AND b.erp_presentacion_id = n.erp_presentacion_id
    GROUP BY n.erp_product_id, n.erp_presentacion_id, b.bodega_pk
  ),

  distribucion AS (
    SELECT
      n.erp_sucursal_id,
      n.erp_product_id,
      n.erp_presentacion_id,
      n.stock_pk,
      n.min_qty,
      n.max_qty,
      n.presentacion_tipo,
      n.factor,
      n.reponer,
      t.bodega_disponible,
      CASE
        WHEN t.bodega_disponible <= 0 THEN 0
        WHEN t.bodega_disponible >= t.total_reponer THEN n.reponer
        ELSE FLOOR(
          t.bodega_disponible
          * (n.reponer::numeric / NULLIF(t.total_reponer, 0))
        )
      END::integer AS asignado_raw
    FROM necesidades n
    JOIN totales_por_producto t
      ON t.erp_product_id     = n.erp_product_id
     AND t.erp_presentacion_id = n.erp_presentacion_id
  ),

  -- Aplica rondeo de dispatch_rules: multiplo primero, luego blister
  -- Formula: FLOOR(FLOOR(raw / mult) * mult / blist) * blist
  -- Columnas explícitas (no d.*) para evitar ambigüedad de erp_product_id al hacer JOIN
  con_reglas AS (
    SELECT
      d.erp_sucursal_id,
      d.erp_product_id,
      d.erp_presentacion_id,
      d.stock_pk,
      d.min_qty,
      d.max_qty,
      d.presentacion_tipo,
      d.factor,
      d.reponer,
      d.bodega_disponible,
      d.asignado_raw,
      (dr.erp_product_id IS NOT NULL)  AS tiene_regla,
      dr.multiplo                       AS regla_multiplo,
      dr.blister                        AS regla_blister,
      COALESCE(dr.solo_cajas, false)    AS regla_solo_cajas,
      CASE
        WHEN d.asignado_raw <= 0 OR d.bodega_disponible <= 0 THEN 0
        ELSE (
          FLOOR(
            FLOOR(d.asignado_raw::numeric / COALESCE(dr.multiplo, 1))
            * COALESCE(dr.multiplo, 1)::numeric
            / COALESCE(dr.blister, 1)
          ) * COALESCE(dr.blister, 1)
        )::integer
      END AS asignado_final
    FROM distribucion d
    LEFT JOIN dispatch_rules dr ON dr.erp_product_id = d.erp_product_id
  )

  SELECT
    cr.erp_sucursal_id,
    cr.erp_product_id,
    cr.erp_presentacion_id,
    p.nombre::text                                          AS product_name,
    cr.presentacion_tipo::text,
    cr.factor,
    ROUND(cr.stock_pk, 2)                                   AS stock_packs,
    cr.min_qty,
    cr.max_qty,
    cr.reponer::integer                                     AS cantidad_reponer,
    ROUND(cr.bodega_disponible, 2)                          AS bodega_stock_packs,
    cr.asignado_final                                       AS cantidad_asignada,
    (cr.bodega_disponible <= 0)                             AS sin_stock,
    -- revision: bodega tiene stock pero el rondeo dejó asignado en 0
    (cr.bodega_disponible > 0
     AND cr.asignado_final = 0
     AND cr.reponer > 0)                                    AS revision_minmax,
    LEAST(100,
      ROUND((cr.reponer::numeric / NULLIF(cr.max_qty, 0)) * 100)
    )::integer                                              AS urgencia_pct,
    COALESCE(cr.tiene_regla, false)                         AS tiene_regla_despacho,
    cr.regla_multiplo,
    cr.regla_blister,
    cr.regla_solo_cajas
  FROM con_reglas cr
  JOIN products p ON p.id = cr.erp_product_id
  ORDER BY cr.erp_sucursal_id, urgencia_pct DESC, p.nombre;
$$;

GRANT EXECUTE ON FUNCTION get_pedido_preview(integer[]) TO authenticated;


-- ─── 4. Rewrite confirm_pedido (snapshots + auto-cierre de items con qty=0) ───
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
  v_pedido_id uuid;
  v_item      jsonb;
  v_qty       integer;
BEGIN
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
      status, cantidad_recibida, received_at
    ) VALUES (
      v_pedido_id,
      (v_item->>'erp_sucursal_id')::integer,
      (v_item->>'erp_product_id')::integer,
      (v_item->>'erp_presentacion_id')::integer,
      v_qty,
      COALESCE((v_item->>'sin_stock')::boolean,      false),
      COALESCE((v_item->>'revision_minmax')::boolean, false),
      (v_item->>'stock_packs_snapshot')::numeric,
      (v_item->>'max_qty_snapshot')::integer,
      (v_item->>'min_qty_snapshot')::integer,
      (v_item->>'urgencia_pct_snapshot')::integer,
      -- Items con qty=0 no tienen nada que recepcionar → marcar recibido automáticamente
      CASE WHEN v_qty = 0 THEN 'recibido' ELSE 'pendiente' END,
      CASE WHEN v_qty = 0 THEN 0           ELSE NULL        END,
      CASE WHEN v_qty = 0 THEN now()       ELSE NULL        END
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_pedido(uuid, text, jsonb) TO authenticated;


-- ─── 5. Rewrite receive_pedido_sucursal (usa 'completado', nota_diferencia ok) ─
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
  v_item     jsonb;
  v_has_diff boolean;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT (pi.cantidad_asignada IS DISTINCT FROM (v_item->>'cantidad_recibida')::integer)
    INTO v_has_diff
    FROM pedido_items pi
    WHERE pi.id = (v_item->>'pedido_item_id')::integer;

    UPDATE pedido_items SET
      cantidad_recibida = (v_item->>'cantidad_recibida')::integer,
      nota_diferencia   = v_item->>'nota_diferencia',
      status            = CASE WHEN v_has_diff THEN 'con_diferencia' ELSE 'recibido' END,
      received_at       = now()
    WHERE id             = (v_item->>'pedido_item_id')::integer
      AND erp_sucursal_id = p_sucursal_id
      AND pedido_id       = p_pedido_id;
  END LOOP;

  -- Actualizar status del pedido
  IF NOT EXISTS (
    SELECT 1 FROM pedido_items
    WHERE pedido_id = p_pedido_id AND status = 'pendiente'
  ) THEN
    -- Todos resueltos: completado (sin diferencias) o parcial (con diferencias)
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
    -- Aún hay pendientes pero ya hay diferencias: marcamos parcial (en proceso)
    UPDATE pedidos SET status = 'parcial' WHERE id = p_pedido_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION receive_pedido_sucursal(uuid, integer, jsonb) TO authenticated;


-- ─── 6. Nueva RPC: anular_pedido ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION anular_pedido(p_pedido_id uuid)
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
  SET status = 'anulado'
  WHERE id = p_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION anular_pedido(uuid) TO authenticated;
