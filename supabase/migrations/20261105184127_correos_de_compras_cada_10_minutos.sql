SET lock_timeout = '5s';
-- Las facturas de compra llegan por correo a cualquier hora y Bodega las carga
-- el mismo día: una vez al día (3:00 SV) las dejaba sin ver hasta la madrugada
-- siguiente. Pedido del usuario (2026-11-05): cada 10 minutos. No toca el
-- sistema de origen: lee el buzón y salta los mensajes ya procesados.
SELECT cron.alter_job(jobid, schedule := '*/10 * * * *')
FROM cron.job WHERE jobname = 'sync-purchase-emails-daily'
  AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-purchase-emails-daily');
