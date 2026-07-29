SET lock_timeout = '5s';

-- Fase 3.3 / B-2 de la auditoría MinMax 2026-07-17: calculate_stock_params usaba
-- regexp_match(ii.presentacion, '[0-9]+[xX]([0-9]+)') para el factor de unidades,
-- violando la regla del proyecto "factor SIEMPRE de product_precios / nunca regex"
-- (get_stock_analysis ya usa ii.factor_unidades, columna pre-calculada e indexada).
-- Verificado en vivo antes de aplicar: 0 discrepancias entre el valor del regex y
-- factor_unidades en las 559,150 filas de sales_invoice_items — el cambio no altera
-- ningún MIN/MAX ya calculado, solo evita el regex por fila (más rápido) y deja de
-- violar el estándar. Aplicado con replace() sobre el cuerpo real (evita transcribir
-- a mano el resto de la función).
DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_hits int;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  WHERE p.proname = 'calculate_stock_params' AND p.pronamespace = 'public'::regnamespace;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'calculate_stock_params no encontrada';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  v_hits := (length(v_def) - length(replace(v_def,
    'COALESCE((regexp_match(ii.presentacion,''[0-9]+[xX]([0-9]+)''))[1]::int, 1)', '')))
    / length('COALESCE((regexp_match(ii.presentacion,''[0-9]+[xX]([0-9]+)''))[1]::int, 1)');

  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'Patrón inesperado en calculate_stock_params: hits=% (esperado 1) — abortar, revisar manualmente', v_hits;
  END IF;

  v_def := replace(v_def,
    'COALESCE((regexp_match(ii.presentacion,''[0-9]+[xX]([0-9]+)''))[1]::int, 1)',
    'ii.factor_unidades');

  EXECUTE v_def;
END;
$do$;
