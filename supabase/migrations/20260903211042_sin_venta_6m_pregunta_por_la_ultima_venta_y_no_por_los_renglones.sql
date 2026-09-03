SET lock_timeout = '5s';

-- ── «SIN VENTA 6M» DEJA DE LEER 266 MB PARA DEVOLVER 84 FILAS ───────────────
--
-- `get_stagnant_inventory` es la pestaña «Stock retenido» de Inventario. Salió
-- en la sección F de `npm run gate:perf` leyendo **3,407 MB por llamada** —
-- medido sobre 5 llamadas de producción, el número más alto del portal.
--
-- Medido a mano el 2026-09-03: sala 1, **33,995 bloques (266 MB) y 1,895 ms**,
-- con derrame a disco (2,283 bloques temporales). El 94% —32,029 bloques— se
-- iba en UN solo CTE, `sales_6m`, que agregaba **216,067 renglones de venta de
-- las seis salas** recorriendo entero el índice de `sales_invoice_items`
-- (620,722 filas) para al final devolver 84 productos.
--
-- ── Lo que preguntaba y lo que necesitaba ──────────────────────────────────
--
-- `sales_6m` contestaba DOS preguntas distintas con una sola pasada:
--
--   1. ¿qué productos NO se vendieron en ESTA sala en 6 meses?  → sólo hace
--      falta la EXISTENCIA del par (sala, producto). Nunca cuánto.
--   2. ¿dónde SÍ se venden los que quedaron?  → ahí sí hacen falta unidades e
--      importe, pero **sólo de los ~84 candidatos**, no de los 2,103 del
--      universo.
--
-- La primera ya está contestada en `product_last_sale`, que la propia función
-- consultaba tres CTE más abajo para la columna «última venta». Verificado
-- contra los renglones de venta en sala 1: **2,430 productos por renglones,
-- 2,429 por `product_last_sale`, y el único que sobra no existe en `products`**,
-- así que nunca podía llegar a la salida (el `JOIN products … activo` lo saca).
--
-- La segunda entra por `idx_sii_product_invoice (erp_product_id, invoice_id)`,
-- que ya existía: 84 búsquedas por índice en vez de un barrido.
--
--   sala 1:  33,995 → 12,090 bloques  ·  1,895 → 837 ms  ·  sin derrame a disco
--
-- ── La verificación, y el defecto que destapó ──────────────────────────────
--
-- Se enfrentaron las dos versiones sobre las SIETE salas, comparando la huella
-- md5 de la salida completa ordenada por producto:
--
--   salas 1, 2, 3, 4, 5 y 7 → **idénticas** (84, 67, 100, 112, 44 y 377 filas)
--   Bodega (6)             → mismas 3,288 filas, mismo conjunto de productos,
--                            mismo stock, misma última venta, mismo min/máx,
--                            mismo vencimiento, mismo `sold_in` … y **UNA fila
--                            con otro `cost_value`**.
--
-- Esa fila es un defecto que ya estaba y que nadie podía ver: `unit_costs`
-- resolvía el costo unitario con `DISTINCT ON (product_id) … ORDER BY
-- product_id, factor ASC`, **sin desempate**. El producto 1379 tiene DOS
-- precios activos con el mismo `factor = 1` y distinto costo —$8.60 y $8.937—,
-- así que cuál ganaba lo decidía el orden en que el plan leyera las filas: el
-- mismo informe podía costar dos cosas distintas en dos corridas seguidas, sin
-- que nada cambiara en la base.
--
-- Se cierra con `ORDER BY product_id, factor ASC, costo ASC, id ASC`: el más
-- barato primero y el `id` como último recurso, que es determinista por
-- construcción. Es la única diferencia deliberada de salida respecto de la
-- versión anterior, y sólo en esa fila.
--
-- ── Un índice para la pregunta que ahora se hace ───────────────────────────
--
-- `product_last_sale` sólo tenía la PK `(erp_product_id, erp_sucursal_id)` y
-- `(erp_product_id)`, así que preguntar «qué vendió la sala 1» recorría el
-- índice entero: 2,980 de los 12,090 bloques. La tabla son 16,893 filas y
-- 1.7 MB, así que el índice nuevo es barato y deja esa pregunta en un puñado
-- de bloques.

