SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El hook deja de ser invisible.
--
-- Hasta ahora corría, devolvía el evento igual y no dejaba huella: «¿está
-- activo?» no se podía contestar sin entrar al panel. Y el 2026-08-09 esa
-- pregunta apareció de verdad — entrar y refrescar daban 200 con el hook puesto
-- y darían 200 igual con el hook apagado. Cero hallazgos y cero datos se ven
-- igual.
--
-- Ahora estampa en el token el límite que le tocó a esa sesión. Con eso:
--   · «¿el hook está activo?» se contesta decodificando CUALQUIER token;
--   · se ve QUÉ límite se le aplicó, que es justo lo que uno quiere saber
--     cuando alguien reporta que lo echó antes de tiempo;
--   · y la ausencia del dato distingue las dos formas de no actuar — el hook
--     apagado, o el hook que se fue por el fail-open.
--
-- El claim es aditivo y diminuto: no toca user_metadata ni app_metadata.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $fn$
DECLARE
  v_session uuid;
  v_user    uuid;
  v_fila    public.session_activity%ROWTYPE;
  v_clase   text;
  v_limite  integer;
BEGIN
  v_session := nullif(event -> 'claims' ->> 'session_id', '')::uuid;
  v_user    := nullif(event ->> 'user_id', '')::uuid;

  IF v_session IS NULL OR v_user IS NULL THEN
    RETURN event;
  END IF;

  SELECT * INTO v_fila FROM public.session_activity WHERE session_id = v_session;

  -- Sin fila = sesión recién creada que todavía no latió. NO se rechaza: el
  -- primer latido llega dentro del minuto. Pero el límite se calcula igual, con
  -- la clase por defecto, para que el token lleve el dato desde el primer
  -- momento y el hook sea observable también acá.
  v_clase  := coalesce(v_fila.device_class, 'navegador');
  v_limite := public.session_idle_limit_minutes(v_user, v_clase);

  IF FOUND AND now() - v_fila.last_seen_at >= make_interval(mins => v_limite) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 401,
        'message', 'session idle timeout'
      )
    );
  END IF;

  RETURN jsonb_set(event, '{claims,idle_limit_min}', to_jsonb(v_limite));

EXCEPTION WHEN OTHERS THEN
  -- FAIL-OPEN ante lo inesperado, a propósito. Este hook está en el camino
  -- crítico de TODO refresco de token: si explota, nadie puede seguir usando el
  -- portal. Que rechace por «vencido» sí es el objetivo; que rechace por un
  -- error de programación sería una caída total.
  --
  -- Se devuelve el evento SIN el claim: así un token sin `idle_limit_min`
  -- delata que el hook no llegó a decidir, en vez de fingir normalidad.
  RETURN event;
END;
$fn$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Auth Hook (Custom Access Token). Rechaza la emision de token cuando la sesion supero su limite de inactividad, y estampa ese limite en el claim idle_limit_min para que el hook sea observable desde cualquier token. Se activa en Authentication -> Hooks. Ver docs/PLAN-SESIONES-SEGURAS-2026-08-08.md F3.';
