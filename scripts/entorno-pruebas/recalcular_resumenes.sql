-- Recalcula los resúmenes que leen el Inicio, Ventas y Mín·Máx en el branch de
-- pruebas. Lo corre `mantener_al_dia.mjs` DESPUÉS de `correr_fechas.sql`: si
-- las facturas se mueven a hoy y los resúmenes no, el Inicio muestra ventas en
-- días donde ya no hay facturas.
DO $guarda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE username = 'pruebas')
     OR (SELECT count(*) FROM public.sales_invoices) > 50000 THEN
    RAISE EXCEPTION 'Sólo en el branch de pruebas.';
  END IF;
END
$guarda$;

-- ── Los resúmenes que leen el Inicio, Ventas y Mín·Máx ───────────────────
-- Cada uno por separado: si uno no existe o falla en el branch, los demás
-- igual se recalculan.
DO $resumenes$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'SELECT public.refresh_sales_daily_stats(95)',
    'SELECT public.refresh_product_sales_monthly_agg(4)',
    'SELECT public.refresh_product_sales_rollup()',
    'SELECT public.refresh_product_last_sale()',
    'SELECT public.refresh_customer_activity()']
  LOOP
    BEGIN
      EXECUTE f;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo recalcular (%): %', f, SQLERRM;
    END;
  END LOOP;
END
$resumenes$;