CREATE INDEX IF NOT EXISTS idx_pls_sucursal_fecha
  ON public.product_last_sale (erp_sucursal_id, last_sale_date);

COMMENT ON INDEX public.idx_pls_sucursal_fecha IS
  'Para «qué vendió esta sala desde tal fecha» — la pregunta de get_stagnant_inventory. Sin él, esa pregunta recorre el índice primario entero.';

CREATE OR REPLACE FUNCTION public.get_stagnant_inventory(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS TABLE(erp_product_id integer, product_name text, laboratorio text, current_stock bigint, cost_value numeric, fecha_vencimiento_min date, in_minmax boolean, min_qty numeric, max_qty numeric, sold_in jsonb, ultima_venta date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH branch_map(bid, esid) AS (
    VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),(28::bigint,4),(2::bigint,5),(29::bigint,7)
  ),
  inv_cur AS (
    SELECT inv.erp_sucursal_id AS suc_id, inv.erp_product_id AS prod_id,
      SUM(inv.cantidad * COALESCE((regexp_match(inv.detalle,'\d+[xX](\d+)'))[1]::int,1))::bigint AS total_units,
      MIN(inv.fecha_vencimiento) FILTER (WHERE inv.fecha_vencimiento IS NOT NULL) AS min_venc
    FROM inventory inv
    WHERE inv.is_vencidos = false AND inv.cantidad > 0
      AND (p_erp_sucursal_id IS NULL OR inv.erp_sucursal_id = p_erp_sucursal_id)
    GROUP BY inv.erp_sucursal_id, inv.erp_product_id
  ),
  -- Qué se vendió en ESTA sala en los últimos 6 meses. Sólo la EXISTENCIA del
  -- par (sala, producto): abajo se pregunta `NOT EXISTS`, nunca cuánto. Sale de
  -- `product_last_sale` —la misma tabla que la columna «última venta»— y no de
  -- los renglones de venta: contestar esto recorriendo `sales_invoice_items`
  -- costaba 32,029 bloques, el 94% de la consulta.
  vendido_aca AS (
    SELECT pls.erp_sucursal_id AS suc_id, pls.erp_product_id AS prod_id
    FROM product_last_sale pls
    WHERE pls.last_sale_date >= CURRENT_DATE - INTERVAL '6 months'
      AND (p_erp_sucursal_id IS NULL OR pls.erp_sucursal_id = p_erp_sucursal_id)
  ),
  candidates AS (
    SELECT ic.suc_id, ic.prod_id, ic.total_units, ic.min_venc
    FROM inv_cur ic
    WHERE NOT EXISTS (SELECT 1 FROM vendido_aca v WHERE v.suc_id = ic.suc_id AND v.prod_id = ic.prod_id)
      AND (p_erp_sucursal_id IS NULL OR ic.suc_id = p_erp_sucursal_id)
    UNION
    SELECT psp.erp_sucursal_id, psp.erp_product_id, 0::bigint, NULL::date
    FROM product_stock_params psp
    WHERE (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM vendido_aca v WHERE v.suc_id = psp.erp_sucursal_id AND v.prod_id = psp.erp_product_id)
      AND NOT EXISTS (SELECT 1 FROM inv_cur ic  WHERE ic.suc_id = psp.erp_sucursal_id AND ic.prod_id = psp.erp_product_id)
  ),
  candidates_agg AS (
    SELECT prod_id, SUM(total_units)::bigint AS total_units, MIN(min_venc) AS min_venc
    FROM candidates GROUP BY prod_id
  ),
  -- Dónde SÍ se venden los que quedaron. Entra por `candidates_agg` —84
  -- productos en una sala típica— usando `idx_sii_product_invoice`, en vez de
  -- agregar los 216,067 renglones de las seis salas y descartar el 99%.
  sales_otras AS (
    SELECT bm.esid AS suc_id, ii.erp_product_id AS prod_id,
      SUM(ii.cantidad::numeric * ii.factor_unidades)::bigint AS units_sold,
      ROUND(SUM(ii.total_linea)::numeric, 2) AS revenue
    FROM candidates_agg ca
    JOIN sales_invoice_items ii ON ii.erp_product_id = ca.prod_id
    JOIN sales_invoices inv     ON inv.id = ii.invoice_id
    JOIN branch_map bm          ON bm.bid = inv.branch_id
    WHERE inv.fecha >= CURRENT_DATE - INTERVAL '6 months'
      AND inv.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND ii.cantidad > 0
      AND (p_erp_sucursal_id IS NULL OR bm.esid <> p_erp_sucursal_id)
    GROUP BY bm.esid, ii.erp_product_id
  ),
  sold_in_agg AS (
    SELECT so.prod_id,
      jsonb_agg(jsonb_build_object('esid', so.suc_id, 'units', so.units_sold, 'rev', so.revenue)
                ORDER BY so.revenue DESC, so.suc_id) AS sold_in
    FROM sales_otras so
    GROUP BY so.prod_id
  ),
  last_sale_agg AS (
    SELECT pls.erp_product_id AS prod_id, MAX(pls.last_sale_date) AS ultima_venta
    FROM product_last_sale pls
    WHERE pls.erp_product_id IN (SELECT prod_id FROM candidates_agg)
      AND (p_erp_sucursal_id IS NULL OR pls.erp_sucursal_id = p_erp_sucursal_id)
    GROUP BY pls.erp_product_id
  ),
  minmax AS (
    SELECT psp.erp_product_id AS prod_id,
      bool_or(COALESCE(psp.manual_max, psp.max_units, 0) > 0) AS in_minmax,
      (array_agg(COALESCE(psp.manual_min, psp.min_units) ORDER BY psp.erp_sucursal_id))[1] AS min_qty,
      (array_agg(COALESCE(psp.manual_max, psp.max_units) ORDER BY psp.erp_sucursal_id))[1] AS max_qty
    FROM product_stock_params psp
    WHERE (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND psp.erp_product_id IN (SELECT prod_id FROM candidates_agg)
    GROUP BY psp.erp_product_id
  ),
  -- El desempate NO es cosmético: sin él, un producto con dos precios activos
  -- del mismo `factor` y distinto costo (el 1379 tiene $8.60 y $8.937) sacaba
  -- un costo distinto según cómo leyera el plan. El más barato primero, y el
  -- `id` como último recurso para que la respuesta no dependa de nada más.
  unit_costs AS (
    SELECT DISTINCT ON (product_id) product_id, (costo / factor::numeric) AS unit_cost
    FROM product_precios
    WHERE activo = true AND costo > 0 AND factor > 0
      AND product_id IN (SELECT prod_id FROM candidates_agg)
    ORDER BY product_id, factor ASC, costo ASC, id ASC
  )
  SELECT c.prod_id, p.nombre, COALESCE(l.nombre, '—'), c.total_units,
    ROUND(c.total_units * COALESCE(uc.unit_cost, 0), 2), c.min_venc,
    COALESCE(mm.in_minmax, false), mm.min_qty, mm.max_qty,
    COALESCE(si.sold_in, '[]'::jsonb), ls.ultima_venta
  FROM candidates_agg c
  JOIN products p            ON p.id = c.prod_id AND p.activo = true
  LEFT JOIN laboratorios l   ON l.id = p.laboratorio_id
  LEFT JOIN unit_costs uc    ON uc.product_id = c.prod_id
  LEFT JOIN sold_in_agg si   ON si.prod_id    = c.prod_id
  LEFT JOIN last_sale_agg ls ON ls.prod_id    = c.prod_id
  LEFT JOIN minmax mm        ON mm.prod_id    = c.prod_id
  ORDER BY ROUND(c.total_units * COALESCE(uc.unit_cost, 0), 2) DESC NULLS LAST;
$function$;
