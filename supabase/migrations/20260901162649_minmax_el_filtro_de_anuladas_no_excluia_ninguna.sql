-- El filtro de facturas anuladas de MIN·MAX no excluia ninguna factura.
--
--     AND inv.estado != 'ANULADA'
--
-- `'ANULADA'` NO EXISTE, y nunca existio. Los tres unicos valores que ha tenido
-- esa columna en toda la historia de la tabla son `FINALIZADA` (359,531),
-- `DTE INVALIDADO EN MH` (1,028) y `NULA` (9). Una condicion contra un valor
-- inexistente es siempre verdadera: el filtro no descartaba nada y las ventas
-- anuladas entraban al calculo de la demanda como si fueran reales.
--
-- Medido contra produccion el 2026-09-01, en la ventana de 180 dias:
--
--   facturas anuladas contadas como venta        390
--   renglones                                    819
--   unidades fantasma en la demanda            7,950
--   valor facturado que no existio           $10,230
--   productos x sala con el MAXIMO distinto      285
--   de esos, con 3+ unidades de mas               72
--   peor caso                        74 uds. de mas
--
-- Este mismo error YA se corrigio en el resto del portal el 2026-08-06
-- (`20260806022058_factura_anulada_incluye_dte_invalidado_en_mh`): los libros de
-- IVA, las metas, los puntos y medio centenar de funciones usan los estados
-- reales. MIN·MAX no entro en aquella tanda, y la migracion del 21-ago que
-- reescribio `calculate_stock_params` copio el literal viejo sin notarlo.
-- Es [[feedback_el_arreglo_de_un_canonico_no_llega_a_su_gemelo]]: el arreglo
-- canonico se hizo, y no alcanzo a los consumidores que no estaban en la lista.
--
-- Se corrigen las CUATRO funciones de MIN·MAX. Los cuerpos son identicos a los
-- vivos salvo esa linea:
--
--   calculate_stock_params        el MIN·MAX de todo el catalogo
--   get_products_sold_no_minmax   pestaña «vende y no tiene MIN·MAX»
--   get_no_sales_products         productos sin venta
--   get_stagnant_inventory        inventario estancado
--
-- QUEDAN FUERA a proposito, y hay que decidirlas aparte (siguen con el literal
-- viejo): `fn_update_product_last_sale`, `get_last_sale_dates`,
-- `get_product_last_sales`, `refresh_product_sales_rollup`, `get_resumen_fiscal`,
-- `get_cheques_de_bolsa`, `get_dispensacion_por_folio` y
-- `sincronizar_bitacora_dispensaciones`. La del trigger ademas NO se arregla
-- solo con cambiar el literal: corre al INSERTAR el renglon, y la anulacion
-- llega despues — necesita un barrido, que es otra decision.
--
-- El efecto es BAJAR numeros (se quita demanda que no existio), asi que no puede
-- generar sobre-stock. Se aplica en la proxima corrida del cron; ningun MIN·MAX
-- vigente se toca en esta migracion.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cfg             public.stock_config%ROWTYPE;
  v_from          date;
  v_now           timestamptz := NOW();
  v_count         integer := 0;
  v_auto_applied  integer := 0;
  v_sparse_reset  integer := 0;
  v_lock          public.module_locks%ROWTYPE;
