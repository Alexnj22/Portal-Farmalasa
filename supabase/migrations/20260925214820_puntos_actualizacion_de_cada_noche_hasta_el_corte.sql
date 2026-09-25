SET lock_timeout = '5s';

-- ═══ La actualización de cada noche hasta el corte ══════════════════════════
-- Decisión del usuario (2026-09-25): migrar ya y el 1-oct sólo actualizar.
-- Hasta el 30-sep, cada noche:
--   04:30 UTC (22:30 SV)  puntos-archivar-noche       copia el sistema anterior
--   04:40 UTC (22:40 SV)  puntos-sincronizar-noche    trae al libro lo nuevo y cuadra
-- Las salas cierran a las 22:00: la copia ve el día completo. El comando lleva
-- la guarda de fecha — después del 30-sep no hay sistema anterior que copiar —,
-- y `puntos_encender` los borra la madrugada del arranque.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-archivar-noche') THEN
    PERFORM cron.unschedule('puntos-archivar-noche');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-sincronizar-noche') THEN
    PERFORM cron.unschedule('puntos-sincronizar-noche');
  END IF;
END $$;

SELECT cron.schedule('puntos-archivar-noche', '30 4 * * *', $c$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/puntos-archivar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) WHERE current_date <= DATE '2026-09-30';
$c$);

SELECT cron.schedule('puntos-sincronizar-noche', '40 4 * * *', $c$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/puntos-arranque',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := '{"simular": false, "encender": false}'::jsonb,
    timeout_milliseconds := 300000
  ) WHERE current_date <= DATE '2026-09-30';
$c$);

-- El arranque borra también los dos de cada noche.
CREATE OR REPLACE FUNCTION public.puntos_encender(p_inicio date, p_base_url text, p_simular boolean DEFAULT true)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_url text; v_hecho text[] := '{}'; v_job text;
BEGIN
  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'inicio', p_inicio,
      'apagaria', (SELECT coalesce(json_agg(jobname), '[]') FROM cron.job
                    WHERE jobname IN ('sync-puntos-1min','puntos-vencer-mensual') AND active),
      'crearia', 'puntos-motor-1min');
  END IF;

  UPDATE public.puntos_config
     SET inicio = p_inicio, acumulacion_activa = true, fuente = 'portal',
         nota = format('encendido el %s: el libro del portal manda desde el %s', now()::date, p_inicio),
         updated_at = now()
   WHERE id;

  PERFORM cron.alter_job(jobid, active := false) FROM cron.job
   WHERE jobname IN ('sync-puntos-1min', 'puntos-vencer-mensual') AND active;
  v_hecho := array_append(v_hecho, 'apagados sync-puntos-1min y puntos-vencer-mensual');

  IF p_base_url IS NULL OR p_base_url !~ '^https://[a-z0-9]+\.supabase\.co$' THEN
    RAISE EXCEPTION 'p_base_url inválida: %', p_base_url;
  END IF;
  v_url := p_base_url || '/functions/v1/puntos-motor';
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-motor-1min') THEN
    PERFORM cron.unschedule('puntos-motor-1min');
  END IF;
  PERFORM cron.schedule('puntos-motor-1min', '* 12-23,0-5 * * *', format($c$
    SELECT net.http_post(
      url     := %L,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $c$, v_url));
  v_hecho := array_append(v_hecho, 'creado puntos-motor-1min → ' || v_url);

  -- Los de una sola vez y los de cada noche ya cumplieron.
  FOREACH v_job IN ARRAY ARRAY['puntos-archivar-arranque', 'puntos-arranque-1oct',
                               'puntos-archivar-noche', 'puntos-sincronizar-noche'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job) THEN
      PERFORM cron.unschedule(v_job);
    END IF;
  END LOOP;

  RETURN json_build_object('simulado', false, 'inicio', p_inicio, 'hecho', v_hecho);
END;
$$;
