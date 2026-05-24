-- ============================================================
-- Módulo: Generación de Pedidos (Bodega → Sucursales)
-- ============================================================
-- Fuentes de datos ya existentes:
--   erp_minmax          → min_qty, max_qty por (sucursal, producto, presentación)
--   inventory           → stock actual en unidades individuales
--   presentaciones      → factor de conversión (und. individuales → packs comerciales)
-- Fórmula:
--   stock_packs      = SUM(inventory.cantidad) / presentaciones.factor
--   cantidad_reponer = GREATEST(0, max_qty - stock_packs)


-- ─── 1. Reglas de despacho por producto ──────────────────────────────────────
-- Migración de las reglas del Google Sheets (solo cajas, múltiplos, blíster).
-- Una fila por producto; nullable = sin restricción para ese campo.

CREATE TABLE dispatch_rules (
  id              serial      PRIMARY KEY,
  erp_product_id  integer     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  solo_cajas      boolean     NOT NULL DEFAULT false,
  multiplo        smallint    CHECK (multiplo > 0),   -- enviar en múltiplos de N packs
  blister         smallint    CHECK (blister  > 0),   -- enviar en múltiplos de N blisters
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (erp_product_id)
);

CREATE INDEX idx_dispatch_rules_product ON dispatch_rules (erp_product_id);

COMMENT ON TABLE dispatch_rules IS
  'Reglas de despacho por producto. Migradas desde Google Sheets. '
  'solo_cajas=true: solo cajas completas. multiplo=N: cantidades múltiplo de N. '
  'blister=N: múltiplo de N blísters.';


-- ─── 2. Pedidos (cabecera) ────────────────────────────────────────────────────

CREATE SEQUENCE pedidos_numero_seq START 1;

CREATE TABLE pedidos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero      integer     NOT NULL DEFAULT nextval('pedidos_numero_seq') UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  integer     REFERENCES employees(id) ON DELETE SET NULL,
  status      text        NOT NULL DEFAULT 'confirmado'
              CHECK (status IN ('confirmado', 'parcial', 'anulado')),
  notes       text
);

CREATE INDEX idx_pedidos_created_at ON pedidos (created_at DESC);
CREATE INDEX idx_pedidos_status     ON pedidos (status);

COMMENT ON TABLE pedidos IS
  'Cabecera de un pedido de reposición generado desde Bodega. '
  'status=confirmado: generado. parcial: alguna sucursal con diferencia. anulado: cancelado.';


-- ─── 3. Items del pedido ──────────────────────────────────────────────────────
-- Una fila por (pedido × sucursal × producto × presentación).

CREATE TABLE pedido_items (
  id                  serial      PRIMARY KEY,
  pedido_id           uuid        NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  erp_sucursal_id     integer     NOT NULL,
  erp_product_id      integer     NOT NULL REFERENCES products(id),
  erp_presentacion_id integer     REFERENCES presentaciones(id),

  -- Cantidades en packs comerciales (misma unidad que erp_minmax.max_qty)
  cantidad_asignada   integer     NOT NULL,         -- calculada en el preview
  cantidad_recibida   integer,                      -- confirmada por la sucursal

  sin_stock           boolean     NOT NULL DEFAULT false,  -- bodega no tenía nada
  revision_minmax     boolean     NOT NULL DEFAULT false,  -- no alcanzó un pack completo

  status              text        NOT NULL DEFAULT 'pendiente'
                      CHECK (status IN ('pendiente','recibido','con_diferencia','anulado')),
  nota_diferencia     text,       -- libre si cantidad_recibida ≠ cantidad_asignada
  received_at         timestamptz
);

CREATE INDEX idx_pedido_items_pedido    ON pedido_items (pedido_id);
CREATE INDEX idx_pedido_items_sucursal  ON pedido_items (erp_sucursal_id);
CREATE INDEX idx_pedido_items_product   ON pedido_items (erp_product_id);

COMMENT ON TABLE pedido_items IS
  'Detalle por producto/presentación/sucursal de un pedido. '
  'cantidad_asignada en packs comerciales (misma unidad que erp_minmax.max_qty). '
  'sin_stock=true cuando bodega no puede cubrir nada. '
  'revision_minmax=true cuando el asignado no alcanza un pack completo (regla 40%).';


-- ─── 4. RPC: preview del pedido ───────────────────────────────────────────────
-- Calcula las cantidades a enviar sin guardar nada.
-- Entrada : array de erp_sucursal_id a incluir (excluyendo Bodega = 6).
-- Retorna : una fila por (sucursal × producto × presentación) con necesidad y
--           cantidad que bodega puede asignar tras distribución proporcional.

