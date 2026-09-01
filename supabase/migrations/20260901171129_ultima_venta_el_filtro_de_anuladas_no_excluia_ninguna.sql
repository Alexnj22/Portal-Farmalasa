SET lock_timeout = '5s';

-- El filtro de anuladas de las cuatro funciones de última venta comparaba
-- contra 'ANULADA', un valor que sales_invoices.estado no tuvo nunca: la
-- condición era siempre verdadera y no descartaba una sola factura. Sus tres
-- valores reales son FINALIZADA, DTE INVALIDADO EN MH y NULA.
-- Se cambia SÓLO esa línea en cada cuerpo vivo; el resto queda idéntico.

CREATE OR REPLACE FUNCTION public.fn_update_product_last_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_fecha         DATE;
    v_sucursal_id   INTEGER;
    v_units         NUMERIC;
    v_days          INTEGER;
BEGIN
    IF NEW.erp_product_id IS NULL OR NEW.erp_product_id = 0 OR NEW.cantidad <= 0 THEN
        RETURN NEW;
    END IF;

    SELECT inv.fecha::date, esm.erp_sucursal_id
      INTO v_fecha, v_sucursal_id
      FROM sales_invoices inv
      JOIN erp_sucursal_map esm ON esm.branch_id = inv.branch_id AND esm.es_bodega = false
     WHERE inv.id = NEW.invoice_id AND inv.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
     LIMIT 1;

    IF v_fecha IS NULL THEN RETURN NEW; END IF;

    INSERT INTO product_last_sale (erp_product_id, erp_sucursal_id, last_sale_date)
    VALUES (NEW.erp_product_id, v_sucursal_id, v_fecha)
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE
      SET last_sale_date = EXCLUDED.last_sale_date
      WHERE EXCLUDED.last_sale_date > product_last_sale.last_sale_date;

    -- F3.1: rollup incremental de ventas. Solo suma lo que cae DENTRO de la
    -- ventana; la cola la recorta el refresh diario.
    SELECT analysis_days INTO v_days FROM stock_config WHERE id = 1;
    IF v_days IS NOT NULL AND v_fecha >= CURRENT_DATE - v_days THEN
        v_units := NEW.cantidad::numeric * COALESCE(NEW.factor_unidades, 1);

        INSERT INTO product_sales_rollup AS r
          (erp_product_id, erp_sucursal_id, units_analysis, units_30d, analysis_days, updated_at)
        VALUES (
          NEW.erp_product_id, v_sucursal_id,
          v_units,
          CASE WHEN v_fecha >= CURRENT_DATE - 30 THEN v_units ELSE 0 END,
          v_days, now()
        )
        ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE
          SET units_analysis = r.units_analysis + EXCLUDED.units_analysis,
              units_30d      = r.units_30d      + EXCLUDED.units_30d,
              updated_at     = now();
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_last_sale_dates(p_erp_sucursal_id integer)
 RETURNS TABLE(erp_product_id integer, last_sale_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    ii.erp_product_id,
    MAX(inv.fecha)::date AS last_sale_date
  FROM sales_invoice_items ii
  JOIN sales_invoices inv       ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map bm      ON bm.branch_id = inv.branch_id
  WHERE bm.erp_sucursal_id = p_erp_sucursal_id
    AND inv.estado         NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND ii.erp_product_id  IS NOT NULL
    AND ii.cantidad         > 0
  GROUP BY ii.erp_product_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_product_last_sales(p_erp_product_id integer, p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS TABLE(fecha date, cantidad numeric, total_linea numeric, cliente text, erp_sucursal_id integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    inv.fecha::date,
    (ii.cantidad::numeric
      * COALESCE((regexp_match(ii.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1)) AS cantidad,
    ii.total_linea,
    inv.cliente,
    bm.erp_sucursal_id
  FROM sales_invoice_items ii
  JOIN sales_invoices inv  ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map bm ON bm.branch_id = inv.branch_id
  WHERE ii.erp_product_id  = p_erp_product_id
    AND (p_erp_sucursal_id IS NULL OR bm.erp_sucursal_id = p_erp_sucursal_id)
    AND inv.estado          NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND ii.cantidad          > 0
  ORDER BY inv.fecha DESC, inv.id DESC
  LIMIT 6;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_product_sales_rollup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_days     integer;
  v_upserted integer := 0;
  v_deleted  integer := 0;
BEGIN
  SELECT analysis_days INTO v_days FROM public.stock_config WHERE id = 1;
  IF v_days IS NULL THEN
    RAISE EXCEPTION 'NO_CONFIG: stock_config id=1 no existe';
  END IF;

  SET LOCAL work_mem = '128MB';

  CREATE TEMP TABLE _psr_agg ON COMMIT DROP AS
  SELECT
    esm.erp_sucursal_id,
    ii.erp_product_id,
    SUM(ii.cantidad::numeric * ii.factor_unidades) AS units_analysis,
    SUM(CASE WHEN inv.fecha >= CURRENT_DATE - 30
             THEN ii.cantidad::numeric * ii.factor_unidades
             ELSE 0 END)                           AS units_30d
  FROM sales_invoice_items ii
  JOIN sales_invoices inv    ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map esm  ON esm.branch_id = inv.branch_id AND esm.es_bodega = false
  WHERE inv.fecha         >= CURRENT_DATE - v_days
    AND inv.estado        NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND ii.erp_product_id IS NOT NULL
    AND ii.cantidad        > 0
  GROUP BY esm.erp_sucursal_id, ii.erp_product_id;

  WITH up AS (
    INSERT INTO public.product_sales_rollup AS r
      (erp_product_id, erp_sucursal_id, units_analysis, units_30d, analysis_days, updated_at)
    SELECT a.erp_product_id, a.erp_sucursal_id, a.units_analysis, a.units_30d, v_days, now()
    FROM _psr_agg a
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE
      SET units_analysis = EXCLUDED.units_analysis,
          units_30d      = EXCLUDED.units_30d,
          analysis_days  = EXCLUDED.analysis_days,
          updated_at     = now()
      WHERE (r.units_analysis, r.units_30d, r.analysis_days)
         IS DISTINCT FROM (EXCLUDED.units_analysis, EXCLUDED.units_30d, EXCLUDED.analysis_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_upserted FROM up;

  DELETE FROM public.product_sales_rollup r
  WHERE NOT EXISTS (
    SELECT 1 FROM _psr_agg a
    WHERE a.erp_product_id = r.erp_product_id
      AND a.erp_sucursal_id = r.erp_sucursal_id
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'analysis_days', v_days,
    'upserted', v_upserted,
    'deleted', v_deleted,
    'at', now()
  );
END;
$function$;
