SET lock_timeout = '5s';

-- ── La hora tope del cierre del día ────────────────────────────────────────
--
-- El disparador natural es el último Z (`trg_cortes_caja_cierre_del_dia`), y es
-- el que va a mandar el aviso casi todas las noches. Esto es la red: el día que
-- una sala NO cierre, el aviso no saldría nunca — y «no llegó» se lee igual que
-- «no pasó nada», que es exactamente el peor resultado posible para un aviso
-- cuyo trabajo es contar cómo fue el día.
--
-- Con `p_forzado` sale igual y la tarjeta dice «No cerraron: …», que esa noche
-- es LA noticia. La marca en `avisos_emitidos` evita el duplicado cuando el Z
-- sí entró: si el trigger ya lo mandó, esto no manda nada.
--
-- 05:50 UTC = 23:50 en El Salvador, diez minutos después del
-- `cortes-caja-repaso-diario` de las 23:40 — que es el que puede traer un corte
-- capturado tarde. El orden importa: forzar antes del repaso mandaría el aviso
-- sin el último Z que estaba por llegar.
SELECT cron.schedule(
  'cierre-del-dia-hora-tope',
  '50 5 * * *',
  $$SELECT public.avisar_cierre_del_dia((now() AT TIME ZONE 'America/El_Salvador')::date, true)$$
);