BEGIN
  -- Candado de mantenimiento: aplica INCLUSO a service_role.
  IF public.auth_module_locked(ARRAY['minmax','pedidos']) THEN
    SELECT * INTO v_lock
    FROM public.module_locks
    WHERE module_key = ANY(ARRAY['minmax','pedidos'])
      AND expires_at > now()
    ORDER BY locked_at
    LIMIT 1;

    IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' THEN
      RETURN jsonb_build_object(
        'ok',              false,
        'skipped',         true,
        'reason',          'module_locked',
        'locked_by',       v_lock.locked_by_name,
        'locked_module',   v_lock.module_key,
        'erp_sucursal_id', p_erp_sucursal_id
      );
    END IF;

    RAISE EXCEPTION 'MODULE_LOCKED: % esta en mantenimiento por % — no se puede recalcular',
      v_lock.module_key, v_lock.locked_by_name;
  END IF;

  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' AND NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF p_erp_sucursal_id = 6 THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'skipped', true,
      'reason',  'bodega_not_calculated_here — su MIN/MAX real viene de trg_bodega_draft_sync (SUM de sucursales), no de este cálculo independiente'
    );
  END IF;

  SET LOCAL work_mem = '128MB';
  SELECT * INTO cfg FROM public.stock_config WHERE id = 1;
  v_from := CURRENT_DATE - (cfg.analysis_days || ' days')::interval;

  -- Saltar sucursal si tiene borradores pendientes de revisión manual.
  -- Los OCULTOS no cuentan: su borrador es inalcanzable desde la UI y este
  -- mismo cálculo no los toca, así que bloqueaban la sucursal para siempre.
  IF p_erp_sucursal_id IS NOT NULL THEN
    PERFORM 1 FROM product_stock_params
    WHERE erp_sucursal_id = p_erp_sucursal_id
      AND draft_status = 'pending'
      AND is_hidden IS NOT TRUE
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok',               false,
        'skipped',          true,
        'reason',           'branch_has_pending_drafts',
        'erp_sucursal_id',  p_erp_sucursal_id
      );
    END IF;
  END IF;

  WITH branch_map AS (
    SELECT branch_id AS bid, erp_sucursal_id AS esid
    FROM erp_sucursal_map
    WHERE es_bodega = false
  ),
  -- Lo que una persona declaró sobre estos productos. Son POCAS filas (las
  -- cubre idx_psp_manual_at) y sólo las que traen motivo: un ajuste sin motivo
  -- protege el número al publicar, pero no le dice nada al cálculo.
  ajustes AS (
    SELECT erp_product_id, erp_sucursal_id, manual_motivo, manual_at,
           min_units AS manual_min_vigente, max_units AS manual_max_vigente,
           manual_cliente_unidades, manual_cliente_dias
    FROM product_stock_params
    WHERE manual_motivo IS NOT NULL
      AND erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR erp_sucursal_id = p_erp_sucursal_id)
  ),
  daily AS MATERIALIZED (
    SELECT
      bm.esid                                                                           AS erp_sucursal_id,
      ii.erp_product_id,
      inv.fecha,
      SUM(ii.cantidad::numeric
          * ii.factor_unidades) AS units,
      SUM(ii.total_linea)                                                               AS rev
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm      ON bm.bid = inv.branch_id
    -- «Ya no rota»: alguien dijo que este producto dejó de venderse, así que lo
    -- vendido ANTES de esa fecha no describe la demanda de mañana. LEFT JOIN y
    -- no NOT EXISTS a propósito: `ajustes` tiene pocas filas y entra por hash,
    -- mientras que un EXISTS correlacionado fijaría la dirección del join
    -- contra las 180,000 facturas del año (CLAUDE.md, medido el 2026-08-17).
    LEFT JOIN ajustes anr ON anr.erp_product_id  = ii.erp_product_id
                         AND anr.erp_sucursal_id = bm.esid
                         AND anr.manual_motivo   = 'ya_no_rota'
    WHERE inv.fecha         >= v_from
      AND (anr.manual_at IS NULL OR inv.fecha >= anr.manual_at::date)
      AND inv.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND ii.erp_product_id IS NOT NULL
      AND ii.cantidad        > 0
      AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
      AND NOT EXISTS (
        SELECT 1 FROM products p
        JOIN laboratorios l ON l.id = p.laboratorio_id
        WHERE p.id = ii.erp_product_id AND l.ocultar_en_minmax = true
      )
    GROUP BY bm.esid, ii.erp_product_id, inv.fecha
  ),
  daily_p95 AS (
    SELECT
      erp_sucursal_id,
      erp_product_id,
      PERCENTILE_CONT(cfg.outlier_percentile::float / 100.0)
          WITHIN GROUP (ORDER BY units) AS cap
    FROM daily
    GROUP BY erp_sucursal_id, erp_product_id
  ),
  -- Las sumas y el denominador real, separados del calculo de la velocidad para
  -- poder reusar data_days (un alias no se puede referenciar en el mismo SELECT).
  --
  -- F2.3 sigue vigente: el denominador arranca en la PRIMERA VENTA HISTORICA,
  -- que es lo unico que distingue un producto nuevo (no pudo vender los dias
  -- que no existia) de uno viejo con venta esporadica. Lo que cambio es de
  -- donde sale ese dato: antes una CTE `primera_venta` sin filtro de fecha que
  -- escaneaba las 578K filas de sales_invoice_items en CADA llamada (6 veces
  -- por corrida del cron, y el scan en frio de la PRIMERA sucursal es lo que
  -- reventó por statement timeout el 2026-08-01); ahora la MV
  -- mv_primera_venta_producto, que es una lectura de ~13K filas.
  --
  -- El LEAST(...) con MIN(d.fecha) NO es una aproximacion, es lo que hace el
  -- resultado EXACTO aunque la MV este desactualizada: si un producto se vendio
  -- por primera vez despues del ultimo refresh, no esta en la MV (pv.primera
  -- NULL, y LEAST ignora NULLs en Postgres) y su primera venta real es
  -- justamente su primera venta dentro de la ventana. Verificado contra la
  -- formula vieja: 13,526 productos, 0 diferencias.
  stats_raw AS (
    SELECT
      d.erp_sucursal_id,
      d.erp_product_id,
      SUM(d.units)::integer                                       AS sold_period,
      SUM(d.rev)                                                  AS rev_period,
      SUM(LEAST(d.units, p.cap))::numeric                         AS units_w,
      SUM(LEAST(d.units, p.cap) * LEAST(d.units, p.cap))::numeric AS units_w_sq,
      SUM(CASE WHEN d.fecha >= CURRENT_DATE - 30 THEN d.units ELSE 0 END)::numeric AS units_30d,
      LEAST(cfg.analysis_days,
            GREATEST(30, (CURRENT_DATE - GREATEST(LEAST(pv.primera, MIN(d.fecha)), v_from))::int + 1)) AS data_days,
      COUNT(DISTINCT d.fecha)                                     AS dias
    FROM daily d
    JOIN daily_p95 p ON p.erp_sucursal_id = d.erp_sucursal_id
                    AND p.erp_product_id  = d.erp_product_id
    LEFT JOIN public.mv_primera_venta_producto pv
                       ON pv.erp_sucursal_id = d.erp_sucursal_id
                      AND pv.erp_product_id  = d.erp_product_id
    GROUP BY d.erp_sucursal_id, d.erp_product_id, pv.primera
    HAVING COUNT(DISTINCT d.fecha) >= 1
  ),
  stats AS (
    SELECT
      sr.erp_sucursal_id, sr.erp_product_id, sold_period, rev_period, data_days, dias,
      -- «Cliente fijo»: «compra 20 cada 2 meses» es un dato mejor que un
      -- promedio de 180 días, que lo ve como pico irregular y lo winsoriza.
      CASE WHEN acf.manual_cliente_unidades > 0 AND acf.manual_cliente_dias > 0
           THEN acf.manual_cliente_unidades::numeric / acf.manual_cliente_dias
           ELSE units_w / data_days END   AS velocity,
      units_30d / 30        AS velocity_30d,
      ROUND((
        SQRT(GREATEST(0, units_w_sq / data_days - POWER(units_w / data_days, 2)))
        / NULLIF(units_w / data_days, 0) * 100
      )::numeric, 1) AS cv
    FROM stats_raw sr
    LEFT JOIN ajustes acf ON acf.erp_product_id  = sr.erp_product_id
                         AND acf.erp_sucursal_id = sr.erp_sucursal_id
                         AND acf.manual_motivo   = 'cliente_fijo'
  ),
  ranked AS (
    SELECT *,
      PERCENT_RANK() OVER (PARTITION BY erp_sucursal_id ORDER BY cv) AS cv_pctile,
      SUM(rev_period) OVER (
        PARTITION BY erp_sucursal_id
        ORDER BY rev_period DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )                                                    AS cum_rev,
      SUM(rev_period) OVER (PARTITION BY erp_sucursal_id) AS tot_rev
    FROM stats
    WHERE dias >= 3
  ),
  lead_times AS MATERIALIZED (
    SELECT erp_product_id, erp_sucursal_id, lead_time_days
    FROM product_stock_params
    WHERE lead_time_days IS NOT NULL AND erp_sucursal_id != 6
  ),
  classified AS (
    SELECT r.*,
      CASE
        WHEN r.tot_rev = 0                                               THEN 'D'
        WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_a_pct/100 THEN 'A'
        WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_b_pct/100 THEN 'B'
        ELSE                                                                  'C'
      END AS abc,
      CASE
        WHEN r.cv_pctile <= cfg.xyz_x_percentile / 100.0 THEN 'X'
        WHEN r.cv_pctile <= cfg.xyz_y_percentile / 100.0 THEN 'Y'
        ELSE                               'Z'
      END AS xyz,
      COALESCE(lt.lead_time_days,
        CASE
          WHEN r.cv_pctile <= cfg.xyz_x_percentile / 100.0 THEN cfg.reorder_x_days + cfg.buffer_x_days
          WHEN r.cv_pctile <= cfg.xyz_y_percentile / 100.0 THEN cfg.reorder_y_days + cfg.buffer_y_days
          ELSE                               cfg.reorder_z_days + cfg.buffer_z_days
        END
      ) AS effective_lead_days
    FROM ranked r
    LEFT JOIN lead_times lt ON lt.erp_product_id = r.erp_product_id
                            AND lt.erp_sucursal_id = r.erp_sucursal_id
  ),
  with_min AS (
    SELECT c.*,
      GREATEST(
        FLOOR(velocity * effective_lead_days)::int,
        CASE WHEN CEIL(velocity * cfg.cycle_days)::int > 1 THEN 1 ELSE 0 END,
        -- «Lo están buscando»: demanda real que el historial NO puede ver,
        -- porque nunca hubo producto que vender. El cálculo propondría cero
        -- para siempre, por diseño. El número que puso la persona es el piso.
        COALESCE(alb.manual_min_vigente, 0)
      ) AS computed_min,
      COALESCE(alb.manual_max_vigente, 0) AS piso_max
    FROM classified c
    LEFT JOIN ajustes alb ON alb.erp_product_id  = c.erp_product_id
                         AND alb.erp_sucursal_id = c.erp_sucursal_id
                         AND alb.manual_motivo   = 'lo_buscan'
  ),
  main_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
      calc_min, calc_max,
      draft_units_sold, draft_revenue, draft_data_days,
      draft_calculated_at, draft_status,
      updated_at
    )
    SELECT
      erp_product_id, erp_sucursal_id,
      abc,
      ROUND(velocity::numeric, 6),
      ROUND(velocity_30d::numeric, 6),
      cv, xyz,
      computed_min,
      GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1, piso_max),
      computed_min,
      GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1),
      sold_period, rev_period, data_days,
      v_now, 'pending',
      v_now
    FROM with_min
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      abc_class                  = EXCLUDED.draft_abc_class,
      daily_velocity              = EXCLUDED.draft_velocity,
      velocity_30d                 = EXCLUDED.draft_velocity_30d,
      cv                           = EXCLUDED.draft_cv,
      demand_variability            = EXCLUDED.draft_demand_variability,
      units_sold_6m                 = EXCLUDED.draft_units_sold,
      revenue_6m                    = EXCLUDED.draft_revenue,
      calculated_at                 = EXCLUDED.draft_calculated_at,
      draft_abc_class            = EXCLUDED.draft_abc_class,
      draft_velocity             = EXCLUDED.draft_velocity,
      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,
      draft_cv                   = EXCLUDED.draft_cv,
      draft_demand_variability   = EXCLUDED.draft_demand_variability,
      draft_min                  = EXCLUDED.draft_min,
      draft_max                  = EXCLUDED.draft_max,
      calc_min                   = EXCLUDED.calc_min,
      calc_max                   = EXCLUDED.calc_max,
      draft_units_sold           = EXCLUDED.draft_units_sold,
      draft_revenue              = EXCLUDED.draft_revenue,
      draft_data_days            = EXCLUDED.draft_data_days,
      draft_calculated_at        = EXCLUDED.draft_calculated_at,
      draft_status               = CASE
        WHEN product_stock_params.min_units IS NULL
          OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min
          OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max
        THEN 'pending'
        ELSE 'none'
      END,
      updated_at                 = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  ),
  sparse_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
      calc_min, calc_max,
      draft_units_sold, draft_revenue, draft_data_days,
      draft_calculated_at, draft_status,
      updated_at
    )
    SELECT
      erp_product_id, erp_sucursal_id,
      NULL,
      ROUND(velocity::numeric, 6),
      ROUND(velocity_30d::numeric, 6),
      NULL, NULL,
      NULL, NULL,
      NULL, NULL,
      sold_period, rev_period, data_days,
      v_now, 'sparse_data',
      v_now
    FROM stats
    WHERE dias BETWEEN 1 AND 2
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      draft_abc_class            = NULL,
      draft_velocity             = EXCLUDED.draft_velocity,
      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,
      draft_cv                   = NULL,
      draft_demand_variability   = NULL,
      draft_min                  = NULL,
      draft_max                  = NULL,
      calc_min                   = NULL,
      calc_max                   = NULL,
      draft_units_sold           = EXCLUDED.draft_units_sold,
      draft_revenue              = EXCLUDED.draft_revenue,
      draft_data_days            = EXCLUDED.draft_data_days,
      draft_calculated_at        = EXCLUDED.draft_calculated_at,
      draft_status               = 'sparse_data',
      updated_at                 = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  )
  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT erp_product_id FROM main_upsert
    UNION ALL
    SELECT erp_product_id FROM sparse_upsert
  ) combined;

  -- F2.5: los sparse_data que este recalculo NO volvio a escribir ya no tienen
  -- ni una venta en la ventana: dejan de ser "datos escasos".
  UPDATE product_stock_params
  SET draft_status             = 'none',
      draft_abc_class          = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_cv                 = NULL,
      draft_demand_variability = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_calculated_at      = NULL,
      updated_at               = v_now
  WHERE draft_status = 'sparse_data'
    AND erp_sucursal_id != 6
    AND (p_erp_sucursal_id IS NULL OR erp_sucursal_id = p_erp_sucursal_id)
    AND (draft_calculated_at IS NULL OR draft_calculated_at < v_now);

  GET DIAGNOSTICS v_sparse_reset = ROW_COUNT;

  -- F2.1: sin INSERT a product_stock_params_history — lo escribe
  -- trg_psp_capture_history, que ve este UPDATE igual que cualquier otro.
  WITH auto_apply AS (
    UPDATE product_stock_params psp
    SET
      abc_class                = psp.draft_abc_class,
      daily_velocity           = psp.draft_velocity,
      velocity_30d             = psp.draft_velocity_30d,
      cv                       = psp.draft_cv,
      demand_variability       = psp.draft_demand_variability,
      min_units                = psp.draft_min,
      max_units                = psp.draft_max,
      units_sold_6m            = psp.draft_units_sold,
      revenue_6m               = psp.draft_revenue,
      data_days                = psp.draft_data_days,
      calculated_at            = psp.draft_calculated_at,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_abc_class          = NULL,
      draft_demand_variability = NULL,
      draft_cv                 = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      published_at             = v_now,
      published_by             = 'auto',
      updated_at                = v_now
    WHERE psp.draft_status = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND psp.is_hidden IS NOT TRUE
      -- El auto-aplicar escribe min_units/max_units SIN pasar por
      -- publish_stock_params, así que el freno que se le puso allá no lo
      -- alcanzaba: era la cuarta puerta por la que un ajuste humano se perdía,
      -- y la peor, porque corre sola el día 1 sin que nadie lo decida.
      AND psp.manual_at IS NULL
      AND COALESCE(psp.min_units, 0) > 0
      AND COALESCE(psp.draft_min,  0) > 0
      AND COALESCE(psp.draft_max,  0) > 0
      -- El freno tiene DOS puertas y basta con pasar una.
      AND (
        -- Puerta 1, la de siempre: el cambio es chico EN PROPORCION.
        (    ABS(psp.draft_min - psp.min_units)::numeric / GREATEST(psp.min_units, 1) <= 0.40
         AND ABS(psp.draft_max - psp.max_units)::numeric / GREATEST(psp.max_units, 1) <= 0.40)
        -- Puerta 2, nueva: el cambio es chico EN DINERO. El costo unitario sale
        -- de la presentacion mas chica, IDENTICO a get_inventory_cost_summary:
        -- si la pantalla y el calculo midieran distinto, el numero que se ve no
        -- seria el que decide. Sin costo conocido la subconsulta da NULL, la
        -- comparacion da NULL y la puerta NO se abre — o sea que un producto
        -- sin costo sigue yendo a revision, que es la falla segura.
        OR (     ABS(psp.draft_max - psp.max_units) <= 10
             AND ABS(psp.draft_min - psp.min_units) <= 10
             AND ABS(psp.draft_max - psp.max_units) * (
                   SELECT pp.costo / pp.factor::numeric
                     FROM product_precios pp
                    WHERE pp.product_id = psp.erp_product_id
                      AND pp.activo AND pp.costo > 0 AND pp.factor > 0
                    ORDER BY pp.factor ASC
                    LIMIT 1
                 ) <= 50)
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_auto_applied FROM auto_apply;

  RETURN jsonb_build_object(
    'ok', true, 'rows', v_count,
    'auto_applied', v_auto_applied,
    'drafted', GREATEST(v_count - v_auto_applied, 0),
    'sparse_reset', v_sparse_reset,
    'at', v_now
  );
END;
$function$;


-- ── get_products_sold_no_minmax ─────────────────────────────────────────────
-- Identica a la viva salvo el filtro de estado.
CREATE OR REPLACE FUNCTION public.get_products_sold_no_minmax(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS TABLE(erp_product_id integer, product_name text, laboratorio text, units_sold bigint, revenue numeric, months_with_sales integer, invoice_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH branch_map(bid, esid) AS (
    VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),
           (28::bigint,4),(2::bigint,5),(29::bigint,7)
  )
  SELECT
    ii.erp_product_id,
    p.nombre,
    COALESCE(l.nombre, '—'),
    SUM(ii.cantidad::numeric)::bigint,
    ROUND(SUM(ii.total_linea)::numeric, 2),
    COUNT(DISTINCT DATE_TRUNC('month', inv.fecha))::integer,
    COUNT(DISTINCT ii.invoice_id)::integer
  FROM sales_invoice_items ii
  JOIN sales_invoices inv  ON inv.id  = ii.invoice_id
  JOIN branch_map bm       ON bm.bid  = inv.branch_id
    AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
  JOIN products p          ON p.id    = ii.erp_product_id AND p.activo = true
  LEFT JOIN laboratorios l ON l.id    = p.laboratorio_id
  WHERE inv.fecha  >= CURRENT_DATE - INTERVAL '6 months'
    AND inv.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND ii.erp_product_id IS NOT NULL AND ii.cantidad > 0
    AND NOT EXISTS (
      SELECT 1 FROM product_stock_params psp
      WHERE psp.erp_product_id = ii.erp_product_id
        AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
        AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
    )
  GROUP BY ii.erp_product_id, p.nombre, l.nombre
  ORDER BY SUM(ii.total_linea) DESC;
$function$;

-- ── get_no_sales_products ───────────────────────────────────────────────────
-- Identica a la viva salvo el filtro de estado.
CREATE OR REPLACE FUNCTION public.get_no_sales_products(p_erp_sucursal_id integer)
 RETURNS TABLE(erp_product_id integer, product_name text, current_stock bigint, cost_value numeric, fecha_vencimiento_min date, sold_in jsonb, min_qty numeric, max_qty numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH branch_map(bid, esid) AS (
    VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),
           (28::bigint,4),(2::bigint,5),(29::bigint,7)
  ),
  sales_6m AS (
    SELECT
      bm.esid                                                                                  AS suc_id,
      ii.erp_product_id                                                                        AS prod_id,
      SUM(ii.cantidad::numeric
          * COALESCE((regexp_match(ii.presentacion, '\d+[xX](\d+)'))[1]::int, 1))::bigint      AS units_sold,
      ROUND(SUM(ii.total_linea)::numeric, 2)                                                   AS revenue
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id  = ii.invoice_id
    JOIN branch_map bm      ON bm.bid = inv.branch_id
    WHERE inv.fecha  >= (CURRENT_DATE - INTERVAL '6 months')
      AND inv.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND ii.erp_product_id IS NOT NULL AND ii.cantidad > 0
    GROUP BY bm.esid, ii.erp_product_id
  ),
  inv_cur AS (
    SELECT
      inv.erp_product_id                                                                       AS prod_id,
      SUM(inv.cantidad
          * COALESCE((regexp_match(inv.detalle, '\d+[xX](\d+)'))[1]::int, 1))::bigint          AS total_units,
      MIN(inv.fecha_vencimiento) FILTER (WHERE inv.fecha_vencimiento IS NOT NULL)              AS min_venc
    FROM inventory inv
    WHERE inv.erp_sucursal_id = p_erp_sucursal_id AND inv.is_vencidos = false
    GROUP BY inv.erp_product_id
  ),
  unit_costs AS (
    SELECT DISTINCT ON (product_id) product_id, (costo / factor::numeric) AS unit_cost
    FROM product_precios
    WHERE activo = true AND costo > 0 AND factor > 0
    ORDER BY product_id, factor ASC
  ),
  minmax_cur AS (
    SELECT
      psp.erp_product_id                        AS prod_id,
      COALESCE(psp.manual_min, psp.min_units)   AS min_qty,
      COALESCE(psp.manual_max, psp.max_units)   AS max_qty
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id = p_erp_sucursal_id
      AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
  ),
  no_sales AS (
    SELECT p.id AS prod_id, p.nombre
    FROM products p
    WHERE p.activo = true
      AND NOT EXISTS (
        SELECT 1 FROM sales_6m sx WHERE sx.prod_id = p.id AND sx.suc_id = p_erp_sucursal_id
      )
      AND EXISTS (SELECT 1 FROM minmax_cur mm WHERE mm.prod_id = p.id)
  )
  SELECT
    ns.prod_id                                                          AS erp_product_id,
    ns.nombre                                                           AS product_name,
    COALESCE(ic.total_units, 0)                                        AS current_stock,
    ROUND(COALESCE(ic.total_units, 0) * COALESCE(uc.unit_cost, 0), 2) AS cost_value,
    ic.min_venc                                                         AS fecha_vencimiento_min,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('esid', s.suc_id, 'units', s.units_sold, 'rev', s.revenue)
        ORDER BY s.revenue DESC
      ) FILTER (WHERE s.suc_id IS NOT NULL),
      '[]'::jsonb
    )                                                                   AS sold_in,
    mm.min_qty,
    mm.max_qty
  FROM no_sales ns
  LEFT JOIN inv_cur    ic ON ic.prod_id    = ns.prod_id
  LEFT JOIN unit_costs uc ON uc.product_id = ns.prod_id
  LEFT JOIN minmax_cur mm ON mm.prod_id    = ns.prod_id
  LEFT JOIN sales_6m   s  ON s.prod_id    = ns.prod_id AND s.suc_id != p_erp_sucursal_id
  GROUP BY ns.prod_id, ns.nombre, ic.total_units, uc.unit_cost, ic.min_venc, mm.min_qty, mm.max_qty
  ORDER BY CASE WHEN COALESCE(ic.total_units, 0) > 0 THEN 0 ELSE 1 END, ns.nombre;
$function$;

-- ── get_stagnant_inventory ──────────────────────────────────────────────────
-- Identica a la viva salvo el filtro de estado.
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
  unit_costs AS (
    SELECT DISTINCT ON (product_id) product_id, (costo / factor::numeric) AS unit_cost
    FROM product_precios
    WHERE activo = true AND costo > 0 AND factor > 0
      AND product_id IN (SELECT prod_id FROM candidates_agg)
    ORDER BY product_id, factor ASC
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
