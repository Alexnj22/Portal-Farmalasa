-- Upserts condicionales para los syncs del ERP (auditoría 2026-07-29, P1)
--
-- Problema medido en pg_stat_statements (reset 2026-07-20, ~9 días):
--   INSERT INTO products(id, nombre, updated_at) ... ON CONFLICT (id) DO NOTHING
--   → 127,170 llamadas · 8,281 s · 65 ms media · 26.5% del tiempo total de la BD.
--
-- La causa NO es que escriba: no escribe nada (0 tuplas insertadas, 1200
-- conflictivas en la medición). El costo es la *inserción especulativa* de
-- ON CONFLICT: Postgres arma el tuple y sondea el índice arbitrario por CADA
-- fila del payload, aunque todas existan. products_pkey acumuló 142M idx_scan.
--
--   EXPLAIN ANALYZE con 1,200 filas, todas existentes:
--     ON CONFLICT DO NOTHING           → 84.3 ms  (4,670 buffers)
--     WHERE NOT EXISTS + DO NOTHING    →  6.3 ms  (3,611 buffers, Index Only Scan)
--
-- El anti-join resuelve la pertenencia con un Index Only Scan y solo las filas
-- realmente nuevas llegan a la maquinaria de INSERT.
--
-- Además laboratorios/presentaciones se reescribían enteras cada 10 min porque
-- el payload traía updated_at:now() (442,903 updates sobre 356 filas; 289,072
-- sobre 232) — el antipatrón que CLAUDE.md prohíbe explícitamente. Acá el
-- updated_at lo pone el RPC y solo cuando el dato real cambió.

SET lock_timeout = '5s';

-- ── products: insertar solo los que faltan ───────────────────────────────────
-- Lo usan sync-dte-sales (ventas e inventario). Son redes de seguridad: el dueño
-- del catálogo es sync-products (cada 10 min). Acá solo importa que la fila
-- exista, porque inventory.erp_product_id y purchase_receipt_items.erp_product_id
-- tienen FK contra products.
CREATE OR REPLACE FUNCTION public.insert_missing_products(p_rows json)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH incoming AS (
  SELECT DISTINCT ON (r.id) r.id, r.nombre
  FROM json_to_recordset(p_rows) AS r(id integer, nombre text)
  WHERE r.id IS NOT NULL
  ORDER BY r.id
),
inserted AS (
  INSERT INTO public.products (id, nombre, updated_at)
  SELECT i.id, i.nombre, now()
  FROM incoming i
  WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = i.id)
  -- Red de seguridad ante dos sucursales sincronizando el mismo producto nuevo
  -- a la vez: el anti-join no es atómico respecto de otra transacción.
  ON CONFLICT (id) DO NOTHING
  RETURNING 1
)
SELECT count(*)::integer FROM inserted;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_missing_products(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.insert_missing_products(json) TO service_role;

-- ── products: insertar los que faltan + refrescar nombre si cambió ───────────
-- Lo usa sync-erp-purchases, que sí quiere propagar el cambio de nombre del ERP
-- (ver comentario en sync-erp-purchases/index.ts). Bajo volumen (144 corridas
-- al día), así que acá el costo de ON CONFLICT es irrelevante; lo que importa
-- es no reescribir la fila cuando el nombre es el mismo.
CREATE OR REPLACE FUNCTION public.upsert_products_minimal(p_rows json)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH incoming AS (
  SELECT DISTINCT ON (r.id) r.id, r.nombre
  FROM json_to_recordset(p_rows) AS r(id integer, nombre text)
  WHERE r.id IS NOT NULL AND r.nombre IS NOT NULL
  ORDER BY r.id
),
written AS (
  INSERT INTO public.products AS p (id, nombre, updated_at)
  SELECT i.id, i.nombre, now() FROM incoming i
  ON CONFLICT (id) DO UPDATE
    SET nombre     = EXCLUDED.nombre,
        updated_at = EXCLUDED.updated_at
    WHERE p.nombre IS DISTINCT FROM EXCLUDED.nombre
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_products_minimal(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_products_minimal(json) TO service_role;

-- ── laboratorios ─────────────────────────────────────────────────────────────
-- OJO: solo id/nombre/updated_at. `ubicacion` y `ocultar_en_minmax` son del
-- portal (se editan a mano) y el ERP no las conoce — no deben aparecer acá.
CREATE OR REPLACE FUNCTION public.sync_laboratorios_batch(p_rows json)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH incoming AS (
  SELECT DISTINCT ON (r.id) r.id, r.nombre
  FROM json_to_recordset(p_rows) AS r(id integer, nombre text)
  WHERE r.id IS NOT NULL AND r.nombre IS NOT NULL
  ORDER BY r.id
),
written AS (
  INSERT INTO public.laboratorios AS l (id, nombre, updated_at)
  SELECT i.id, i.nombre, now() FROM incoming i
  ON CONFLICT (id) DO UPDATE
    SET nombre     = EXCLUDED.nombre,
        updated_at = EXCLUDED.updated_at
    WHERE l.nombre IS DISTINCT FROM EXCLUDED.nombre
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_laboratorios_batch(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_laboratorios_batch(json) TO service_role;

-- ── presentaciones ───────────────────────────────────────────────────────────
-- Solo el catálogo de tipos. factor/descripcion son por producto y viven en
-- product_precios (ver comentario en sync-products/index.ts).
CREATE OR REPLACE FUNCTION public.sync_presentaciones_batch(p_rows json)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH incoming AS (
  SELECT DISTINCT ON (r.id) r.id, r.tipo
  FROM json_to_recordset(p_rows) AS r(id integer, tipo text)
  WHERE r.id IS NOT NULL
  ORDER BY r.id
),
written AS (
  INSERT INTO public.presentaciones AS pr (id, tipo, updated_at)
  SELECT i.id, i.tipo, now() FROM incoming i
  ON CONFLICT (id) DO UPDATE
    SET tipo       = EXCLUDED.tipo,
        updated_at = EXCLUDED.updated_at
    WHERE pr.tipo IS DISTINCT FROM EXCLUDED.tipo
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_presentaciones_batch(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_presentaciones_batch(json) TO service_role;
