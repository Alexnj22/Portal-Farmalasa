SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- C1b/C8 — que la ficha se complete SOLA, no cuando alguien se acuerde.
--
-- El hook que lee la columna 4 vive en `fastBackfill`, y el cron de cada 10
-- minutos usa el sync normal: sin esto, C1b/C8 solo correría cuando una persona
-- dispara un backfill a mano. Una capacidad que depende de que alguien se
-- acuerde no está terminada.
--
-- ── Por qué SEMANAL y no diario ────────────────────────────────────────────
-- `fastBackfill` hace un upsert **incondicional** de las columnas del libro, y
-- la regla del proyecto prohíbe eso en un sync recurrente (el churn de WAL del
-- incidente de `inventory`). Acá son ~900 filas por corrida, no una tabla
-- entera, pero el principio manda: una vez por semana el costo es despreciable y
-- el beneficio se mantiene — un proveedor nuevo tarda como mucho 7 días en tener
-- su ficha, contra el infinito de hoy.
--
-- De paso mantiene el sello al día donde el origen lo emite. (Ojo: NO lo va a
-- completar en todas las sucursales — el origen manda la columna 22 llena en
-- Bodega y vacía en Salud 1/2/4 y La Popular. Ver §11 del doc de formato.)
--
-- 09:00 UTC = 03:00 en El Salvador, domingo: dentro de la ventana 06:00-11:59
-- UTC en que los crons de sync están quietos.
--
-- Ventana de 10 días, que es el tope que aguanta la fuente en una sola llamada
-- (medido: 167s en un mes, contra los 150s que vive la respuesta).
-- ═══════════════════════════════════════════════════════════════════════════
SELECT cron.schedule(
  'purchases-fastbackfill-semanal',
  '0 9 * * 0',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-erp-purchases',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := jsonb_build_object(
      'fastBackfill', true,
      'fini', to_char((current_timestamp AT TIME ZONE 'America/El_Salvador')::date - 10, 'YYYY-MM-DD'),
      'ffin', to_char((current_timestamp AT TIME ZONE 'America/El_Salvador')::date,      'YYYY-MM-DD')
    ),
    timeout_milliseconds := 140000
  );
  $cron$
);
