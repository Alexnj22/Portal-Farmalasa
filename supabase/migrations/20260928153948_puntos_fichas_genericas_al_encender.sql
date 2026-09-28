SET lock_timeout = '5s';

-- ═══ Las fichas genéricas dejan de acumular AL ENCENDER, no antes ═══════════
-- La migración anterior (`puntos_cumpleanos_ajustes_y_fichas_genericas`) las
-- marcaba `acumula_puntos = false` de inmediato. Eso despertó al puente viejo
-- (`sync-puntos-1min`), que RETIRA de la base anterior los tickets de toda ficha
-- que no acumula: en una sola corrida (15:37 UTC del 2026-09-28) retiró 499
-- tickets de esas fichas, todos del 1 al 5 de mayo de 2025, nunca presentados
-- (aplicado = 0, cero puntos restados). Se revirtió la marca a mano un minuto
-- después y la corrida siguiente retiró 0.
--
-- Hasta el 30-sep los tickets de esas fichas son exactamente los que la gente
-- PRESENTA para acumular en el sistema anterior. La marca va dentro de
-- `puntos_encender`, después de apagar el puente: ahí ya no hay a quién retirar.
-- Reescrita desde la definición VIVA; el único agregado es el bloque marcado.

-- Deja constancia de la reversión hecha a mano (idempotente).
UPDATE public.customers SET acumula_puntos = true
 WHERE (id, name) IN ((3299, 'CLIENTES VARIOS'), (22085, 'CLIENTE FRECUENTE'),
                      (11639, 'CLIENTE FRECUENTE NUEVO'), (9513, 'CLIENTE VIP (FRECUENTE)'))
   AND acumula_puntos IS DISTINCT FROM true;

CREATE OR REPLACE FUNCTION public.puntos_encender(p_inicio date, p_base_url text, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_url text; v_hecho text[] := '{}'; v_job text; v_gen integer;
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

  -- ── Agregado el 2026-09-28 ──────────────────────────────────────────────
  -- Las cuatro fichas genéricas dejan de acumular (decisión del usuario). Recién
  -- ahora: con el puente viejo apagado, marcarlas no retira ningún ticket.
  UPDATE public.customers SET acumula_puntos = false
   WHERE (id, name) IN ((3299, 'CLIENTES VARIOS'), (22085, 'CLIENTE FRECUENTE'),
                        (11639, 'CLIENTE FRECUENTE NUEVO'), (9513, 'CLIENTE VIP (FRECUENTE)'))
     AND acumula_puntos IS DISTINCT FROM false;
  GET DIAGNOSTICS v_gen = ROW_COUNT;
  v_hecho := array_append(v_hecho, format('fichas genéricas que dejan de acumular: %s', v_gen));
  -- ────────────────────────────────────────────────────────────────────────

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
$function$;
