SET lock_timeout = '5s';

-- `persona_id` de la rama nueva decía `coalesce(e.id, ls.user_id)`, o sea el
-- EMPLEADO. La rama de conexiones vivas usa `s.user_id`, o sea la IDENTIDAD de
-- acceso. No son lo mismo: dos personas —Josue Guevara y Katlin Molina— tienen
-- dos identidades cada una, la del correo y la del carné (`@staff.local`).
--
-- Con la clave equivocada, «Cerrar todas» le habría pasado el id de empleado a
-- `revoke_person_sessions`, que borra `WHERE user_id = ...` sobre auth.sessions:
-- cero filas, sin error y sin aviso. La pantalla habría dicho «0 conexiones
-- cerradas» y las conexiones seguirían abiertas. Es
-- `feedback_sin_policy_de_update_el_write_devuelve_cero` otra vez — la escritura
-- «funciona» y no hace lo que dice.
--
-- Se alinea con la rama de arriba: la clave es la identidad. Consecuencia
-- conocida y ya existente hoy: quien tiene dos identidades sale en dos tarjetas.
CREATE OR REPLACE FUNCTION public.list_sessions()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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

      -- Identidades SIN ninguna conexión viva.
      --
      -- Antes desaparecían de la pantalla al cerrarse su última sesión, así que
      -- no había forma de ver cuándo entró alguien por última vez. Ahora que las
      -- vencidas se cierran solas eso habría vaciado la vista casi entera: de
      -- 147 conexiones reales, sólo 4 estaban vivas.
      --
      -- `session_last_seen` sobrevive a la purga y a «cerrar todas»; por eso el
      -- dato sale de ahí y no de `session_activity`.
      SELECT
        NULL::uuid                                     AS session_id,
        ls.user_id                                     AS persona_id,
        coalesce(e.name, split_part(u.email, '@', 1))  AS empleado,
        e.photo_url                                    AS foto,
        r.name                                         AS cargo,
        coalesce(split_part(u.email, '@', 1), e.username, e.code) AS cuenta,
        e.blocked_until, e.blocked_reason,
        NULL::timestamptz                              AS inicio,
        ls.last_seen_at                                AS ultimo_uso,
        NULL::timestamptz                              AS ultima_renovacion,
        coalesce(ls.device_class, 'navegador')         AS clase,
        NULL::text, NULL::text, NULL::timestamptz,
        NULL::integer                                  AS limite_min,
        false                                          AS es_actual,
        ls.last_seen_at                                AS ultimo_movimiento
      FROM public.session_last_seen ls
      LEFT JOIN auth.users u ON u.id = ls.user_id
      LEFT JOIN public.employees e
        ON e.id = ls.user_id
        OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                    WHERE l.auth_user_id = ls.user_id)
      LEFT JOIN public.roles r ON r.id = e.role_id
      WHERE NOT EXISTS (SELECT 1 FROM auth.sessions s2 WHERE s2.user_id = ls.user_id)
        AND coalesce(u.email, '') NOT LIKE 'qa.%'

      UNION ALL

      -- Personas bloqueadas que además nunca entraron: sin esto no habría dónde
      -- desbloquearlas. Las que sí entraron ya vienen de la rama de arriba.
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
        AND NOT EXISTS (SELECT 1 FROM public.session_last_seen ls2 WHERE ls2.user_id = e.id)
    ) t
  ), '[]'::json);
END;
$function$;
