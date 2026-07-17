SET lock_timeout = '5s';

-- Hallazgo de altitud del /code-review de cierre de la auditoría MinMax
-- 2026-07-17: la fórmula "efectivo = publicado + manual" (el fix central de
-- Fase 1 / C-1) quedó reimplementada inline en 3 funciones SQL de lectura
-- (get_stock_analysis, get_pedido_preview, get_network_summary_json) sin un
-- punto único de verdad — exactamente el patrón de duplicación que causó el
-- bug original. Centraliza SOLO la parte realmente común (base + manual) en
-- minmax_effective(); el fallback a draft_min/draft_max de get_stock_analysis
-- (que las otras dos funciones NO tienen) queda fuera de la función, correcto
-- porque no es un comportamiento universal.
-- LANGUAGE sql IMMUTABLE de una sola expresión — Postgres puede inlinearla en
-- el plan de consulta; overhead esperado nulo/insignificante incluso si no se
-- inlinea (suma de 2 enteros por fila).
-- Probado en staging (ewcmerxqjvludtgskuin): las 3 funciones compilan y usan
-- minmax_effective(. Verificado en prod con hashes antes/después (ver diff
-- acumulado): 0 cambios de valor.
CREATE OR REPLACE FUNCTION public.minmax_effective(p_base integer, p_manual integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE($1, 0) + COALESCE($2, 0)
$function$;

REVOKE ALL ON FUNCTION public.minmax_effective(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minmax_effective(integer, integer) TO authenticated, service_role;

DO $do$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc WHERE proname = 'get_stock_analysis' AND pronamespace = 'public'::regnamespace;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'get_stock_analysis no encontrada'; END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;

  IF position('(COALESCE(psp.min_units, psp.draft_min, 0) + COALESCE(psp.manual_min, 0))::int AS eff_min' in v_def) = 0 THEN
    RAISE EXCEPTION 'Patrón eff_min (psp) no encontrado en get_stock_analysis — abortar';
  END IF;
  IF position('(COALESCE(psp.max_units, psp.draft_max, 0) + COALESCE(psp.manual_max, 0))::int AS eff_max' in v_def) = 0 THEN
    RAISE EXCEPTION 'Patrón eff_max (psp) no encontrado en get_stock_analysis — abortar';
  END IF;
  IF position('COALESCE(psp3.min_units, psp3.draft_min,0)::int + COALESCE(psp3.manual_min,0)::int,' in v_def) = 0 THEN
    RAISE EXCEPTION 'Patrón min (psp3) no encontrado en get_stock_analysis — abortar';
  END IF;
  IF position('COALESCE(psp3.max_units, psp3.draft_max,0)::int + COALESCE(psp3.manual_max,0)::int,' in v_def) = 0 THEN
    RAISE EXCEPTION 'Patrón max (psp3) no encontrado en get_stock_analysis — abortar';
  END IF;

  v_def := replace(v_def,
    '(COALESCE(psp.min_units, psp.draft_min, 0) + COALESCE(psp.manual_min, 0))::int AS eff_min',
    'minmax_effective(COALESCE(psp.min_units, psp.draft_min, 0), psp.manual_min)::int AS eff_min');
  v_def := replace(v_def,
    '(COALESCE(psp.max_units, psp.draft_max, 0) + COALESCE(psp.manual_max, 0))::int AS eff_max',
    'minmax_effective(COALESCE(psp.max_units, psp.draft_max, 0), psp.manual_max)::int AS eff_max');
  v_def := replace(v_def,
    'COALESCE(psp3.min_units, psp3.draft_min,0)::int + COALESCE(psp3.manual_min,0)::int,',
    'minmax_effective(COALESCE(psp3.min_units, psp3.draft_min,0), psp3.manual_min)::int,');
  v_def := replace(v_def,
    'COALESCE(psp3.max_units, psp3.draft_max,0)::int + COALESCE(psp3.manual_max,0)::int,',
    'minmax_effective(COALESCE(psp3.max_units, psp3.draft_max,0), psp3.manual_max)::int,');

  EXECUTE v_def;
END;
$do$;

DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_hits_min int;
  v_hits_max int;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc WHERE proname = 'get_pedido_preview' AND pronamespace = 'public'::regnamespace;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'get_pedido_preview no encontrada'; END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;

  v_hits_min := (length(v_def) - length(replace(v_def, 'COALESCE(psp.min_units,0) + COALESCE(psp.manual_min,0)', ''))) / length('COALESCE(psp.min_units,0) + COALESCE(psp.manual_min,0)');
  v_hits_max := (length(v_def) - length(replace(v_def, 'COALESCE(psp.max_units,0) + COALESCE(psp.manual_max,0)', ''))) / length('COALESCE(psp.max_units,0) + COALESCE(psp.manual_max,0)');

  IF v_hits_min <> 1 OR v_hits_max <> 4 THEN
    RAISE EXCEPTION 'Patrón inesperado en get_pedido_preview: hits_min=% (esperado 1), hits_max=% (esperado 4) — abortar', v_hits_min, v_hits_max;
  END IF;

  v_def := replace(v_def, 'COALESCE(psp.min_units,0) + COALESCE(psp.manual_min,0)', 'minmax_effective(psp.min_units, psp.manual_min)');
  v_def := replace(v_def, 'COALESCE(psp.max_units,0) + COALESCE(psp.manual_max,0)', 'minmax_effective(psp.max_units, psp.manual_max)');

  EXECUTE v_def;
END;
$do$;

DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_hits_min int;
  v_hits_max int;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc WHERE proname = 'get_network_summary_json' AND pronamespace = 'public'::regnamespace;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'get_network_summary_json no encontrada'; END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;

  v_hits_min := (length(v_def) - length(replace(v_def, 'COALESCE(min_units, 0) + COALESCE(manual_min, 0)', ''))) / length('COALESCE(min_units, 0) + COALESCE(manual_min, 0)');
  v_hits_max := (length(v_def) - length(replace(v_def, 'COALESCE(max_units, 0) + COALESCE(manual_max, 0)', ''))) / length('COALESCE(max_units, 0) + COALESCE(manual_max, 0)');

  IF v_hits_min <> 1 OR v_hits_max <> 1 THEN
    RAISE EXCEPTION 'Patrón inesperado en get_network_summary_json: hits_min=% (esperado 1), hits_max=% (esperado 1) — abortar', v_hits_min, v_hits_max;
  END IF;

  v_def := replace(v_def, 'COALESCE(min_units, 0) + COALESCE(manual_min, 0)', 'minmax_effective(min_units, manual_min)');
  v_def := replace(v_def, 'COALESCE(max_units, 0) + COALESCE(manual_max, 0)', 'minmax_effective(max_units, manual_max)');

  EXECUTE v_def;
END;
$do$;
