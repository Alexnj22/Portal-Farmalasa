-- «Facturas de mi sala»: se quitan los restos de la base (2026-11-13).
--
-- La pantalla y el widget se quitaron en v2.1432.0 (4-nov, «quítalo»), pero
-- quedaron vivos el cron que intenta ligar las facturas reservadas
-- (`verificar-facturas-reclamadas-2h`, cada 2 horas, sobre una tabla con 0
-- filas) y 25 permisos del módulo en `role_permissions` que ya no consulta
-- nadie. El usuario lo reconfirmó el 13-nov: «facturas de mi sala se quita».
--
-- Las tablas y funciones se QUEDAN (guardan qué se tomó hasta hoy, igual que
-- decidió v2.1432.0). Sólo se apaga el cron y se borran los permisos huérfanos.
SET lock_timeout = '5s';

SELECT cron.unschedule(jobid)
  FROM cron.job
 WHERE jobname = 'verificar-facturas-reclamadas-2h';

DELETE FROM public.role_permissions
 WHERE module_key IN ('facturas_sala', 'facturas_sala_ver_montos', 'dash_facturas_sala');
