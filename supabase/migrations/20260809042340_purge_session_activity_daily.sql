SET lock_timeout = '5s';

-- Retención de session_activity desde el día 1 (regla 8 de la estructura de BD
-- en CLAUDE.md). El criterio no es la edad: es que la sesión ya no exista.
-- Mientras GoTrue mantenga viva una sesión, su fila de actividad tiene que
-- seguir ahí — si se borrara por vieja, el hook la vería «sin fila» y la dejaría
-- pasar, que es justo lo contrario de lo que se busca.
--
-- Horario elegido para no pisar los otros dos purgadores (04:30 y 06:10 UTC).
SELECT cron.schedule(
  'purge-session-activity-daily',
  '25 6 * * *',
  $cron$
    DELETE FROM public.session_activity sa
    WHERE NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = sa.session_id);
  $cron$
);
