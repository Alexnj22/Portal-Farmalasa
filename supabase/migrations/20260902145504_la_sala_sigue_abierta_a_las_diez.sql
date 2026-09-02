SET lock_timeout = '5s';

/* La ventana llegaba hasta las 9pm y el usuario la corrigió: «de 7 a 10 pm, a
 * las 10 sigue abierto». O sea que la hora de las 10 entera cuenta — 04:00 a
 * 04:59 UTC—, no hasta las 10 en punto.
 *
 * 13-23,0-4 UTC = 7:00am a 10:59pm SV. Pasa de 90 a 102 corridas por día.
 *
 * Vale escribirlo: una ventana que termina cuando la sala TODAVÍA está
 * vendiendo no da error ni deja hueco visible — simplemente lo último del día
 * aparece a la mañana siguiente, y eso se lee como «el portal no lo trajo».
 */
SELECT cron.alter_job(jobid, schedule := '*/10 13-23,0-4 * * *')
FROM cron.job WHERE jobname = 'creditos-cada-10min';
