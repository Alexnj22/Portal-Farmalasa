-- F3.1 — product_sales_rollup: sacar el CTE live_sales de get_stock_analysis.
--
-- Medido: get_stock_analysis_jsonb lleva 199 llamadas, media 1,550 ms, maximo
-- 7,452 ms, 308 s acumulados. De esos, el CTE `live_sales` son 983 ms de 1,085 ms
-- (medido en Bodega): escanea 574,848 lineas de sales_invoice_items y 133,260
-- facturas EN CADA CARGA, y todo eso solo para pisar dos columnas
-- (units_sold_6m y velocity_30d).
--
-- DECISION (plan, 2026-07-29): el dato se mantiene EN VIVO, no se degrada al
-- snapshot del ultimo recalculo. Se resuelve con una tabla de rollup
-- incremental — el mismo patron que esta misma funcion ya usa en su CTE
-- `last_sale` (product_last_sale, 16,670 filas, mantenida por
-- fn_update_product_last_sale).
--
-- Por que no se reusa product_sales_monthly_agg (que ya existe y ya tiene su
-- cron): es MENSUAL, esta por presentacion/descripcion y guarda `cantidad` sin
-- aplicar factor_unidades. La ventana de 180 dias no cae en bordes de mes y las
-- unidades no son comparables. No sirve.
--
-- ══ Frescura y reconciliacion ══
--
-- · El trigger (abajo) suma cada linea nueva en el momento en que entra, asi
--   que intradia el dato esta tan vivo como hoy.
-- · La cola de las ventanas (lo que va SALIENDO de los 180 / 30 dias) no la
--   puede mover un trigger de INSERT. La corrige el job diario de 06:30 UTC,
--   que recalcula de cero. Entre refresh y refresh, la ventana puede incluir
--   hasta un dia de mas — que es exactamente lo que significa una ventana con
--   borde diario.
-- · Lo mismo para las facturas ANULADAS despues de insertarse y para los
--   resyncs mensuales que borran y reinsertan lineas: el trigger solo suma, y
--   el refresh diario reconcilia.
--
-- El refresh usa `ON CONFLICT DO UPDATE ... WHERE (cols) IS DISTINCT FROM
-- (EXCLUDED.cols)` — obligatorio por CLAUDE.md: un upsert incondicional de la
-- tabla completa todos los dias es lo que quemo el Disk IO budget con
-- `inventory` (935M de updates sobre 24K filas).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.product_sales_rollup (
  erp_product_id  integer     NOT NULL,
  erp_sucursal_id integer     NOT NULL,
  units_analysis  numeric     NOT NULL DEFAULT 0,   -- unidades base en la ventana de analysis_days
  units_30d       numeric     NOT NULL DEFAULT 0,   -- idem, ultimos 30 dias
  analysis_days   integer     NOT NULL,             -- la ventana con la que se calculo esta fila
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (erp_product_id, erp_sucursal_id)
);

-- Sin FK a products/erp_sucursal_map, igual que product_last_sale: el sync de
-- DTE inserta lineas de productos que todavia no llegaron por el sync de
-- productos, y una FK ahi aborta el sync entero (por eso se removio la de
-- sales_invoice_items — ver project_dte_sync_state).

-- La PK cubre la busqueda por producto. Este indice cubre el caso de una sola
-- sucursal, que es el 6 de cada 7 llamadas de get_stock_analysis.
CREATE INDEX IF NOT EXISTS idx_psr_sucursal_producto
  ON public.product_sales_rollup (erp_sucursal_id, erp_product_id);

ALTER TABLE public.product_sales_rollup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS psr_select ON public.product_sales_rollup;
CREATE POLICY psr_select ON public.product_sales_rollup
  FOR SELECT TO authenticated USING (true);
-- Sin policies de escritura: solo la escriben el trigger y la RPC DEFINER.

REVOKE ALL ON TABLE public.product_sales_rollup FROM anon;
GRANT SELECT ON TABLE public.product_sales_rollup TO authenticated;


-- ── El refresh completo (reconciliacion diaria) ──────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_product_sales_rollup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
    AND inv.estado        != 'ANULADA'
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

  -- Se fue de la ventana por completo: la fila sobra.
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

REVOKE EXECUTE ON FUNCTION public.refresh_product_sales_rollup() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.refresh_product_sales_rollup() TO service_role;


-- ── Backfill inicial ─────────────────────────────────────────────────────────

SELECT public.refresh_product_sales_rollup();


-- ── El trigger: se cuelga del que ya mantiene product_last_sale ──────────────
--
-- Es AFTER INSERT FOR EACH ROW sobre sales_invoice_items y ya hacia un SELECT a
-- sales_invoices + un upsert por linea. Se le agrega el segundo upsert en vez de
-- crear otro trigger: mismo lookup, una sola pasada.

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
     WHERE inv.id = NEW.invoice_id AND inv.estado != 'ANULADA'
     LIMIT 1;

    IF v_fecha IS NULL THEN RETURN NEW; END IF;

    INSERT INTO product_last_sale (erp_product_id, erp_sucursal_id, last_sale_date)
    VALUES (NEW.erp_product_id, v_sucursal_id, v_fecha)
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE
      SET last_sale_date = EXCLUDED.last_sale_date
      WHERE EXCLUDED.last_sale_date > product_last_sale.last_sale_date;

    -- F3.1: rollup incremental de ventas. Solo suma lo que cae DENTRO de la
    -- ventana; la cola la recorta el refresh diario (ver cabecera).
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


-- ── Cron diario ──────────────────────────────────────────────────────────────
--
-- 06:30 UTC: dentro de la ventana 06:00-11:59 en la que los syncs por minuto
-- (12-23,0-5) estan quietos, y en un minuto donde no hay ningun otro job
-- (06:10 purge-sync-logs, 06:20 refresh-sales-daily-stats-full). Un solo job
-- mas — no un burst: 13 jobs a la misma hora fue lo que agoto los slots de
-- conexion en su momento.
--
-- Corre DESPUES de los dte-resync-month del dia 1 (05:00), asi que el resync
-- mensual queda reconciliado el mismo dia.

SELECT cron.unschedule('refresh-product-sales-rollup-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-product-sales-rollup-daily');

SELECT cron.schedule(
  'refresh-product-sales-rollup-daily',
  '30 6 * * *',
  $$SELECT public.refresh_product_sales_rollup()$$
);
