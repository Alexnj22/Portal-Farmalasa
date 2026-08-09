SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- La lista tiene que incluir a los BLOQUEADOS aunque no tengan conexiones.
--
-- Bloquear mata todas las sesiones de la persona. Con la lista armada sólo a
-- partir de `auth.sessions`, esa persona **desaparecía de la pantalla en el
-- mismo acto de bloquearla** — y como el botón de desbloquear vive en su
-- tarjeta, quedaba bloqueada sin forma de volver. Un callejón sin salida que
-- se crea uno mismo al usar la función.
--
-- Por eso la consulta es una unión: las conexiones vivas, más las personas
-- bloqueadas que no tienen ninguna. Esas últimas llegan con `session_id` nulo y
-- el cliente las agrupa igual, con cero conexiones.
--
-- NOTA: este archivo se recuperó del catálogo
-- (`supabase_migrations.schema_migrations.statements`) porque al aplicar la
-- migración me olvidé de guardarlo. Lo detectó `npm run gate:migrations
-- --remote`, que existe exactamente para eso: `apply_migration` escribe en el
-- servidor y nunca en el disco, y olvidarlo no da ningún error.
-- ════════════════════════════════════════════════════════════════════════════

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
      -- Conexiones vivas
      SELECT
        s.id                                    AS session_id,
        s.user_id                               AS persona_id,
        coalesce(e.name, split_part(u.email, '@', 1)) AS empleado,
        e.photo_url                             AS foto,
        r.name                                  AS cargo,
        split_part(u.email, '@', 1)             AS cuenta,
        e.blocked_until                         AS bloqueado_hasta,
        e.blocked_reason                        AS bloqueo_motivo,
        s.created_at                            AS inicio,
        sa.last_seen_at                         AS ultimo_uso,
        -- refreshed_at es `timestamp WITHOUT time zone` mientras el resto de
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
      WHERE u.email NOT LIKE 'qa.%'

      UNION ALL

      -- Personas bloqueadas que ya no tienen ninguna conexión: sin esto
      -- desaparecen de la pantalla y no hay dónde desbloquearlas.
      SELECT
        NULL::uuid, e.id, e.name, e.photo_url, r.name,
        coalesce(e.username, e.code),
        e.blocked_until, e.blocked_reason,
        NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
        'navegador', NULL::text, NULL::text, NULL::timestamptz,
        NULL::integer, false,
        coalesce(e.blocked_at, e.blocked_until)
      FROM public.employees e
      LEFT JOIN public.roles r ON r.id = e.role_id
      WHERE e.blocked_until IS NOT NULL
        AND e.blocked_until > now()
        AND NOT EXISTS (SELECT 1 FROM auth.sessions s2 WHERE s2.user_id = e.id)
    ) t
  ), '[]'::json);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.list_sessions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_sessions() TO authenticated, service_role;
