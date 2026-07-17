SET lock_timeout = '5s';

-- Pedido del usuario 2026-07-18: la clasificación X/Y/Z usaba un corte de CV
-- FIJO y global (X≤150%, Y≤400%, Z>400%) igual para las 6 sucursales de
-- venta. Con sucursales de volumen bajo (ej. Salud 5: ~20-40x menos
-- velocidad promedio que las demás), NINGÚN producto baja de 400% de CV —
-- toda la matriz ABC×XYZ cae en Z, sin diferenciación real dentro de esa
-- sucursal. Fix: percentiles RELATIVOS por sucursal en vez de corte
-- absoluto — el tercio/quinto más estable de CADA sucursal (comparado
-- contra sus propios vecinos) es X, etc. Calibrado con la distribución real
-- ya observada en sucursales de volumen normal (~4-5% X, ~30-40% Y, ~55-60%
-- Z) para no reventar la clasificación en las sucursales que ya funcionan
-- bien — solo Salud 5 (100% Z hoy) gana diferenciación real.
--
-- Nota de riesgo verificada: reorder_x_days = reorder_y_days = reorder_z_days
-- = 25 (los 3 iguales) en stock_config al momento de este cambio, así que
-- este fix NO altera ningún MIN/MAX ya calculado — solo corrige la etiqueta
-- X/Y/Z. Si en el futuro se vuelven a diferenciar los días de reorden por
-- clase, este fix ya deja la clasificación lista para que eso tenga sentido
-- también en sucursales de bajo volumen.
--
-- Verificado con simulación de solo-lectura contra datos reales de prod:
-- sucursales 1-5 quedan en ~5%/30%/65% (muy cerca de su distribución actual
-- 2-5%/26-40%/50-61%); Salud 5 pasa de 0%/0%/100% a 15%/24%/61% — gana
-- diferenciación real.
ALTER TABLE public.stock_config
  ADD COLUMN IF NOT EXISTS xyz_x_percentile numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS xyz_y_percentile numeric NOT NULL DEFAULT 35;

UPDATE public.stock_config SET xyz_x_percentile = 5, xyz_y_percentile = 35 WHERE id = 1;

DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_hits_ranked int;
  v_hits_x int;
  v_hits_y int;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc WHERE proname = 'calculate_stock_params' AND pronamespace = 'public'::regnamespace;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'calculate_stock_params no encontrada'; END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;

  v_hits_ranked := (length(v_def) - length(replace(v_def, E'  ranked AS (\n    SELECT *,\n      SUM(rev_period) OVER (', ''))) / length(E'  ranked AS (\n    SELECT *,\n      SUM(rev_period) OVER (');
  v_hits_x := (length(v_def) - length(replace(v_def, 'r.cv <= cfg.xyz_x_cv_max', ''))) / length('r.cv <= cfg.xyz_x_cv_max');
  v_hits_y := (length(v_def) - length(replace(v_def, 'r.cv <= cfg.xyz_y_cv_max', ''))) / length('r.cv <= cfg.xyz_y_cv_max');

  IF v_hits_ranked <> 1 OR v_hits_x <> 2 OR v_hits_y <> 2 THEN
    RAISE EXCEPTION 'Patrón inesperado en calculate_stock_params: ranked=% (esperado 1), x=% (esperado 2), y=% (esperado 2) — abortar', v_hits_ranked, v_hits_x, v_hits_y;
  END IF;

  v_def := replace(v_def,
    E'  ranked AS (\n    SELECT *,\n      SUM(rev_period) OVER (',
    E'  ranked AS (\n    SELECT *,\n      PERCENT_RANK() OVER (PARTITION BY erp_sucursal_id ORDER BY cv) AS cv_pctile,\n      SUM(rev_period) OVER (');
  v_def := replace(v_def, 'r.cv <= cfg.xyz_x_cv_max', 'r.cv_pctile <= cfg.xyz_x_percentile / 100.0');
  v_def := replace(v_def, 'r.cv <= cfg.xyz_y_cv_max', 'r.cv_pctile <= cfg.xyz_y_percentile / 100.0');

  EXECUTE v_def;
END;
$do$;
