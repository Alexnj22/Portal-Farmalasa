SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- F3 de docs/PLAN-SESIONES-SEGURAS-2026-08-08.md
--
-- El límite por inactividad (5 min empleado / 12 h gestión / 30 días app) vivía
-- SÓLO en localStorage del navegador: con el token en la mano y curl, no existía.
-- Acá pasa a decidirlo el servidor, en el único momento en que puede hacerlo —
-- cuando se emite un token.
--
-- Ensayado antes en el branch de staging ewcmerxqjvludtgskuin: 6 casos de
-- session_idle_limit_minutes y 6 del hook, todos dentro de BEGIN…ROLLBACK.
-- (Staging necesitó primero una puesta al día para crear employee_auth_accounts,
-- que existe en prod con 29 filas y allá faltaba; esa migración es sólo de
-- staging y por eso NO tiene archivo acá — este directorio reconstruye prod.)
--
-- Estos objetos nacen INERTES: el hook no corre hasta que se lo active en
-- Authentication → Hooks.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Dónde se anota la actividad ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_activity (
  session_id   uuid PRIMARY KEY,
  user_id      uuid NOT NULL,
  -- 'app' (PWA instalada o build nativo) o 'navegador'. Lo declara el cliente y
  -- el servidor NO puede verificarlo: Postgres no tiene cómo saber si el
  -- navegador es una PWA. Por eso se fija en el INSERT y no se puede cambiar
  -- después — un token robado no puede ascenderse a la ventana larga. El techo
  -- real de ese caso es el timebox de sesión, no esta columna.
  device_class text NOT NULL DEFAULT 'navegador',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_activity_user_id
  ON public.session_activity(user_id);

ALTER TABLE public.session_activity ENABLE ROW LEVEL SECURITY;

-- Lectura: sólo las filas propias. Todas las escrituras pasan por touch_session,
-- que es SECURITY DEFINER — por eso no hay policy de INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS session_activity_select_own ON public.session_activity;
CREATE POLICY session_activity_select_own ON public.session_activity
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- El hook corre como supabase_auth_admin y NO es SECURITY DEFINER (se sigue el
-- patrón documentado por Supabase), así que necesita ver la tabla.
DROP POLICY IF EXISTS session_activity_select_auth_admin ON public.session_activity;
CREATE POLICY session_activity_select_auth_admin ON public.session_activity
  AS PERMISSIVE FOR SELECT TO supabase_auth_admin
  USING (true);

REVOKE ALL ON public.session_activity FROM anon;
GRANT SELECT ON public.session_activity TO supabase_auth_admin;

-- ── 2. El latido ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_session(p_device_class text DEFAULT 'navegador')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session uuid;
  v_user    uuid;
  v_clase   text;
BEGIN
  -- El session_id sale del JWT, NUNCA de un parámetro: quien llama no puede
  -- elegir qué sesión está renovando.
  v_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_user    := auth.uid();
  IF v_session IS NULL OR v_user IS NULL THEN
    RETURN;
  END IF;

  v_clase := CASE WHEN p_device_class = 'app' THEN 'app' ELSE 'navegador' END;

  INSERT INTO public.session_activity (session_id, user_id, device_class, last_seen_at)
  VALUES (v_session, v_user, v_clase, now())
  ON CONFLICT (session_id) DO UPDATE
    SET last_seen_at = now();
    -- device_class NO se actualiza a propósito: se congela en el INSERT.
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_session(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.touch_session(text) TO authenticated, service_role;

-- ── 3. Cuánta inactividad tolera este usuario ───────────────────────────────
-- Espejo de getIdleLimitMs() en src/context/AuthContext.jsx. Si una de las dos
-- mitades cambia, la otra tiene que cambiar con ella.
--
-- NO puede usar auth_employee_id(): esa resuelve por auth.uid() y dentro del
-- hook no hay JWT de usuario. Recibe el user_id del evento y repite la misma
-- resolución que auth_employee_id() tiene en el catálogo.
CREATE OR REPLACE FUNCTION public.session_idle_limit_minutes(
  p_user_id uuid,
  p_device_class text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH emp AS (
    SELECT e.id, e.role_id, e.secondary_role_id, e.system_role
    FROM public.employees e
    WHERE e.id = p_user_id
       OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                   WHERE l.auth_user_id = p_user_id)
    ORDER BY (e.id = p_user_id) DESC
    LIMIT 1
  )
  SELECT CASE
    -- 30 días: PWA instalada o build nativo.
    WHEN p_device_class = 'app' THEN 43200
    -- 12 horas: superadministrador…
    WHEN EXISTS (SELECT 1 FROM emp JOIN public.roles r ON r.id = emp.role_id WHERE r.is_su)
      OR EXISTS (SELECT 1 FROM emp WHERE emp.system_role = 'SUPERADMIN')
    THEN 720
    -- …o con vista en cualquier módulo de gestión, por rol principal o secundario.
    WHEN EXISTS (
      SELECT 1 FROM public.role_permissions rp, emp
      WHERE rp.role_id IN (emp.role_id, emp.secondary_role_id)
        AND rp.can_view
        AND rp.module_key IN ('staff_list','schedules','monitor','requests',
                              'time_audit','permissions','announcements')
    ) THEN 720
    -- 5 minutos: todos los demás.
    ELSE 5
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.session_idle_limit_minutes(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.session_idle_limit_minutes(uuid, text) TO supabase_auth_admin, service_role;

-- ── 4. El hook ──────────────────────────────────────────────────────────────
-- Corre en CADA emisión de token: login y cada refresco. Es el único punto
-- donde el servidor puede hacer cumplir el límite, y por eso la holgura máxima
-- es un ciclo de token (900s con el ajuste de F1).
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_session uuid;
  v_user    uuid;
  v_fila    public.session_activity%ROWTYPE;
  v_limite  integer;
BEGIN
  v_session := nullif(event -> 'claims' ->> 'session_id', '')::uuid;
  v_user    := nullif(event ->> 'user_id', '')::uuid;

  IF v_session IS NULL OR v_user IS NULL THEN
    RETURN event;
  END IF;

  SELECT * INTO v_fila FROM public.session_activity WHERE session_id = v_session;

  -- Sin fila = sesión recién creada que todavía no latió. Se deja pasar: el
  -- primer latido llega dentro del minuto.
  IF NOT FOUND THEN
    RETURN event;
  END IF;

  v_limite := public.session_idle_limit_minutes(v_user, v_fila.device_class);

  IF now() - v_fila.last_seen_at >= make_interval(mins => v_limite) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 401,
        'message', 'session idle timeout'
      )
    );
  END IF;

  RETURN event;
EXCEPTION WHEN OTHERS THEN
  -- FAIL-OPEN ante lo inesperado, a propósito. Este hook está en el camino
  -- crítico de TODO refresco de token: si explota, nadie puede seguir usando el
  -- portal. Que rechace por «vencido» sí es el objetivo; que rechace por un
  -- error de programación sería una caída total.
  RETURN event;
END;
$$;

GRANT  USAGE   ON SCHEMA public TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Auth Hook (Custom Access Token). Rechaza la emisión de token cuando la sesión superó su límite de inactividad. Se activa en Authentication → Hooks. Ver docs/PLAN-SESIONES-SEGURAS-2026-08-08.md F3.';
