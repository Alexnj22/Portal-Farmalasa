SET lock_timeout = '5s';

-- ── LA REESCRITURA DE 20260903211042 SE REVIERTE: BODEGA PAGABA LA MEJORA ───
--
-- La migración anterior cambió `get_stagnant_inventory` para preguntar «qué se
-- vendió acá» a `product_last_sale` en vez de agregar los renglones de venta, y
-- para buscar «dónde SÍ se vende» producto por producto con
-- `idx_sii_product_invoice`. Medido después de aplicarla:
--
--   sala 1   33,995 → 12,090 bloques   (−64%)   1,895 → 837 ms
--   Bodega  107,377 → 622,556 bloques  (+480%)  2,242 → 1,550 ms
--
-- El cambio es correcto —la salida se verificó idéntica en las siete salas— y
-- es una mejora real en las seis salas de venta. Pero Bodega tiene **3,288
-- candidatos** contra ~100 de una sala normal, y ahí la búsqueda por producto
-- deja de ser una búsqueda: son 3,288 entradas al índice con salto al heap por
-- cada renglón, contra UN recorrido secuencial del índice cubridor que trae los
-- mismos 620,722 renglones con su carga adentro.
--
-- O sea que **las dos formas son correctas y cada una gana en un caso**, y cuál
-- conviene lo decide el TAMAÑO del conjunto de candidatos — que es justo lo que
-- el planificador no puede ver: `candidates_agg` es un CTE y se estima en 200
-- filas siempre, valga 96 o 3,288. Por eso eligió la misma forma para los dos.
--
-- Leer 4.8 GB por llamada en la página de Bodega es exactamente la clase de
-- lectura que llenó el pool el 2026-09-01, así que la mejora de las otras seis
-- no la paga. Se revierte el cuerpo.
--
-- **Lo que queda pendiente, con el diagnóstico hecho:** para quedarse con la
-- mejora hace falta que la función ELIJA la forma según cuántos candidatos
-- haya, y eso no se puede escribir en una sola sentencia SQL — pide `plpgsql`
-- con un `IF` sobre el conteo, y entonces además `plan_cache_mode =
-- 'force_custom_plan'` (regla 4 de CLAUDE.md). La otra salida sería volver
-- cubridor a `idx_sii_product_invoice`, pero eso es DDL sobre
-- `sales_invoice_items`, que es tabla caliente: es el escenario del outage del
-- 2026-07-08 y no se hace de paso.
--
-- ── Lo que SÍ se queda: el desempate del costo unitario ─────────────────────
--
-- La reescritura destapó un defecto que ya estaba y que nadie podía ver.
-- `unit_costs` resolvía el costo con `DISTINCT ON (product_id) … ORDER BY
-- product_id, factor ASC`, **sin desempate**. El producto 1379 tiene DOS
-- precios activos con el mismo `factor = 1` y distinto costo —$8.60 y $8.937—,
-- así que cuál ganaba lo decidía el orden en que el plan leyera las filas: el
-- mismo informe podía costar dos cosas distintas en dos corridas seguidas sin
-- que nada cambiara en la base. Fue la ÚNICA fila que no coincidió al comparar
-- las dos versiones en las siete salas, y por eso se encontró.
--
-- `ORDER BY product_id, factor ASC, costo ASC, id ASC`: el más barato primero y
-- el `id` como último recurso, que es determinista por construcción.
-- Verificado: dos corridas seguidas de Bodega dan la misma huella md5.
--
-- El índice `idx_pls_sucursal_fecha` que creó la migración anterior se borra:
-- lo pedía la forma que se revierte, y un índice que nadie usa sólo cuesta
-- escrituras.

DROP INDEX IF EXISTS public.idx_pls_sucursal_fecha;

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
  universo AS (
    SELECT prod_id FROM inv_cur
    UNION
    SELECT psp.erp_product_id FROM product_stock_params psp
    WHERE (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
  ),
  sales_6m AS (
    SELECT bm.esid AS suc_id, ii.erp_product_id AS prod_id,
      SUM(ii.cantidad::numeric * ii.factor_unidades)::bigint AS units_sold,
      ROUND(SUM(ii.total_linea)::numeric, 2) AS revenue
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm ON bm.bid = inv.branch_id
    WHERE inv.fecha >= CURRENT_DATE - INTERVAL '6 months'
      AND inv.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND ii.erp_product_id IS NOT NULL AND ii.cantidad > 0
      AND ii.erp_product_id IN (SELECT prod_id FROM universo)
    GROUP BY bm.esid, ii.erp_product_id
  ),
  candidates AS (
    SELECT ic.suc_id, ic.prod_id, ic.total_units, ic.min_venc
    FROM inv_cur ic
    WHERE NOT EXISTS (SELECT 1 FROM sales_6m s WHERE s.suc_id = ic.suc_id AND s.prod_id = ic.prod_id)
      AND (p_erp_sucursal_id IS NULL OR ic.suc_id = p_erp_sucursal_id)
    UNION
    SELECT psp.erp_sucursal_id, psp.erp_product_id, 0::bigint, NULL::date
    FROM product_stock_params psp
    WHERE (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM sales_6m s  WHERE s.suc_id  = psp.erp_sucursal_id AND s.prod_id  = psp.erp_product_id)
      AND NOT EXISTS (SELECT 1 FROM inv_cur ic  WHERE ic.suc_id = psp.erp_sucursal_id AND ic.prod_id = psp.erp_product_id)
  ),
  candidates_agg AS (
    SELECT prod_id, SUM(total_units)::bigint AS total_units, MIN(min_venc) AS min_venc
    FROM candidates GROUP BY prod_id
  ),
  sold_in_agg AS (
    SELECT s.prod_id,
      jsonb_agg(jsonb_build_object('esid', s.suc_id, 'units', s.units_sold, 'rev', s.revenue)
                ORDER BY s.revenue DESC, s.suc_id) AS sold_in
    FROM sales_6m s
    WHERE (p_erp_sucursal_id IS NULL OR s.suc_id != p_erp_sucursal_id)
      AND s.prod_id IN (SELECT prod_id FROM candidates_agg)
    GROUP BY s.prod_id
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
  -- un costo distinto según cómo leyera el plan. Es lo único que se conserva de
  -- la reescritura revertida — y es lo que ella destapó.
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