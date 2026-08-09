SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Una persona bloqueada no recibe tokens: ni para entrar, ni para renovar.
--
-- El hook corre en CADA emisión, así que éste es el punto donde el bloqueo
-- impide iniciar sesión. `auth_no_bloqueado()` no sirve acá: resuelve por
-- `auth.uid()` y dentro del hook no hay JWT de usuario, así que hace falta la
-- variante que recibe el id del evento.
--
-- Ensayado en staging con 4 casos (sin bloqueo / indefinido / ya vencido /
-- hasta mañana) en BEGIN…ROLLBACK.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.employee_esta_bloqueado(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE (e.id = p_user_id
        OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                    WHERE l.auth_user_id = p_user_id))
      AND e.blocked_until IS NOT NULL
      AND e.blocked_until > now()
  );
$fn$;

REVOKE EXECUTE ON FUNCTION public.employee_esta_bloqueado(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.employee_esta_bloqueado(uuid) TO supabase_auth_admin, service_role;

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

  -- Sin fila = sesión recién creada que todavía no latió. NO se rechaza, pero el
  -- límite se calcula igual para que el token lleve el dato desde el principio.
  v_clase  := coalesce(v_fila.device_class, 'navegador');
  v_limite := public.session_idle_limit_minutes(v_user, v_clase);

  IF FOUND AND now() - v_fila.last_seen_at >= make_interval(mins => v_limite) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object('http_code', 401, 'message', 'session idle timeout')
    );
  END IF;

  RETURN jsonb_set(event, '{claims,idle_limit_min}', to_jsonb(v_limite));

EXCEPTION WHEN OTHERS THEN
  -- FAIL-OPEN ante lo inesperado, a propósito: este hook está en el camino
  -- crítico de TODA emisión de token. El evento vuelve SIN el claim, así que su
  -- ausencia delata que el hook no llegó a decidir.
  RETURN event;
END;
$fn$;

GRANT  USAGE   ON SCHEMA public TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
