SET lock_timeout = '5s';

-- ── La última venta se recalcula, no sólo se acumula ─────────────────────────
--
-- `product_last_sale` la escribía SÓLO el disparador `fn_update_product_last_sale`,
-- al INSERTAR el renglón de venta, y con `WHERE EXCLUDED.last_sale_date >
-- product_last_sale.last_sale_date`: o sea que la fecha sube y NUNCA baja.
--
-- La anulación llega después. Cuando el sync marca la factura como anulada, el
-- renglón ya está contado y nadie vuelve a sacarlo — así que corregir el
-- literal 'ANULADA' (migración 20260901171129) arregla lo que entre de acá en
-- adelante y no toca nada de lo ya escrito.
--
-- Medido el 2026-09-01, con los MISMOS criterios del disparador (`es_bodega =
-- false`, cantidad > 0, erp_product_id no nulo ni 0): de 16,896 filas, 34
-- tienen la fecha equivocada —hasta 195 días más nueva de lo real— y 11 son de
-- productos que NUNCA se vendieron: su única venta estaba anulada. Nueve de
-- esas 45 cruzan el corte de 90 días con el que `calculate_stock_params`
-- decide si congela una baja de máximo, o sea que hoy esa decisión se toma con
-- una fecha que no existió.
--
-- Y no es un arrastre histórico que se limpia una vez: se anulan ~65 facturas
-- por mes de forma sostenida (60/55/54/70/81/75/57 de feb a ago), así que sin
-- un barrido la tabla se vuelve a ensuciar sola y en silencio.
--
-- Por eso esto es una FUNCIÓN con su cron y no un UPDATE suelto: la tabla
-- gemela (`product_sales_rollup`) ya se recalcula entera cada día y por eso se
-- corrigió sola en cuanto se arregló el literal. Ésta no tenía ese barrido, y
-- esa ausencia era la causa de fondo.
--
-- El agregado completo cuesta ~1.07 s y entra por índice en las dos tablas
-- grandes (index-only scan sobre `idx_sii_invoice_covering` y
-- `idx_si_fecha_estado_branch`, sin Seq Scan) — medido con TIMING OFF, que es
-- el número que no miente. Se recalcula TODO el historial y no una ventana: la
-- fecha de un producto que no se vende hace dos años sigue siendo un dato, y
-- una ventana la borraría.

CREATE OR REPLACE FUNCTION public.refresh_product_last_sale()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_upserted integer := 0;
  v_deleted  integer := 0;
BEGIN
  SET LOCAL work_mem = '128MB';

  CREATE TEMP TABLE _pls_agg ON COMMIT DROP AS
  SELECT
    esm.erp_sucursal_id,
    ii.erp_product_id,
    MAX(inv.fecha::date) AS last_sale_date
  FROM sales_invoice_items ii
  JOIN sales_invoices inv    ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map esm  ON esm.branch_id = inv.branch_id AND esm.es_bodega = false
  WHERE inv.estado        NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND ii.erp_product_id IS NOT NULL
    AND ii.erp_product_id <> 0
    AND ii.cantidad        > 0
  GROUP BY esm.erp_sucursal_id, ii.erp_product_id;

  /* A diferencia del disparador, acá la fecha PUEDE bajar: es justamente lo que
   * el disparador no sabe hacer y lo que deja la anulación sin efecto. El
   * `IS DISTINCT FROM` evita reescribir las ~16,850 filas que no cambiaron
   * (prohibido el upsert incondicional en algo que corre solo). */
  WITH up AS (
    INSERT INTO public.product_last_sale AS r (erp_product_id, erp_sucursal_id, last_sale_date)
    SELECT a.erp_product_id, a.erp_sucursal_id, a.last_sale_date
    FROM _pls_agg a
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE
      SET last_sale_date = EXCLUDED.last_sale_date
      WHERE r.last_sale_date IS DISTINCT FROM EXCLUDED.last_sale_date
    RETURNING 1
  )
  SELECT count(*) INTO v_upserted FROM up;

  /* Lo que ya no tiene NINGUNA venta real se borra, no se deja en cero: una
   * fila ausente significa «nunca se vendió», que es la verdad. Es lo que leen
   * `get_stagnant_inventory` (EXISTS) y `calculate_stock_params`. */
  DELETE FROM public.product_last_sale r
  WHERE NOT EXISTS (
    SELECT 1 FROM _pls_agg a
    WHERE a.erp_product_id  = r.erp_product_id
      AND a.erp_sucursal_id = r.erp_sucursal_id
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'upserted', v_upserted,
    'deleted', v_deleted,
    'at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.refresh_product_last_sale() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_product_last_sale() TO service_role;

-- 06:45 UTC: después del rollup de las 06:30 para no pelearle el work_mem, y
-- dentro de la ventana en que los crons de sync están quietos (corren 12-23,0-5).
SELECT cron.schedule(
  'refresh-product-last-sale-daily',
  '45 6 * * *',
  $cron$SELECT public.refresh_product_last_sale()$cron$
);
