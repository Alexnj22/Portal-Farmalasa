-- F3 · La cola de impresión: un índice para la pregunta que se hace cada 3 s.
--
-- `reclamar_impresion` corre ~7,400 veces por hora (el agente de cada caja
-- pregunta cada ~3 s) y en cada llamada devuelve a PENDIENTE lo que quedó
-- trabado imprimiendo:
--   UPDATE cola_impresion SET estado='PENDIENTE' ...
--    WHERE branch_id = v_sala AND estado = 'IMPRIMIENDO' AND reclamado_at < now() - '2 min'
-- `estado = 'IMPRIMIENDO'` no tenía índice parcial (PENDIENTE sí), así que
-- entraba por `idx_cola_impresion_reciente` y recorría TODA la historia de la
-- sala para no encontrar nada: medido en Salud 1 el 2026-09-22, 463 filas
-- descartadas y 206 bloques por llamada — 814,370 llamadas en 4.6 días, 1.2 TB
-- tocados. Crecía con cada ticket impreso.
--
-- El índice sólo contiene las filas IMPRIMIENDO (casi siempre ninguna). La tabla
-- pesa 2 MB: se crea en milisegundos, y el lock_timeout cubre el caso de que un
-- agente esté escribiendo justo en ese momento. No cambia ningún resultado.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_cola_impresion_imprimiendo
    ON public.cola_impresion (branch_id)
 WHERE estado = 'IMPRIMIENDO';
