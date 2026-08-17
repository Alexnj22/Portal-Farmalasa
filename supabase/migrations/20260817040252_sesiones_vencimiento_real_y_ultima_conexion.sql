SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Dos huecos medidos el 2026-08-17 y la pieza que faltaba para la pantalla.
--
-- 1. `custom_access_token_hook` decía `IF FOUND AND ...`: una sesión que NUNCA
--    latió no tiene fila en `session_activity`, así que su límite de
--    inactividad no se aplicaba jamás. Medido: una sesión real viva desde el
--    11-ago sin una sola fila de latido, y 81 de la cuenta de pruebas.
--
-- 2. `touch_session` bumpeaba `last_seen_at` sin preguntar. Al volver a una
--    pestaña oculta, el navegador late y REVIVE una sesión que el hook ya iba a
--    rechazar. La ventana la fija cuánto vive el token — medido sobre 799
--    renovaciones reales: mediana 15 min, mínimo 13. O sea que un límite de 5
--    minutos valía ~20 en la práctica.
--
-- 3. `revoke_session`/`revoke_person_sessions` borran de `session_activity`, así
--    que cerrar una conexión borraba también el rastro de cuándo entró esa
--    persona. `session_last_seen` guarda UNA fila por persona y no la toca
--    nadie más: es lo que deja ver la última conexión aunque no quede ninguna
--    sesión viva.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. La última conexión de una persona, a prueba de purgas ─────────────────
CREATE TABLE IF NOT EXISTS public.session_last_seen (
  user_id      uuid        PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  device_class text        NOT NULL DEFAULT 'navegador',
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.session_last_seen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS session_last_seen_select ON public.session_last_seen;
CREATE POLICY session_last_seen_select ON public.session_last_seen
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('sesiones', 'can_view')));

-- Sin policy de escritura a propósito: la llena `touch_session`, que es DEFINER.

-- Semilla: lo que ya se sabe de `session_activity` no se pierde al purgar.
INSERT INTO public.session_last_seen (user_id, last_seen_at, device_class)
SELECT sa.user_id,
       max(sa.last_seen_at),
       (array_agg(sa.device_class ORDER BY sa.last_seen_at DESC))[1]
  FROM public.session_activity sa
 GROUP BY sa.user_id
ON CONFLICT (user_id) DO UPDATE
  SET last_seen_at = greatest(public.session_last_seen.last_seen_at, EXCLUDED.last_seen_at);

-- ── 2. El latido no revive una sesión ya vencida ─────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_session(p_device_class text DEFAULT 'navegador'::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session uuid;
  v_user    uuid;
  v_clase   text;
  v_fila    public.session_activity%ROWTYPE;
  v_hay     boolean;
  v_limite  integer;
BEGIN
  -- El session_id sale del JWT, NUNCA de un parámetro: quien llama no puede
  -- elegir qué sesión está renovando.
  v_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_user    := auth.uid();
  IF v_session IS NULL OR v_user IS NULL THEN
    RETURN;
  END IF;

  v_clase := CASE WHEN p_device_class = 'app' THEN 'app' ELSE 'navegador' END;

  SELECT * INTO v_fila FROM public.session_activity WHERE session_id = v_session;
  v_hay := FOUND;

  IF v_hay THEN
    v_limite := public.session_idle_limit_minutes(v_user, coalesce(v_fila.device_class, 'navegador'));
    -- Una sesión que YA pasó su límite no se revive. El hook la va a rechazar en
    -- la próxima renovación; bumpearla acá la devolvía a la vida, y eso es
    -- exactamente lo que convertía 5 minutos en 20: al volver de una pestaña
    -- oculta el navegador late antes de que nadie compruebe nada.
    IF now() - v_fila.last_seen_at >= make_interval(mins => v_limite) THEN
      RETURN;
    END IF;
    UPDATE public.session_activity SET last_seen_at = now() WHERE session_id = v_session;
  ELSE
    INSERT INTO public.session_activity (session_id, user_id, device_class, last_seen_at)
    VALUES (v_session, v_user, v_clase, now())
    ON CONFLICT (session_id) DO UPDATE SET last_seen_at = now();
    -- device_class NO se actualiza en el conflicto a propósito: se congela en el INSERT.
  END IF;

  -- La última conexión de la persona sólo se mueve cuando el latido valió: si la
  -- sesión ya estaba vencida, la última vez que estuvo REALMENTE adentro es la
  -- anterior, no ésta.
  INSERT INTO public.session_last_seen (user_id, last_seen_at, device_class)
  VALUES (v_user, now(), v_clase)
  ON CONFLICT (user_id) DO UPDATE
    SET last_seen_at = now(),
        device_class = EXCLUDED.device_class;
END;
$function$;

-- ── 3. Sin fila de latido, el límite se mide contra la EDAD de la sesión ─────
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session uuid;
  v_user    uuid;
  v_fila    public.session_activity%ROWTYPE;
  v_hay     boolean;
  v_nacida  timestamptz;
  v_clase   text;
  v_limite  integer;
BEGIN
  v_user    := nullif(event ->> 'user_id', '')::uuid;
  v_session := nullif(event -> 'claims' ->> 'session_id', '')::uuid;

  -- El bloqueo se mira ANTES que nada y no depende de que haya sesión: sin esto,
  -- una persona bloqueada seguiría pudiendo INICIAR sesión.
  IF v_user IS NOT NULL AND public.employee_esta_bloqueado(v_user) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object('http_code', 403, 'message', 'account blocked')
    );
  END IF;

  IF v_session IS NULL OR v_user IS NULL THEN
    RETURN event;
  END IF;

  SELECT * INTO v_fila FROM public.session_activity WHERE session_id = v_session;
  v_hay := FOUND;

  v_clase  := coalesce(v_fila.device_class, 'navegador');
  v_limite := public.session_idle_limit_minutes(v_user, v_clase);

  IF v_hay THEN
    IF now() - v_fila.last_seen_at >= make_interval(mins => v_limite) THEN
      RETURN jsonb_build_object(
        'error', jsonb_build_object('http_code', 401, 'message', 'session idle timeout')
      );
    END IF;
  ELSE
    -- Sin fila de latido el límite NO se aplicaba nunca: `IF FOUND AND ...`
    -- dejaba pasar para siempre a toda sesión que naciera y jamás latiera. Se
    -- mide contra su propia edad, que es el único dato que existe. Una sesión
    -- recién creada tiene edad ~0 y pasa, que es lo que hace falta para que el
    -- primer token de un login se emita.
    SELECT s.created_at INTO v_nacida FROM auth.sessions s WHERE s.id = v_session;
    IF v_nacida IS NOT NULL AND now() - v_nacida >= make_interval(mins => v_limite) THEN
      RETURN jsonb_build_object(
        'error', jsonb_build_object('http_code', 401, 'message', 'session idle timeout')
      );
    END IF;
  END IF;

  RETURN jsonb_set(event, '{claims,idle_limit_min}', to_jsonb(v_limite));

EXCEPTION WHEN OTHERS THEN
  -- FAIL-OPEN ante lo inesperado, a propósito: este hook está en el camino
  -- crítico de TODA emisión de token. El evento vuelve SIN el claim, así que su
  -- ausencia delata que el hook no llegó a decidir.
  RETURN event;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.touch_session(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.touch_session(text) TO authenticated, service_role;
