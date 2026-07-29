SET lock_timeout = '5s';

-- Sigue a 20260717180000. Verificado en vivo: get_network_summary_json da
-- 3990 filas (igual que la vieja), el fix aditivo de manual_* coincide con
-- get_stock_analysis (producto 5044/suc.6: 400 vs 257 mal calculado por la
-- vieja), y el fix de factor corrige un sub-conteo real (producto 322/suc.7:
-- 24 unidades reales vs 2 que mostraba el regex roto sobre "1X1"). Frontend
-- ya migrado a la nueva RPC en el mismo commit. get_network_summary (vieja)
-- también otorgaba EXECUTE a anon — se va con el DROP.
DROP FUNCTION IF EXISTS public.get_network_summary();
