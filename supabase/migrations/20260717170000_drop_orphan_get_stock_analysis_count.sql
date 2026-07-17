SET lock_timeout = '5s';

-- Fase 3.2 de la auditoría MinMax 2026-07-17: get_stock_analysis_count quedó sin
-- callers en src/ desde v2.9.28 (migración a get_stock_analysis_jsonb, Patrón C).
-- Documentado explícitamente en src/version.js:2441. get_minmax_comparison (el otro
-- huérfano listado en la auditoría original) ya no existe en la base — no requiere
-- DROP.
DROP FUNCTION IF EXISTS public.get_stock_analysis_count(integer);
