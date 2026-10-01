-- Cada 5 minutos en horario de sala (6:00–23:59 SV): el aviso tiene que llegar
-- mientras la persona todavía está en la caja. Cuesta ~26 ms por vuelta.
SELECT cron.schedule('puntos-vigilar-irregularidades', '*/5 12-23,0-5 * * *',
  $$SELECT public.puntos_vigilar_irregularidades()$$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-vigilar-irregularidades');
