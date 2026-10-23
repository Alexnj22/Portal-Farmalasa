-- Reglamento Puntos Salud v2, cláusula 3.3 (vigente el 2026-11-15): en una
-- compra mixta acumulan sólo los productos que acumulan. Lo excluido
-- (telefonía, bebidas, helados, paletas) ya no suma, como hasta hoy, cuando va
-- junto a un medicamento.
--
-- Medido del 2026-10-01 al 22: 420 de 9,213 lotes (4.6 %) eran mixtos; con la
-- regla nueva habrían dado 759 puntos menos en total, 13 como máximo en una.
--
-- La fecha es una FILA (`puntos_config.acumula_por_renglon_desde`) y no un
-- literal: el reglamento manda avisar 30 días antes de un cambio (cláusula
-- 11.1), y correr la vigencia no tiene que ser una migración. NULL = apagado.
-- Antes de esa fecha la función devuelve exactamente lo de antes.
SET lock_timeout = '5s';

ALTER TABLE public.puntos_config ADD COLUMN IF NOT EXISTS acumula_por_renglon_desde date;
COMMENT ON COLUMN public.puntos_config.acumula_por_renglon_desde IS
  'Desde esta fecha de venta, en una compra mixta acumulan sólo los productos que acumulan (Reglamento v2, 3.3). NULL = total entero.';
UPDATE public.puntos_config SET acumula_por_renglon_desde = DATE '2026-11-15';

CREATE OR REPLACE FUNCTION public.ventas_elegibles_puntos(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 100000)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v json;
  -- Mayoreo (2026-10-19): el interruptor `puntos_config.mayoreo_puntos_activo`.
  -- Apagado, esta función hace EXACTAMENTE lo de antes: la rama de abajo es la
  -- definición anterior, letra por letra.
  v_mayoreo boolean := coalesce((SELECT c.mayoreo_puntos_activo FROM public.puntos_config c LIMIT 1), false);
  -- Reglamento v2, cláusula 3.3 (vigente el 2026-11-15): en una compra mixta
  -- acumulan SÓLO los productos que acumulan; lo excluido (telefonía, bebidas,
  -- helados, paletas) ya no suma. Antes de esa fecha, el total entero como
  -- siempre. NULL = apagado. Es una fila y no un `if` por fecha para que correr
  -- la vigencia no sea una migración.
  v_renglon date := (SELECT c.acumula_por_renglon_desde FROM public.puntos_config c LIMIT 1);
