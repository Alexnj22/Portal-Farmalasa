SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- F4 de docs/PLAN-SESIONES-SEGURAS-2026-08-08.md — las dos RPC de la vista de
-- Conexiones.
--
-- `auth.sessions` vive en el esquema `auth` y NO está expuesta a PostgREST, así
-- que todo pasa por función. Ninguna de las dos devuelve material de credencial:
-- fuera `refresh_token_hmac_key`, `refresh_token_counter` y cualquier token.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Listar ──────────────────────────────────────────────────────────────────
-- Devuelve json y no SETOF a propósito (Patrón C de CLAUDE.md): PostgREST
-- trunca cualquier respuesta SETOF a 1000 filas EN SILENCIO, y con
-- p_incluir_pruebas = true hay 3,585 sesiones. Un listado que miente por
-- truncamiento es peor que no tenerlo.
CREATE OR REPLACE FUNCTION public.list_sessions(p_incluir_pruebas boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_actual uuid;
BEGIN
  -- El permiso se chequea ACÁ y no sólo en la ruta: una RPC que confía en que
  -- el frontend ya preguntó es una RPC sin permiso.
  IF NOT (SELECT public.auth_has_module_permission('sesiones', 'can_view')) THEN
    RAISE EXCEPTION 'sin permiso para ver las conexiones' USING ERRCODE = '42501';
  END IF;

  v_actual := nullif(auth.jwt() ->> 'session_id', '')::uuid;

  RETURN coalesce((
    SELECT json_agg(to_json(t) ORDER BY t.ultimo_movimiento DESC)
    FROM (
      SELECT
        s.id                                    AS session_id,
        coalesce(e.name, split_part(u.email, '@', 1)) AS empleado,
        e.photo_url                             AS foto,
        split_part(u.email, '@', 1)             AS cuenta,
        s.created_at                            AS inicio,
        sa.last_seen_at                         AS ultimo_uso,
        -- `refreshed_at` es `timestamp WITHOUT time zone` mientras el resto de
        -- las columnas de auth.sessions son `with time zone`. Sin este AT TIME
        -- ZONE la columna miente por 6 horas y nadie lo nota.
        (s.refreshed_at AT TIME ZONE 'UTC')     AS ultima_renovacion,
        coalesce(sa.device_class, 'navegador')  AS clase,
        s.user_agent                            AS agente,
        host(s.ip)                              AS ip,
        s.not_after                             AS caduca,
        public.session_idle_limit_minutes(s.user_id, coalesce(sa.device_class, 'navegador')) AS limite_min,
        (s.id = v_actual)                       AS es_actual,
        -- Para ordenar: lo más reciente que se sepa de esta sesión.
        greatest(s.created_at,
                 coalesce(sa.last_seen_at, s.created_at),
                 coalesce(s.refreshed_at AT TIME ZONE 'UTC', s.created_at)) AS ultimo_movimiento
      FROM auth.sessions s
      JOIN auth.users u ON u.id = s.user_id
      LEFT JOIN public.session_activity sa ON sa.session_id = s.id
      LEFT JOIN public.employees e
        ON e.id = s.user_id
        OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                    WHERE l.auth_user_id = s.user_id)
      WHERE p_incluir_pruebas OR u.email NOT LIKE 'qa.%'
    ) t
  ), '[]'::json);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.list_sessions(boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_sessions(boolean) TO authenticated, service_role;

-- ── Cerrar una ──────────────────────────────────────────────────────────────
-- Borra la sesión y, en cascada, sus refresh tokens (FK ON DELETE CASCADE
-- verificada en auth.refresh_tokens y auth.mfa_amr_claims).
--
-- OJO: esto NO corta al instante. El access token ya emitido sigue siendo válido
-- hasta que expire — con el JWT en 900s, hasta 15 minutos. Lo que se acaba es la
-- capacidad de renovarlo. La pantalla tiene que decirlo con esas palabras.
CREATE OR REPLACE FUNCTION public.revoke_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_borradas integer;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('sesiones', 'can_edit')) THEN
    RAISE EXCEPTION 'sin permiso para cerrar conexiones' USING ERRCODE = '42501';
  END IF;

  IF p_session_id IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM auth.sessions WHERE id = p_session_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;

  DELETE FROM public.session_activity WHERE session_id = p_session_id;

  RETURN v_borradas > 0;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.revoke_session(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_session(uuid) TO authenticated, service_role;
