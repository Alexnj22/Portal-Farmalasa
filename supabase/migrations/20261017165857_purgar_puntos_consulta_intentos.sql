SET lock_timeout = '5s';

-- `puntos_consulta_intentos` guarda la IP de cada intento de entrar a «Mis
-- puntos» y a la app, para frenar a quien prueba documentos. Su comentario
-- decía «se purga a los 30 días» desde el 2026-08-30, pero ningún cron lo
-- hacía: la fila más vieja era de ese día. El aviso de privacidad v2 no
-- promete un plazo; esto lo vuelve cierto. El freno mira minutos, no meses.
SELECT cron.schedule('purge-puntos-consulta-intentos', '35 9 * * *',
  $$DELETE FROM public.puntos_consulta_intentos WHERE created_at < now() - interval '30 days'$$);
