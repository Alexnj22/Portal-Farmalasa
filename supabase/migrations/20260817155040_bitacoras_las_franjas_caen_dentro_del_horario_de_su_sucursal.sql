SET lock_timeout = '5s';

-- Franjas nuevas, pedidas por el usuario el 2026-08-17: la de la manana de 7 a
-- 9, la del mediodia de 12 a 2 y la de la tarde de 5 a 7. Las anteriores eran
-- de 3 horas (08-11, 12-15, 16-19).
--
-- ── Por que NO son las mismas para todos ───────────────────────────────────
-- Las seis FARMACIAS abren 07:00 y cierran entre 19:00 y 22:00, asi que las
-- tres ventanas pedidas caen enteras dentro de su horario.
--
-- La BODEGA central abre 08:00 y cierra 17:00. Con la ventana de la tarde en
-- 17:00-19:00 su lectura vespertina caeria SIEMPRE fuera del horario: nadie
-- podria anotarla nunca, y el cierre del mes informaria un faltante diario que
-- no es un incumplimiento sino un error de configuracion. Un hueco que se
-- genera solo ensena a ignorar los huecos, que es justo lo contrario de para
-- que existe la bitacora. Asi que la bodega lleva 08-10 / 12-14 / 15-17, que es
-- la misma idea (temprano, medio dia, antes de cerrar) dentro de SU dia.
--
-- Lo mismo con su limpieza: apertura 07:00-10:00 empezaba una hora antes de que
-- abriera, y cierre 17:00-20:00 entero despues de cerrar.
--
-- Y por eso mismo la bodega deja de esperar registros el DOMINGO: su
-- `weekly_hours` dice isOpen=false y sus areas pedian los siete dias.
--
-- Es un cambio de configuracion, no de datos: hay 0 lecturas y 0 limpiezas
-- registradas (verificado), asi que no reescribe ningun mes ya contado.

-- 1 · Las farmacias: lo que pidio el usuario, tal cual.
UPDATE public.bitacora_areas a
   SET franjas = jsonb_build_array(
           jsonb_build_object('clave','m','label','Mañana',  'desde','07:00','hasta','09:00'),
           jsonb_build_object('clave','d','label','Mediodía','desde','12:00','hasta','14:00'),
           jsonb_build_object('clave','t','label','Tarde',   'desde','17:00','hasta','19:00'))
  FROM public.branches b
 WHERE b.id = a.branch_id
   AND b.type = 'FARMACIA'
   AND a.tipo IN ('sala_ventas','bodega');

-- 2 · La bodega central: la misma idea dentro de su horario de 08:00 a 17:00.
UPDATE public.bitacora_areas a
   SET franjas = jsonb_build_array(
           jsonb_build_object('clave','m','label','Mañana',  'desde','08:00','hasta','10:00'),
           jsonb_build_object('clave','d','label','Mediodía','desde','12:00','hasta','14:00'),
           jsonb_build_object('clave','t','label','Tarde',   'desde','15:00','hasta','17:00')),
       limpiezas = jsonb_build_array(
           jsonb_build_object('clave','apertura','label','Apertura','desde','08:00','hasta','10:00'),
           jsonb_build_object('clave','cierre',  'label','Cierre',  'desde','15:00','hasta','17:00')),
       dias_semana = '{1,2,3,4,5,6}'::smallint[]
  FROM public.branches b
 WHERE b.id = a.branch_id
   AND b.type = 'BODEGA'
   AND a.tipo = 'bodega';

-- 3 · El refrigerador lleva dos lecturas al dia, no tres, y vive en la bodega.
UPDATE public.bitacora_areas a
   SET franjas = jsonb_build_array(
           jsonb_build_object('clave','m','label','Mañana','desde','08:00','hasta','10:00'),
           jsonb_build_object('clave','t','label','Tarde', 'desde','15:00','hasta','17:00')),
       dias_semana = '{1,2,3,4,5,6}'::smallint[]
  FROM public.branches b
 WHERE b.id = a.branch_id
   AND b.type = 'BODEGA'
   AND a.tipo = 'refrigerador';
