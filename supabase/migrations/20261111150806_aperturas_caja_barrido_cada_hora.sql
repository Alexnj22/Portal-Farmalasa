-- Aperturas de caja: el barrido pasa de cada 30 minutos a cada hora
-- (2026-11-11, pedido del usuario: bajar consultas al sistema de origen).
--
-- Medido ese día: 257 de las 258 aperturas de seis semanas se hicieron desde
-- el portal, y `operar-caja` ahora le pide a `sync-aperturas-caja` que mire
-- esa sala apenas abre (`branchId`), así que la fila nace en el momento. El
-- cierre ya lo marcaba `operar-caja`, y el inicio de turno también. La sala ve
-- siempre el estado leído en vivo (MiCajaView y la app relen el origen después
-- de pintar). El barrido queda como red para lo hecho directo en la caja.
--
-- 34 corridas × 19 peticiones = 646/día pasan a 17 × 19 = 323, más ~4 por
-- apertura del portal (~6 al día). Los crons de la mañana (6:50–7:20) no se
-- tocan: mandan el aviso de apertura.
SET lock_timeout = '5s';

SELECT cron.alter_job(
  job_id   := (SELECT jobid FROM cron.job WHERE jobname = 'aperturas-caja-30min'),
  schedule := '0 12-23,0-4 * * *'
)
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aperturas-caja-30min');