CREATE OR REPLACE FUNCTION get_pedido_preview(p_sucursal_ids integer[])
RETURNS TABLE (
  erp_sucursal_id     integer,
  erp_product_id      integer,
  erp_presentacion_id integer,
  product_name        text,
  presentacion_tipo   text,
  factor              numeric,

  -- Stock de la sucursal en packs comerciales
  stock_packs         numeric,
  min_qty             integer,
  max_qty             integer,

  -- Necesidad teórica (max - stock_packs), nunca negativo
  cantidad_reponer    integer,

  -- Stock disponible en Bodega para este producto (en packs)
  bodega_stock_packs  numeric,

  -- Asignación final tras distribución (≥ 0, en packs)
  cantidad_asignada   integer,

  -- Flags
  sin_stock           boolean,
  revision_minmax     boolean,

  -- % de urgencia: cuán lejos está del MAX (0–100)
  urgencia_pct        integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- ── Paso 1: necesidades por sucursal ───────────────────────────────────────
  -- (stock actual de bodega) se calcula UNA vez por producto para distribución

  RETURN QUERY
  WITH

  -- Stock de cada sucursal seleccionada por (erp_product_id, erp_presentacion_id)
  -- inventory.cantidad está en unidades individuales → dividimos por factor
  stock_sucursal AS (
    SELECT
      em.erp_sucursal_id,
      em.erp_product_id,
      em.erp_presentacion_id,
      em.min_qty,
      em.max_qty,
      pr.tipo                                    AS presentacion_tipo,
      COALESCE(pr.factor, 1)::numeric            AS factor,
      -- Suma de unidades individuales en inventario (no vencidos)
      COALESCE(
        SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false),
        0
      )::numeric                                 AS total_units_ind,
      -- Stock en packs = und. individuales / factor
      ROUND(
        COALESCE(
          SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false),
          0
        )::numeric / NULLIF(COALESCE(pr.factor, 1)::numeric, 0),
        2
      )                                           AS stock_pk
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

  -- Solo las que tienen necesidad real (stock < max)
  necesidades AS (
    SELECT
      ss.*,
      GREATEST(0, ss.max_qty - FLOOR(ss.stock_pk))::integer AS reponer
    FROM stock_sucursal ss
    WHERE GREATEST(0, ss.max_qty - FLOOR(ss.stock_pk)) > 0
  ),

  -- Stock de Bodega (erp_sucursal_id = 6) por producto (agregado, en unidades ind.)
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

  -- Stock de Bodega en packs
  bodega AS (
    SELECT
      erp_product_id,
      erp_presentacion_id,
      ROUND(bodega_units_ind / NULLIF(factor, 0), 2) AS bodega_pk
    FROM bodega_raw
  ),

  -- Totales por producto: suma de lo que necesitan todas las sucursales
  totales_por_producto AS (
    SELECT
      n.erp_product_id,
      n.erp_presentacion_id,
      SUM(n.reponer) AS total_reponer,
      COALESCE(b.bodega_pk, 0) AS bodega_disponible
    FROM necesidades n
    LEFT JOIN bodega b
           ON b.erp_product_id    = n.erp_product_id
          AND b.erp_presentacion_id = n.erp_presentacion_id
    GROUP BY n.erp_product_id, n.erp_presentacion_id, b.bodega_pk
  ),

  -- Distribución proporcional cuando bodega no alcanza
  -- Si bodega >= total: cada sucursal recibe su reponer completo.
  -- Si bodega < total: se distribuye proporcionalmente según urgencia (% déficit).
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
        -- Bodega sin stock → sin_stock
        WHEN t.bodega_disponible <= 0 THEN 0

        -- Bodega cubre todo → asignar reponer completo
        WHEN t.bodega_disponible >= t.total_reponer THEN n.reponer

        -- Distribución proporcional: cada sucursal recibe su % del disponible,
        -- redondeado hacia abajo a packs completos
        ELSE FLOOR(
          t.bodega_disponible
          * (n.reponer::numeric / NULLIF(t.total_reponer, 0))
        )
      END::integer AS asignado_raw

    FROM necesidades n
    JOIN totales_por_producto t
      ON t.erp_product_id     = n.erp_product_id
     AND t.erp_presentacion_id = n.erp_presentacion_id
  )

  -- ── Resultado final ─────────────────────────────────────────────────────────
  SELECT
    d.erp_sucursal_id,
    d.erp_product_id,
    d.erp_presentacion_id,
    p.nombre::text                                        AS product_name,
    d.presentacion_tipo::text,
    d.factor,
    ROUND(d.stock_pk, 2)                                  AS stock_packs,
    d.min_qty,
    d.max_qty,
    d.reponer::integer                                    AS cantidad_reponer,
    ROUND(d.bodega_disponible, 2)                         AS bodega_stock_packs,

    -- cantidad_asignada: aplicar regla 40% → si < 0.4 pack → 0 (revision_minmax)
    CASE WHEN d.asignado_raw > 0 AND d.bodega_disponible > 0 THEN d.asignado_raw
         ELSE 0
    END::integer                                          AS cantidad_asignada,

    -- sin_stock: bodega no tiene nada de este producto
    (d.bodega_disponible <= 0)                            AS sin_stock,

    -- revision_minmax: bodega tenía algo pero no alcanza un pack completo
    (d.bodega_disponible > 0 AND d.asignado_raw = 0
     AND d.reponer > 0)                                   AS revision_minmax,

    -- urgencia: qué tan debajo del MAX está (0=stock=max, 100=stock=0)
    LEAST(100,
      ROUND(
        (d.reponer::numeric / NULLIF(d.max_qty, 0)) * 100
      )
    )::integer                                            AS urgencia_pct

  FROM distribucion d
  JOIN products p ON p.id = d.erp_product_id
  ORDER BY d.erp_sucursal_id, urgencia_pct DESC, p.nombre;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pedido_preview(integer[]) TO authenticated;
