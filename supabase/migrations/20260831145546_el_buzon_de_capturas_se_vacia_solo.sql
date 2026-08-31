SET lock_timeout = '5s';

-- El buzón de `capturas/` se vacía solo, cada hora.
--
-- «Si no se guarda, se debe descartar / borrar. Sólo se debe guardar si queda
-- guardado y anexado al empleado» (usuario, 2026-08-31).
--
-- El caso normal ya no llega acá: la computadora llama a `soltar-captura` en
-- cuanto baja la foto. Esto recoge lo ABANDONADO — el diálogo que se cerró, la
-- señal que se fue, el formulario que nadie terminó. Sin esto ese resto se
-- acumula sin techo: medido antes de la primera corrida, 31 archivos y 12.4 MB
-- en tres días, y son DUIs, contratos y constancias de personas.
--
-- Cada hora y no cada día porque lo que se guarda son documentos de identidad:
-- el tiempo que un papel ajeno pasa en un buzón que ya nadie mira es la única
-- variable que este cron controla.
--
-- Lleva `Authorization` además del `x-cron-secret` porque la función está
-- desplegada con `verify_jwt: true` — la llama también el navegador, y ahí el
-- JWT es lo que la protege. La llave anónima es un JWT válido: pasa la puerta,
-- y adentro quien autoriza el barrido es el secreto de cron.
SELECT cron.schedule(
  'soltar-capturas-abandonadas',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/soltar-captura',
    body := '{"barrer":true}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='anon_key'),
      'x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_invoke_secret')),
    timeout_milliseconds := 60000
  );
  $$
);
