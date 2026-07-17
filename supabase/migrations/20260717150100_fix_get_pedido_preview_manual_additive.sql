SET lock_timeout = '5s';

-- Fase 1.1.d de la auditoría MinMax 2026-07-17: get_pedido_preview leía manual_min/manual_max
-- como REEMPLAZO (COALESCE(manual, min_units)) mientras get_stock_analysis los interpreta como
-- delta ADITIVO. Migra a la misma fórmula aditiva. Aplicado con replace() sobre el cuerpo real
-- de la función (no reescritura manual) para no arriesgar una transcripción imperfecta de sus
-- ~500 líneas.
DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_hits_min int;
  v_hits_max int;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  WHERE p.proname = 'get_pedido_preview' AND p.pronamespace = 'public'::regnamespace;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'get_pedido_preview no encontrada';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  v_hits_min := (length(v_def) - length(replace(v_def, 'COALESCE(psp.manual_min, psp.min_units, 0)', ''))) / length('COALESCE(psp.manual_min, psp.min_units, 0)');
  v_hits_max := (length(v_def) - length(replace(v_def, 'COALESCE(psp.manual_max, psp.max_units, 0)', ''))) / length('COALESCE(psp.manual_max, psp.max_units, 0)');

  IF v_hits_min <> 1 OR v_hits_max <> 4 THEN
    RAISE EXCEPTION 'Patrón inesperado en get_pedido_preview: hits_min=% (esperado 1), hits_max=% (esperado 4) — abortar, revisar manualmente', v_hits_min, v_hits_max;
  END IF;

  v_def := replace(v_def,
    'COALESCE(psp.manual_min, psp.min_units, 0)',
    '(COALESCE(psp.min_units,0) + COALESCE(psp.manual_min,0))');
  v_def := replace(v_def,
    'COALESCE(psp.manual_max, psp.max_units, 0)',
    '(COALESCE(psp.max_units,0) + COALESCE(psp.manual_max,0))');

  EXECUTE v_def;
END;
$do$;
