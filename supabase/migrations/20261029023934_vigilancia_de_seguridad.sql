SET lock_timeout = '5s';

-- Vigilancia continua de seguridad (PENDIENTES 13, SEGURIDAD-Y-ACCESO §3.7) — 2026-10-28.
--
-- AVISA, nunca bloquea. A quién: Gerente General y Jefe/a de Talento Humano
-- (decisión del usuario, 2026-10-28), por CARGO y no por lista de ids.
--
--   · al momento: cualquier cambio en `security_config`. Si alguien apaga un
--     control, ese mismo cambio es la alerta — es el que más importa, y por eso
--     va en un trigger y no espera al cron;
--   · cada mañana (`seguridad-vigilancia-diaria`, 07:00 SV):
--       - cuenta de una persona activa que lleva 60+ días sin entrar y sigue abierta;
--       - cuenta sin bloquear cuyo dueño ya no está activo, o que no es de nadie;
--       - entrada al portal de noche (22:00–05:00 SV) en las últimas 24 horas.
--
-- Cada hallazgo se avisa UNA vez (`avisos_emitidos`, que ya se purga a los 400
-- días): la cuenta sin uso vuelve a avisar sólo si la persona entra y se vuelve
-- a quedar quieta, no todas las mañanas.
--
-- Medido antes de escribirlo (prod, 2026-10-28): 2 personas activas sin entrar
-- en 60 días, 0 cuentas sueltas sin bloquear (las 8 que hay están bloqueadas) y
-- ninguna sesión abierta entre las 22:00 y las 05:00 en los últimos 30 días.
-- O sea que el primer día avisa 2 cosas y después calla salvo novedad.

CREATE OR REPLACE FUNCTION public.seguridad_destinatarios()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(array_agg(DISTINCT e.id), '{}'::uuid[])
    FROM public.employees e
    JOIN public.roles r ON r.name IN ('Gerente General', 'Jefe/a de Talento Humano')
   WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
     AND e.status = 'ACTIVO'
     AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
$function$;

REVOKE EXECUTE ON FUNCTION public.seguridad_destinatarios() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seguridad_destinatarios() TO service_role;

