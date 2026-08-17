-- Cada hora al minuto 20. `cron.schedule` con un nombre que ya existe lo
-- REEMPLAZA, así que esto es idempotente y se puede reaplicar sin duplicar.
--
-- Una hora y no cada minuto: el candado de verdad es el hook, que niega el token
-- en el acto. Esto es higiene —que «sesión viva» en la pantalla signifique algo—
-- y no hace falta que sea inmediato.
SELECT cron.schedule('purge-sesiones-vencidas', '20 * * * *', $$ SELECT public.purge_idle_sessions(); $$);
