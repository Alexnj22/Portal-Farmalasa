-- BORRADOR — NO APLICADO. Preparado el 2026-09-22 (plan D6), el usuario lo dejó
-- para después.
--
-- `reclamar_impresion` corre ~7,400 veces por hora (el agente de cada caja
-- pregunta cada ~3 s) y en cada llamada hace
--   UPDATE cola_impresion SET estado='PENDIENTE' ...
--    WHERE branch_id = v_sala AND estado = 'IMPRIMIENDO' AND reclamado_at < now() - '2 min'
-- `estado = 'IMPRIMIENDO'` no tiene índice parcial (PENDIENTE sí), así que entra
-- por `idx_cola_impresion_reciente` y recorre TODA la historia de la sala:
-- medido en Salud 1, 461 filas descartadas y 205 bloques por llamada, 814,370
-- llamadas en 4.6 días (1.2 TB tocados). Crece con cada ticket impreso.
-- La tabla pesa 2 MB: el índice se crea en milisegundos.
-- Verificar antes/después con:
--   EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT id FROM public.cola_impresion
--    WHERE branch_id = 4 AND estado = 'IMPRIMIENDO' AND reclamado_at < now() - interval '2 minutes';
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_cola_impresion_imprimiendo
    ON public.cola_impresion (branch_id)
 WHERE estado = 'IMPRIMIENDO';
