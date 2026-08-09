SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Conexiones, segunda vuelta — sobre la revisión del usuario del 2026-08-09.
--
-- Tres cambios, y los tres salen de lo que dijo al abrirla:
--
--  1. «del personal, incluir pruebas, ¿qué es?» — el interruptor de cuentas de
--     prueba SE VA. `qa.test` no es una persona, es nuestro Playwright: 3,338 de
--     las 3,585 sesiones. Ofrecerlo como filtro obligaba a la persona a entender
--     una cosa nuestra para usar su pantalla. Ahora se excluyen siempre.
--  2. La vista pasa a ser una tarjeta POR PERSONA, así que hace falta el cargo.
--  3. «no se cortan las sesiones y se eliminan?» — hace falta poder cerrar
--     TODAS las de alguien de una vez, que es lo que uno quiere cuando ve 205.
-- ════════════════════════════════════════════════════════════════════════════

-- El parámetro se va de la firma en vez de quedarse ignorado: un argumento que
-- no hace nada es peor que ninguno, y dos overloads conviviendo con DEFAULT es
-- una trampa conocida de este repo.
DROP FUNCTION IF EXISTS public.list_sessions(boolean);

CREATE OR REPLACE FUNCTION public.list_sessions()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_actual uuid;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('sesiones', 'can_view')) THEN
    RAISE EXCEPTION 'sin permiso para ver las conexiones' USING ERRCODE = '42501';
  END IF;

  v_actual := nullif(auth.jwt() ->> 'session_id', '')::uuid;

  RETURN coalesce((
    SELECT json_agg(to_json(t) ORDER BY t.ultimo_movimiento DESC)
    FROM (
      SELECT
        s.id                                    AS session_id,
        s.user_id                               AS persona_id,
        coalesce(e.name, split_part(u.email, '@', 1)) AS empleado,
        e.photo_url                             AS foto,
        r.name                                  AS cargo,
        split_part(u.email, '@', 1)             AS cuenta,
        s.created_at                            AS inicio,
        sa.last_seen_at                         AS ultimo_uso,
        -- `refreshed_at` es `timestamp WITHOUT time zone` mientras el resto de
        -- auth.sessions es `with time zone`. Sin el AT TIME ZONE miente por 6h.
        (s.refreshed_at AT TIME ZONE 'UTC')     AS ultima_renovacion,
        coalesce(sa.device_class, 'navegador')  AS clase,
        s.user_agent                            AS agente,
        host(s.ip)                              AS ip,
        s.not_after                             AS caduca,
        public.session_idle_limit_minutes(s.user_id, coalesce(sa.device_class, 'navegador')) AS limite_min,
        (s.id = v_actual)                       AS es_actual,
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
      LEFT JOIN public.roles r ON r.id = e.role_id
      -- Las cuentas de automatización no son personal y no tienen nada que
      -- hacer en esta pantalla.
      WHERE u.email NOT LIKE 'qa.%'
    ) t
  ), '[]'::json);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.list_sessions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_sessions() TO authenticated, service_role;

-- ── Cerrar TODAS las de una persona ─────────────────────────────────────────
-- Lo que uno quiere hacer al ver 205 conexiones de alguien. Devuelve cuántas
-- cerró. Recibe la persona, NO una lista de sesiones: así el llamador no puede
-- mandar ids de otro por descuido.
CREATE OR REPLACE FUNCTION public.revoke_person_sessions(p_user_id uuid)
RETURNS integer
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

  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;

  DELETE FROM public.session_activity WHERE user_id = p_user_id;

  RETURN v_borradas;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.revoke_person_sessions(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_person_sessions(uuid) TO authenticated, service_role;