COMMENT ON FUNCTION get_pedido_preview IS
  'Preview del pedido sin guardar. Calcula stock_packs = inventory / factor, '
  'cantidad_reponer = max - stock_packs, y distribuye el stock de Bodega '
  'proporcionalmente entre las sucursales seleccionadas. '
  'Regla 40%: si asignado < 0.4 pack → revision_minmax=true, asignado=0.';


-- ─── 5. RPC: confirmar y guardar pedido ───────────────────────────────────────
-- Recibe el resultado ya revisado/ajustado desde el frontend y lo persiste.

CREATE OR REPLACE FUNCTION confirm_pedido(
  p_created_by  integer,
  p_notes       text,
  p_items       jsonb    -- [{erp_sucursal_id, erp_product_id, erp_presentacion_id,
                         --   cantidad_asignada, sin_stock, revision_minmax}]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pedido_id uuid;
  v_item      jsonb;
BEGIN
  -- Crear cabecera
  INSERT INTO pedidos (created_by, notes)
  VALUES (p_created_by, p_notes)
  RETURNING id INTO v_pedido_id;

  -- Insertar items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO pedido_items (
      pedido_id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
      cantidad_asignada, sin_stock, revision_minmax
    ) VALUES (
      v_pedido_id,
      (v_item->>'erp_sucursal_id')::integer,
      (v_item->>'erp_product_id')::integer,
      (v_item->>'erp_presentacion_id')::integer,
      (v_item->>'cantidad_asignada')::integer,
      COALESCE((v_item->>'sin_stock')::boolean,    false),
      COALESCE((v_item->>'revision_minmax')::boolean, false)
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_pedido(integer, text, jsonb) TO authenticated;
COMMENT ON FUNCTION confirm_pedido IS
  'Persiste un pedido ya revisado. Retorna el uuid del pedido creado.';


-- ─── 6. RPC: confirmar recepción de una sucursal ─────────────────────────────

CREATE OR REPLACE FUNCTION receive_pedido_sucursal(
  p_pedido_id     uuid,
  p_sucursal_id   integer,
  p_items         jsonb  -- [{pedido_item_id, cantidad_recibida, nota_diferencia}]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item      jsonb;
  v_status    text;
  v_has_diff  boolean := false;
BEGIN
  -- Actualizar cada item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Detectar diferencia
    SELECT
      CASE WHEN pi.cantidad_asignada IS DISTINCT FROM (v_item->>'cantidad_recibida')::integer
           THEN true ELSE false END
    INTO v_has_diff
    FROM pedido_items pi
    WHERE pi.id = (v_item->>'pedido_item_id')::integer;

    UPDATE pedido_items SET
      cantidad_recibida = (v_item->>'cantidad_recibida')::integer,
      nota_diferencia   = v_item->>'nota_diferencia',
      status            = CASE WHEN v_has_diff THEN 'con_diferencia' ELSE 'recibido' END,
      received_at       = now()
    WHERE id = (v_item->>'pedido_item_id')::integer
      AND erp_sucursal_id = p_sucursal_id
      AND pedido_id = p_pedido_id;
  END LOOP;

  -- Actualizar status del pedido si alguna sucursal tuvo diferencia
  IF EXISTS (
    SELECT 1 FROM pedido_items
    WHERE pedido_id = p_pedido_id AND status = 'con_diferencia'
  ) THEN
    UPDATE pedidos SET status = 'parcial' WHERE id = p_pedido_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pedido_items
    WHERE pedido_id = p_pedido_id AND status = 'pendiente'
  ) THEN
    UPDATE pedidos SET status = 'confirmado' WHERE id = p_pedido_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION receive_pedido_sucursal(uuid, integer, jsonb) TO authenticated;
