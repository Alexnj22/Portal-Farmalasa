-- El auto-aplicar de MIN·MAX gana una segunda puerta: el DINERO.
--
-- Hasta hoy el freno era uno solo y era RELATIVO: si el par se movia mas del
-- ±40%, iba a revision. Un criterio relativo sobre numeros chicos marca todo —
-- un producto que pasa de MAX 3 a MAX 5 es +67% y termina en la lista de
-- alguien, aunque sean dos unidades de algo que cuesta $2.
--
-- Medido contra produccion el 2026-09-01, sobre las 2,082 filas que el
-- recalculo de esa manana dejo en borrador:
--
--   por que estaba en la lista            filas
--   saltaba mas del ±40%                  1,053   (54%)
--   tenia marca de ajuste manual            553   (28%)
--   empieza o deja de tenerse en sala       337   (17%)
--
-- Con la puerta del dinero, 640 de esas 1,053 entran solas y la lista baja a
-- 1,442. Lo que se aplica sin que nadie lo mire son cambios de a lo sumo 10
-- unidades y $50 de inventario; el neto por sala va de -$72 a +$609.
--
-- Lo que queda es de otra naturaleza, y por eso NO se toca acá:
--   553  estan por su marca manual — nunca vuelven al automatico (deuda aparte)
--   818  el producto empieza o deja de tenerse — es una decision de verdad
--    71  el numero se movio mucho Y mueve dinero — esto SI hay que revisarlo
--
-- O sea: de ~347 filas por sala, las que de verdad piden criterio son ~12.
--
-- Las dos puertas son OR: basta pasar una. La puerta 1 no se toco, asi que
-- todo lo que hoy entra solo sigue entrando igual — este cambio solo AGREGA
-- casos, nunca quita. Y un producto sin costo conocido (125 filas, 7 de las
-- pendientes) da NULL en la comparacion, la puerta 2 no se abre, y sigue
-- yendo a revision: la falla segura.
--
-- El resto del cuerpo es identico a 20260821151427.

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
      AND inv.estado        != 'ANULADA'
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