BEGIN
  IF NOT v_mayoreo THEN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.customer_id, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND public.venta_valida(si.estado)
        -- Cláusula 3.2: «vale US$1.00 o más». El circuito viejo usa `> 1`.
        AND si.total >= 1
        AND si.cod_vendedor ~ '^[0-9]{1,9}$'
        AND coalesce(cu.acumula_puntos, true)
        -- Quien salió del programa desde «Mis puntos» no acumula (2026-09-28).
        AND cu.acepta_programa_puntos IS DISTINCT FROM false
        -- Sólo las que todavía NO tienen su lote (2026-10-05). El motor corre
        -- cada minuto sobre 3 días y `puntos_acumular` ya descartaba estas
        -- después — pero recién DESPUÉS de evaluar cada renglón contra el
        -- historial de precios. Lo marcó `gate:perf` sección F: ~31,700
        -- bloques por llamada en 4,594 llamadas. Mismo resultado: el índice
        -- único de `puntos_lote.invoice_id` ya impedía acreditar dos veces.
        AND NOT EXISTS (SELECT 1 FROM public.puntos_lote pl WHERE pl.invoice_id = si.id)
    ),
    pv AS (
      SELECT p.product_id, p.id_presentacion,
             upper(regexp_replace(coalesce(pr.tipo,'') || ' ' || coalesce(p.descripcion,''),
                                  '\s+', ' ', 'g')) AS pkey,
             p.vineta, p.descuento_1, p.vip
      FROM public.product_precios p
      LEFT JOIN public.presentaciones pr ON pr.id = p.id_presentacion
      WHERE p.activo
    ),
    lin AS (
      SELECT ii.invoice_id, ii.precio_unitario, ii.erp_product_id, inv.fecha,
             coalesce(ii.total_linea, 0) AS total_linea,
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey,
             -- La lista por producto manda sobre el laboratorio (2026-09-28):
             -- chips y bebidas cargados en un laboratorio de farmacia.
             coalesce(lab.acumula_puntos, true)
               AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x
                                WHERE x.product_id = ii.erp_product_id) AS acumula
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
      LEFT JOIN public.products      prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios  lab ON lab.id = prd.laboratorio_id
    ),
    ok AS (
      SELECT lin.invoice_id, lin.acumula, lin.total_linea,
             EXISTS (
               SELECT 1
               FROM pv
               CROSS JOIN LATERAL (
                 SELECT coalesce(h.vineta,      pv.vineta)      AS p1,
                        coalesce(h.descuento_1, pv.descuento_1) AS p2,
                        coalesce(h.vip,         pv.vip)         AS p3
                 FROM (SELECT 1) z
                 LEFT JOIN LATERAL (
                   SELECT h2.vineta, h2.descuento_1, h2.vip
                   FROM public.product_precios_history h2
                   WHERE h2.product_id      = pv.product_id
                     AND h2.id_presentacion = pv.id_presentacion
                     AND h2.valid_from  <  (lin.fecha + 1)::timestamptz
                     AND (h2.valid_until IS NULL OR h2.valid_until >= lin.fecha::timestamptz)
                   ORDER BY h2.valid_from DESC
                   LIMIT 1
                 ) h ON true
               ) e
               WHERE pv.product_id = lin.erp_product_id
                 AND pv.pkey       = lin.pkey
                 AND coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) IS NOT NULL
                 AND lin.precio_unitario >=
                     coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) * (1 - p_margen)
             ) AS ok
      FROM lin
    ),
    agg AS (
      SELECT invoice_id,
             bool_and(ok)      AS todas,
             bool_or(acumula)  AS lleva_producto,
             sum(total_linea) FILTER (WHERE acumula) AS monto_acumula,
             sum(total_linea)                        AS monto_todo
      FROM ok GROUP BY 1
    )
    SELECT inv.id AS invoice_id, inv.sucursal, inv.erp_invoice_id, inv.correlativo,
           inv.customer_id, inv.cod_vendedor, inv.total, inv.fecha,
           -- «Por cada US$1.00 se otorga 1 punto. Las fracciones no acumulan.»
           -- Desde `v_renglon`, la parte del total que corresponde a lo que
           -- acumula: proporcional y no la suma de renglones, para que el IVA
           -- del crédito fiscal y la retención queden como en el total.
           CASE WHEN v_renglon IS NOT NULL AND inv.fecha >= v_renglon
                THEN floor(inv.total * agg.monto_acumula / nullif(agg.monto_todo, 0))::int
                ELSE floor(inv.total)::int END AS puntos
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas AND agg.lleva_producto
      -- Una mixta donde lo que acumula no llega a US$1.00 no da lote en cero.
      AND (v_renglon IS NULL OR inv.fecha < v_renglon
           OR floor(inv.total * agg.monto_acumula / nullif(agg.monto_todo, 0)) >= 1)
    ORDER BY inv.fecha, inv.id
    LIMIT p_tope
  ) t;

  RETURN v;
  END IF;

  -- ── Encendido: por RENGLÓN para el Cliente Mayorista y el personal ───────
  -- Condiciones del Cliente Mayorista §5: lo comprado a su precio de mayoreo
  -- acumula los puntos de su RANGO por US$1.00 (Jade 0.25 · Zafiro 0.5 · Rubí
  -- 0.75 · Diamante 1); lo comprado a Preferente o más alto, 1 punto por
  -- US$1.00; no acumula lo vendido por debajo de su precio asignado, ni la
  -- telefonía, las bebidas, los helados y las paletas. No tiene nivel de
  -- Puntos Salud: `puntos_acumular` no le aplica el factor de nivel.
  -- El personal (precio Mayoreo Plus por política, sin ser mayorista): lo de
  -- Preferente acumula como a cualquier cliente y lo de precio de personal no
  -- acumula, pero ya NO deja la factura entera en cero.
  -- El consumidor sigue con el todo-o-nada: es la regla del Reglamento v2
  -- («basta que una de ellas figure en el documento de venta para que esa
  -- compra no acumule puntos»), y su cálculo es el MISMO de arriba.
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH emp AS (
      -- El personal activo, por DUI (la regla de `cliente_es_empleado`).
      SELECT DISTINCT regexp_replace(e.dui, '\D', '', 'g') AS dui
        FROM public.employees e
       WHERE e.status = 'ACTIVO' AND length(regexp_replace(coalesce(e.dui, ''), '\D', '', 'g')) = 9
    ),
    inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.customer_id, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha,
             cm.precio AS lista,
             (cm.customer_id IS NULL AND regexp_replace(coalesce(cu.dui, ''), '\D', '', 'g') IN (SELECT dui FROM emp)) AS personal
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
      LEFT JOIN public.clientes_mayoristas cm ON cm.customer_id = si.customer_id AND cm.estado = 'aprobado'
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND public.venta_valida(si.estado)
        AND si.total >= 1
        AND si.cod_vendedor ~ '^[0-9]{1,9}$'
        AND coalesce(cu.acumula_puntos, true)
        AND cu.acepta_programa_puntos IS DISTINCT FROM false
        AND NOT EXISTS (SELECT 1 FROM public.puntos_lote pl WHERE pl.invoice_id = si.id)
    ),
    pv AS (
      SELECT p.product_id, p.id_presentacion,
             upper(regexp_replace(coalesce(pr.tipo,'') || ' ' || coalesce(p.descripcion,''),
                                  '\s+', ' ', 'g')) AS pkey,
             p.vineta, p.descuento_1, p.vip, p.clinica, p.mayoreo
      FROM public.product_precios p
      LEFT JOIN public.presentaciones pr ON pr.id = p.id_presentacion
      WHERE p.activo
    ),
    lin AS (
      SELECT ii.invoice_id, ii.precio_unitario, ii.erp_product_id, inv.fecha, inv.lista,
             coalesce(ii.total_linea, 0) AS total_linea,
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey,
             coalesce(lab.acumula_puntos, true)
               AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x
                                WHERE x.product_id = ii.erp_product_id) AS acumula
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
      LEFT JOIN public.products      prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios  lab ON lab.id = prd.laboratorio_id
    ),
    ok AS (
      SELECT lin.invoice_id, lin.acumula, lin.total_linea,
             coalesce(e.ok, false) AS ok, coalesce(e.ok_lista, false) AS ok_lista
      FROM lin
      LEFT JOIN LATERAL (
        SELECT
          -- `ok`: la MISMA condición del todo-o-nada (Preferente o más alto).
          bool_or(coalesce(nullif(pz.p3,0), nullif(pz.p2,0), nullif(pz.p1,0)) IS NOT NULL
                  AND lin.precio_unitario >=
                      coalesce(nullif(pz.p3,0), nullif(pz.p2,0), nullif(pz.p1,0)) * (1 - p_margen)) AS ok,
          -- `ok_lista`: a su precio de mayoreo asignado o más (precio_de_lista,
          -- la misma regla del catálogo y del cobro de la app). Sin lista, no.
          bool_or(lin.lista IS NOT NULL
                  AND public.precio_de_lista(lin.lista, pz.p1, pz.p3, pz.p4, pz.p5) IS NOT NULL
                  AND lin.precio_unitario >=
                      public.precio_de_lista(lin.lista, pz.p1, pz.p3, pz.p4, pz.p5) * (1 - p_margen)) AS ok_lista
        FROM pv
        CROSS JOIN LATERAL (
          SELECT coalesce(h.vineta,      pv.vineta)      AS p1,
                 coalesce(h.descuento_1, pv.descuento_1) AS p2,
                 coalesce(h.vip,         pv.vip)         AS p3,
                 coalesce(h.clinica,     pv.clinica)     AS p4,
                 coalesce(h.mayoreo,     pv.mayoreo)     AS p5
          FROM (SELECT 1) z
          LEFT JOIN LATERAL (
            SELECT h2.vineta, h2.descuento_1, h2.vip, h2.clinica, h2.mayoreo
            FROM public.product_precios_history h2
            WHERE h2.product_id      = pv.product_id
              AND h2.id_presentacion = pv.id_presentacion
              AND h2.valid_from  <  (lin.fecha + 1)::timestamptz
              AND (h2.valid_until IS NULL OR h2.valid_until >= lin.fecha::timestamptz)
            ORDER BY h2.valid_from DESC
            LIMIT 1
          ) h ON true
        ) pz
        WHERE pv.product_id = lin.erp_product_id
          AND pv.pkey       = lin.pkey
      ) e ON true
    ),
    agg AS (
      SELECT invoice_id,
             bool_and(ok)                     AS todas,
             bool_or(acumula)                 AS lleva_producto,
             bool_or(acumula AND ok)          AS lleva_producto_ok,
             sum(total_linea) FILTER (WHERE ok)                              AS monto_ok,
             sum(total_linea) FILTER (WHERE acumula AND ok)                  AS monto_pref,
             sum(total_linea) FILTER (WHERE acumula AND NOT ok AND ok_lista) AS monto_mayoreo,
             sum(total_linea) FILTER (WHERE acumula)                         AS monto_acumula,
             sum(total_linea)                                                AS monto_todo
      FROM ok GROUP BY 1
    ),
    cal AS (
      SELECT inv.*, agg.*,
             CASE WHEN inv.lista IS NOT NULL THEN 'mayorista'
                  WHEN inv.personal AND NOT agg.todas THEN 'personal'
                  ELSE 'consumidor' END AS regla,
             CASE WHEN inv.lista IS NOT NULL THEN public.mayorista_rango(inv.customer_id) END AS rango
      FROM inv JOIN agg ON agg.invoice_id = inv.id
    ),
    pts AS (
      SELECT cal.*,
             CASE cal.regla
               WHEN 'consumidor' THEN
                 CASE WHEN v_renglon IS NOT NULL AND cal.fecha >= v_renglon
                      THEN floor(cal.total * cal.monto_acumula / nullif(cal.monto_todo, 0))::int
                      ELSE floor(cal.total)::int END
               WHEN 'personal'   THEN floor(coalesce(cal.monto_ok, 0))::int
               ELSE floor(coalesce(cal.monto_pref, 0))::int
                    + floor(coalesce(cal.monto_mayoreo, 0)
                            * CASE cal.rango WHEN 'diamante' THEN 1 WHEN 'rubi' THEN 0.75
                                             WHEN 'zafiro' THEN 0.5 ELSE 0.25 END)::int
             END AS puntos,
             CASE WHEN cal.regla = 'mayorista' THEN floor(coalesce(cal.monto_mayoreo, 0)
                       * CASE cal.rango WHEN 'diamante' THEN 1 WHEN 'rubi' THEN 0.75
                                        WHEN 'zafiro' THEN 0.5 ELSE 0.25 END)::int END AS puntos_mayoreo
      FROM cal
    )
    SELECT pts.id AS invoice_id, pts.sucursal, pts.erp_invoice_id, pts.correlativo,
           pts.customer_id, pts.cod_vendedor, pts.total, pts.fecha, pts.puntos,
           pts.regla, pts.rango, pts.puntos_mayoreo,
           round(coalesce(pts.monto_mayoreo, 0), 2) AS monto_mayoreo
    FROM pts
    WHERE CASE pts.regla
            WHEN 'consumidor' THEN pts.todas AND pts.lleva_producto
            WHEN 'personal'   THEN pts.lleva_producto_ok
            ELSE true END
      AND pts.puntos > 0
    ORDER BY pts.fecha, pts.id
    LIMIT p_tope
  ) t;

  RETURN v;
END;
$function$
;
