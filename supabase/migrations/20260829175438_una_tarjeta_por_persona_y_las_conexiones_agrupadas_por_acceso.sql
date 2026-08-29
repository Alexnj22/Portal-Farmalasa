SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Una tarjeta por PERSONA, con sus conexiones agrupadas por el acceso que usó.
--
-- Pedido por el usuario el 2026-08-29, mirando dos tarjetas idénticas de la
-- misma empleada: «sólo debe haber 1 card por persona, ahí se agrupa según el
-- acceso».
--
-- La vista agrupaba por IDENTIDAD, y una persona puede tener varias. Medido en
-- producción: **66 tarjetas para 45 personas — 21 de más**, y son 21 porque
-- justo esas tienen dos accesos.
--
-- Tres formas de entrar, y las tres son cuentas `@staff.local` distintas, así
-- que desde el correo no se distinguen sin cruzarlas contra la ficha:
--
--   | acceso          | la cuenta es…                    | cuentas |
--   |-----------------|----------------------------------|--------:|
--   | `carne`         | el secreto del carné (8 car.)    |      40 |
--   | `codigo`        | el código de empleado            |      22 |
--   | `carne_del_dia` | `carne-<identificador>`          |       4 |
--
-- Ahora cada fila trae DOS cosas nuevas:
--
--   · `ficha_id` — la persona. Es por lo que agrupa la pantalla, y sale de
--     `ficha_de_persona()`, el mismo traductor que arregló el bloqueo. Cuando
--     no hay ficha que resolver cae en la identidad, para que una cuenta
--     huérfana siga teniendo su tarjeta en vez de desaparecer.
--   · `acceso` — la CLAVE, no el rótulo. El texto que se lee lo pone la
--     pantalla: la base no escribe palabras que ve el usuario
--     ([[feedback_un_rotulo_no_es_una_clave]]).
--
-- `persona_id` se queda como está —la identidad— porque es lo que necesita
-- `revoke_session` y lo que identifica una conexión concreta. Lo que cambia es
-- que ya no es la clave de agrupación.
-- ════════════════════════════════════════════════════════════════════════════

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
        coalesce(e.id, s.user_id)               AS ficha_id,
        CASE
          WHEN split_part(u.email, '@', 1) LIKE 'carne-%'                          THEN 'carne_del_dia'
          WHEN upper(split_part(u.email,'@',1)) = upper(nullif(btrim(e.kiosk_pin),'')) THEN 'carne'
          WHEN split_part(u.email, '@', 1) = nullif(btrim(e.code), '')             THEN 'codigo'
          WHEN split_part(u.email, '@', 1) = nullif(btrim(e.username), '')         THEN 'usuario'
          ELSE 'otro'
        END                                     AS acceso,
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
        coalesce(e.id, ls.user_id)                     AS ficha_id,
        CASE
          WHEN coalesce(u.email,'') LIKE 'carne-%'                                 THEN 'carne_del_dia'
          WHEN upper(split_part(u.email,'@',1)) = upper(nullif(btrim(e.kiosk_pin),'')) THEN 'carne'
          WHEN split_part(u.email, '@', 1) = nullif(btrim(e.code), '')             THEN 'codigo'
          WHEN split_part(u.email, '@', 1) = nullif(btrim(e.username), '')         THEN 'usuario'
          ELSE 'otro'
        END                                            AS acceso,
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
        NULL::uuid, e.id, e.id, NULL::text, e.name, e.photo_url, r.name,
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

-- ── Cerrar todas las conexiones de una persona ─────────────────────────────
-- Con una sola tarjeta por persona, «cerrar todas» tiene que significar TODAS
-- —las de sus dos o tres accesos—, no las de la puerta por la que se la nombró.
-- Antes de esto habría cerrado una y dejado la otra viva, mostrando después
-- «se cerraron N conexiones» con la tarjeta todavía conectada.
--
-- Acepta la ficha o cualquiera de sus identidades, igual que `block_employee`.
CREATE OR REPLACE FUNCTION public.revoke_person_sessions(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ficha    uuid;
  v_borradas integer := 0;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('sesiones', 'can_edit')) THEN
    RAISE EXCEPTION 'sin permiso para cerrar conexiones' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Sin ficha que resolver —una cuenta huérfana— se cierra sólo esa, que es
  -- exactamente lo que hacía antes. La falla segura es no dejar de cerrar.
  v_ficha := (SELECT public.ficha_de_persona(p_user_id));

  WITH suyas AS (
    SELECT p_user_id AS user_id
    UNION
    SELECT v_ficha WHERE v_ficha IS NOT NULL
    UNION
    SELECT l.auth_user_id FROM public.employee_auth_accounts l
     WHERE v_ficha IS NOT NULL AND l.employee_id = v_ficha
  ),
  cerradas AS (
    DELETE FROM auth.sessions s
     WHERE s.user_id IN (SELECT user_id FROM suyas)
    RETURNING 1
  )
  SELECT count(*) INTO v_borradas FROM cerradas;

  DELETE FROM public.session_activity sa
   WHERE sa.user_id = p_user_id
      OR (v_ficha IS NOT NULL AND (sa.user_id = v_ficha
          OR sa.user_id IN (SELECT l.auth_user_id FROM public.employee_auth_accounts l
                             WHERE l.employee_id = v_ficha)));

  RETURN v_borradas;
END;
$function$;
