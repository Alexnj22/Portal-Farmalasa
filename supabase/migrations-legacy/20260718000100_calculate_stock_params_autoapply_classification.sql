SET lock_timeout = '5s';

-- Corrección al fix de percentiles XYZ (20260718000000): el usuario pidió que
-- un cambio de clasificación ABC/XYZ que NO viene acompañado de un cambio
-- real de MIN/MAX se aplique en vivo automáticamente (silencioso), en vez de
-- marcar el producto como "pendiente de revisión" — la revisión manual debe
-- reservarse para cuando el NÚMERO de MIN/MAX cambia (igual que ya funciona
-- hoy con el umbral de auto-apply ±40%), no por un simple relabeling.
--
-- Antes: draft_status pasaba a 'pending' si abc_class O demand_variability
-- cambiaban, aunque min_units/max_units quedaran exactamente iguales — con
-- el fix de percentiles XYZ, la próxima corrida de "Calcular" iba a marcar
-- miles de productos como pendientes solo por el relabeling.
--
-- Fix: main_upsert ahora sincroniza SIEMPRE en vivo (abc_class,
-- daily_velocity, velocity_30d, cv, demand_variability, units_sold_6m,
-- revenue_6m, calculated_at) igual que ya hacía con calc_min/calc_max —
-- son campos informativos, no decisiones de stock, no necesitan revisión
-- humana. draft_status='pending' ahora depende ÚNICAMENTE de si
-- min_units/max_units cambiarían — la clasificación deja de poder disparar
-- una revisión por sí sola. No se toca sparse_upsert (datos insuficientes
-- sigue sin togar la clasificación en vivo) ni el bloque auto_apply
-- existente (sigue igual para el caso donde SÍ hay cambio de MIN/MAX dentro
-- del ±40%).
--
-- Probado en staging con 2 casos sintéticos: (1) solo cambia clasificación
-- (B/Y→A/X), MIN/MAX igual → abc_class/demand_variability se sincronizan en
-- vivo, draft_status queda 'none'; (2) MIN/MAX real cambia (10/20→15/25) →
-- sigue yendo a 'pending' como antes. Re-verificado igual en prod antes de
-- limpiar.
DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_hits1 int;
  v_hits2 int;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc WHERE proname = 'calculate_stock_params' AND pronamespace = 'public'::regnamespace;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'calculate_stock_params no encontrada'; END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;

  v_hits1 := (length(v_def) - length(replace(v_def, E'draft_abc_class            = EXCLUDED.draft_abc_class,\n      draft_velocity             = EXCLUDED.draft_velocity,\n      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,\n      draft_cv                   = EXCLUDED.draft_cv,\n      draft_demand_variability   = EXCLUDED.draft_demand_variability,\n      draft_min                  = EXCLUDED.draft_min,', '')))
    / length(E'draft_abc_class            = EXCLUDED.draft_abc_class,\n      draft_velocity             = EXCLUDED.draft_velocity,\n      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,\n      draft_cv                   = EXCLUDED.draft_cv,\n      draft_demand_variability   = EXCLUDED.draft_demand_variability,\n      draft_min                  = EXCLUDED.draft_min,');

  v_hits2 := (length(v_def) - length(replace(v_def, E'draft_status               = CASE\n        WHEN product_stock_params.min_units IS NULL\n          OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min\n          OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max\n          OR product_stock_params.abc_class  IS DISTINCT FROM EXCLUDED.draft_abc_class\n          OR product_stock_params.demand_variability IS DISTINCT FROM EXCLUDED.draft_demand_variability\n        THEN ''pending''\n        ELSE ''none''\n      END,', '')))
    / length(E'draft_status               = CASE\n        WHEN product_stock_params.min_units IS NULL\n          OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min\n          OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max\n          OR product_stock_params.abc_class  IS DISTINCT FROM EXCLUDED.draft_abc_class\n          OR product_stock_params.demand_variability IS DISTINCT FROM EXCLUDED.draft_demand_variability\n        THEN ''pending''\n        ELSE ''none''\n      END,');

  IF v_hits1 <> 1 OR v_hits2 <> 1 THEN
    RAISE EXCEPTION 'Patrón inesperado en calculate_stock_params: hits1=% (esperado 1), hits2=% (esperado 1) — abortar', v_hits1, v_hits2;
  END IF;

  v_def := replace(v_def,
    E'draft_abc_class            = EXCLUDED.draft_abc_class,\n      draft_velocity             = EXCLUDED.draft_velocity,\n      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,\n      draft_cv                   = EXCLUDED.draft_cv,\n      draft_demand_variability   = EXCLUDED.draft_demand_variability,\n      draft_min                  = EXCLUDED.draft_min,',
    E'abc_class                  = EXCLUDED.draft_abc_class,\n      daily_velocity              = EXCLUDED.draft_velocity,\n      velocity_30d                 = EXCLUDED.draft_velocity_30d,\n      cv                           = EXCLUDED.draft_cv,\n      demand_variability            = EXCLUDED.draft_demand_variability,\n      units_sold_6m                 = EXCLUDED.draft_units_sold,\n      revenue_6m                    = EXCLUDED.draft_revenue,\n      calculated_at                 = EXCLUDED.draft_calculated_at,\n      draft_abc_class            = EXCLUDED.draft_abc_class,\n      draft_velocity             = EXCLUDED.draft_velocity,\n      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,\n      draft_cv                   = EXCLUDED.draft_cv,\n      draft_demand_variability   = EXCLUDED.draft_demand_variability,\n      draft_min                  = EXCLUDED.draft_min,');

  v_def := replace(v_def,
    E'draft_status               = CASE\n        WHEN product_stock_params.min_units IS NULL\n          OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min\n          OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max\n          OR product_stock_params.abc_class  IS DISTINCT FROM EXCLUDED.draft_abc_class\n          OR product_stock_params.demand_variability IS DISTINCT FROM EXCLUDED.draft_demand_variability\n        THEN ''pending''\n        ELSE ''none''\n      END,',
    E'draft_status               = CASE\n        WHEN product_stock_params.min_units IS NULL\n          OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min\n          OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max\n        THEN ''pending''\n        ELSE ''none''\n      END,');

  EXECUTE v_def;
END;
$do$;