-- Cómo se dice cada control y cada estado en pantalla.
CREATE OR REPLACE FUNCTION public.seguridad_rotulo_control(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE p_key
    WHEN 'dispositivo_conocido' THEN 'Equipo conocido'
    WHEN 'segundo_humano'       THEN 'Segundo par de ojos'
    WHEN 'lectura_masiva'       THEN 'Lectura masiva'
    WHEN 'techo_exportacion'    THEN 'Tope de descargas'
    ELSE p_key END;
$function$;

CREATE OR REPLACE FUNCTION public.seguridad_rotulo_estado(p_estado text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE p_estado
    WHEN 'observar' THEN 'solo observa'
    WHEN 'avisar'   THEN 'avisa'
    WHEN 'exigir'   THEN 'bloquea'
    ELSE coalesce(p_estado, '—') END;
$function$;

REVOKE EXECUTE ON FUNCTION public.seguridad_rotulo_control(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.seguridad_rotulo_estado(text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.seguridad_rotulo_control(text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.seguridad_rotulo_estado(text)  TO authenticated, service_role;

-- ── Al momento: un control cambió ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seguridad_aviso_cambio_de_control()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_quien text;
    v_key   text := coalesce(NEW.key, OLD.key);
    v_que   text;
BEGIN
    -- Cambiar sólo la nota no mueve ningún freno.
    IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado
       AND NEW.key IS NOT DISTINCT FROM OLD.key THEN
        RETURN NEW;
    END IF;

    -- Sin sesión del portal = alguien con acceso directo a la base. Es
    -- justamente el caso que más hay que ver, así que se dice así.
    SELECT public.nombre_corto_de_empleado(NULL, NULL, e.name) INTO v_quien
      FROM public.employees e WHERE e.id = v_actor;
    v_quien := coalesce(v_quien, 'Alguien sin sesión del portal (acceso directo a la base)');

    v_que := CASE TG_OP
        WHEN 'UPDATE' THEN format('cambió «%s»: antes %s, ahora %s.',
                                  public.seguridad_rotulo_control(v_key),
                                  public.seguridad_rotulo_estado(OLD.estado),
                                  public.seguridad_rotulo_estado(NEW.estado))
        WHEN 'DELETE' THEN format('borró el control «%s» (estaba: %s). Sin la fila, no bloquea nada.',
                                  public.seguridad_rotulo_control(v_key),
                                  public.seguridad_rotulo_estado(OLD.estado))
        ELSE               format('agregó el control «%s» (%s).',
                                  public.seguridad_rotulo_control(v_key),
                                  public.seguridad_rotulo_estado(NEW.estado))
    END;

    PERFORM public.notify_employees(
        public.seguridad_destinatarios(),
        'SEGURIDAD_VIGILANCIA',
        'Cambió un control de seguridad',
        v_quien || ' ' || v_que || ' Si no lo esperabas, revísalo hoy.',
        NULL,
        jsonb_build_object('motivo', 'control_cambiado', 'control', v_key, 'operacion', TG_OP,
                           'antes', CASE WHEN TG_OP <> 'INSERT' THEN OLD.estado END,
                           'ahora', CASE WHEN TG_OP <> 'DELETE' THEN NEW.estado END,
                           'actor', v_actor),
        true,
        NULL
    );
    RETURN coalesce(NEW, OLD);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.seguridad_aviso_cambio_de_control() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS seguridad_aviso_cambio ON public.security_config;
CREATE TRIGGER seguridad_aviso_cambio
    AFTER INSERT OR UPDATE OR DELETE ON public.security_config
    FOR EACH ROW EXECUTE FUNCTION public.seguridad_aviso_cambio_de_control();

-- ── Cada mañana ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vigilar_seguridad()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dest uuid[] := public.seguridad_destinatarios();
    v_sin_uso int := 0; v_sueltas int := 0; v_noche int := 0;
    v_para uuid[];
    r record;
BEGIN
    IF cardinality(v_dest) = 0 THEN
        RETURN jsonb_build_object('error', 'sin destinatarios');
    END IF;

    FOR r IN
        -- 1 · Persona activa, 60+ días sin entrar, con alguna cuenta abierta.
        --     Las fichas de menos de 60 días no cuentan: todavía no tuvieron tiempo.
        WITH cuentas AS (
            SELECT e.id AS emp, e.name, e.created_at,
                   max(u.last_sign_in_at) AS ultimo,
                   bool_or(u.banned_until IS NULL OR u.banned_until < now()) AS abierta
              FROM public.employees e
              JOIN auth.users u
                ON u.id = e.id
                OR u.id IN (SELECT l.auth_user_id FROM public.employee_auth_accounts l WHERE l.employee_id = e.id)
             WHERE e.status = 'ACTIVO'
             GROUP BY e.id, e.name, e.created_at
        )
        SELECT 'sin_uso' AS tipo,
               'SEG_SIN_USO:' || c.emp || ':' || coalesce(c.ultimo::date::text, 'nunca') AS clave,
               'Cuenta sin uso: ' || public.nombre_corto_de_empleado(NULL, NULL, c.name) AS titulo,
               'La cuenta de ' || public.nombre_corto_de_empleado(NULL, NULL, c.name)
                 || CASE WHEN c.ultimo IS NULL THEN ' nunca ha entrado al portal'
                         ELSE ' lleva ' || (current_date - (c.ultimo AT TIME ZONE 'America/El_Salvador')::date)
                              || ' días sin entrar al portal' END
                 || ' y sigue abierta. Si ya no la usa, bloquéala en Personal.' AS cuerpo,
               jsonb_build_object('motivo', 'sin_uso', 'employee_id', c.emp, 'ultimo', c.ultimo) AS meta
          FROM cuentas c
         WHERE c.abierta
           AND c.created_at < now() - interval '60 days'
           AND (c.ultimo IS NULL OR c.ultimo < now() - interval '60 days')

        UNION ALL
        -- 2 · Cuenta sin bloquear cuyo dueño no está activo, o que no es de nadie.
        SELECT 'suelta',
               'SEG_CUENTA_SUELTA:' || u.id || ':' || coalesce(u.last_sign_in_at::date::text, 'nunca'),
               'Cuenta abierta sin dueño activo',
               coalesce('La cuenta de ' || public.nombre_corto_de_empleado(NULL, NULL, e.name)
                          || ' (ficha ' || lower(e.status) || ')',
                        'Una cuenta que no pertenece a ninguna persona del portal')
                 || ' sigue abierta'
                 || CASE WHEN u.last_sign_in_at > now() - interval '24 hours'
                         THEN ' y entró ayer a las ' || public.hora_12((u.last_sign_in_at AT TIME ZONE 'America/El_Salvador')::time)
                         ELSE '' END
                 || '. Bloquéala si nadie la necesita.',
               jsonb_build_object('motivo', 'cuenta_suelta', 'auth_user_id', u.id, 'employee_id', e.id,
                                  'ultimo', u.last_sign_in_at)
          FROM auth.users u
          LEFT JOIN public.employee_auth_accounts l ON l.auth_user_id = u.id
          LEFT JOIN public.employees e ON e.id = coalesce(l.employee_id, u.id)
         WHERE (u.banned_until IS NULL OR u.banned_until < now())
           AND u.deleted_at IS NULL
           AND (e.id IS NULL OR e.status <> 'ACTIVO')

        UNION ALL
        -- 3 · Entrada de noche (22:00–05:00 SV) en las últimas 24 horas.
        --     `auth.sessions` guarda cada inicio de sesión mientras siga viva y
        --     `last_sign_in_at` el último; juntas cubren también la sesión que ya
        --     se cerró si fue la última entrada.
        SELECT 'noche',
               'SEG_NOCHE:' || x.uid || ':' || (x.entro AT TIME ZONE 'America/El_Salvador')::date,
               'Entrada de noche: ' || coalesce(public.nombre_corto_de_empleado(NULL, NULL, e.name), 'cuenta sin dueño'),
               coalesce(public.nombre_corto_de_empleado(NULL, NULL, e.name), 'Una cuenta sin dueño')
                 || ' entró al portal a las '
                 || public.hora_12((x.entro AT TIME ZONE 'America/El_Salvador')::time)
                 || ' del ' || to_char((x.entro AT TIME ZONE 'America/El_Salvador')::date, 'DD/MM')
                 || ', fuera del horario de las salas. Si no lo esperabas, revísalo.',
               jsonb_build_object('motivo', 'noche', 'auth_user_id', x.uid, 'employee_id', e.id, 'entro', x.entro)
          FROM (
              SELECT DISTINCT ON (t.uid, (t.entro AT TIME ZONE 'America/El_Salvador')::date) t.uid, t.entro
                FROM (
                    SELECT s.user_id AS uid, s.created_at AS entro FROM auth.sessions s
                     WHERE s.created_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT u.id, u.last_sign_in_at FROM auth.users u
                     WHERE u.last_sign_in_at > now() - interval '24 hours'
                ) t
               WHERE extract(hour FROM (t.entro AT TIME ZONE 'America/El_Salvador')) >= 22
                  OR extract(hour FROM (t.entro AT TIME ZONE 'America/El_Salvador')) < 5
               ORDER BY t.uid, (t.entro AT TIME ZONE 'America/El_Salvador')::date, t.entro
          ) x
          LEFT JOIN public.employee_auth_accounts l ON l.auth_user_id = x.uid
          LEFT JOIN public.employees e ON e.id = coalesce(l.employee_id, x.uid)
    LOOP
        SELECT array_agg(d) INTO v_para
          FROM unnest(v_dest) d
         WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                            WHERE a.clave = r.clave AND a.recipient_id = d);
        CONTINUE WHEN v_para IS NULL;

        PERFORM public.notify_employees(v_para, 'SEGURIDAD_VIGILANCIA', r.titulo, r.cuerpo,
                                        NULL, r.meta, false, NULL);
        INSERT INTO public.avisos_emitidos (clave, recipient_id)
        SELECT r.clave, d FROM unnest(v_para) d
        ON CONFLICT DO NOTHING;

        CASE r.tipo
            WHEN 'sin_uso' THEN v_sin_uso := v_sin_uso + 1;
            WHEN 'suelta'  THEN v_sueltas := v_sueltas + 1;
            ELSE                v_noche   := v_noche + 1;
        END CASE;
    END LOOP;

    RETURN jsonb_build_object('sin_uso', v_sin_uso, 'cuentas_sueltas', v_sueltas, 'noche', v_noche,
                              'destinatarios', cardinality(v_dest));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.vigilar_seguridad() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.vigilar_seguridad() TO service_role;

-- 07:00 SV = 13:00 UTC.
SELECT cron.schedule('seguridad-vigilancia-diaria', '0 13 * * *', 'SELECT public.vigilar_seguridad()');
