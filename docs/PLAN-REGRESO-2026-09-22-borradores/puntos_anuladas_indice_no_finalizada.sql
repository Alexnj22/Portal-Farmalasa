-- BORRADOR — NO APLICADO. F7, tercera pieza. Aplicar el 2026-09-23 entre 06:00 y
-- 11:59 UTC junto con `pendiente_mh_indice_sin_sello.sql` (misma tabla caliente,
-- misma ventana sin syncs), con `apply_migration`, y archivarlo con la versión
-- que devuelva el servidor.
--
-- `puntos_ventas_anuladas` corre cada minuto desde `sync-puntos` y busca las
-- facturas que se mandaron a puntos y después se anularon. Para hallar las
-- 1,066 no finalizadas recorre entero el índice `idx_si_fecha_estado_branch`
-- —373,856 entradas— filtrando por `estado <> 'FINALIZADA'`: medido el
-- 2026-09-22, **13,113 bloques y 67 ms por corrida**, o sea 0.6 TB por semana
-- para no encontrar, casi siempre, nada.
--
-- El índice parcial contiene sólo esas 1,066 filas. No cambia ningún resultado:
-- es el mismo predicado.
--
-- Lo mismo que en F6: sin CONCURRENTLY porque `apply_migration` corre en una
-- transacción; el lock es SHARE (no frena lecturas) y la ventana sin syncs evita
-- que haya escritores. Si choca, `lock_timeout` lo corta: reintentar.
--
-- Verificar antes/después con:
--   EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
--   SELECT pe.invoice_id FROM public.puntos_enviados pe
--     JOIN public.sales_invoices si ON si.id = pe.invoice_id
--    WHERE pe.anulada_at IS NULL AND si.estado <> 'FINALIZADA'
--    ORDER BY pe.fecha DESC LIMIT 1500;
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_si_no_finalizada
    ON public.sales_invoices (id)
 WHERE estado <> 'FINALIZADA';
