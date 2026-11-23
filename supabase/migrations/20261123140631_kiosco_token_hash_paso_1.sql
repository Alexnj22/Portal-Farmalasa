-- El token del kiosco se guarda como hash (paso 1 de 2: compatible).
--
-- Hasta hoy `kiosk_devices.device_token` era un uuid en claro que nunca vence:
-- lo leían los cargos con permiso sobre sucursales y, con él, cualquiera marcaba
-- por la sucursal y bajaba comunicados y datos del personal.
--
-- Paso 1 (éste): se agrega `device_token_hash` (SHA-256 del token), se llena
-- para los equipos ya vinculados —que siguen usando el MISMO token, no hay que
-- re-vincular— y toda comparación pasa por `kiosco_token_ok`, que todavía acepta
-- la fila sin hash comparando en claro. Un trigger mantiene el hash al día
-- mientras el texto plano siga existiendo.
-- Paso 2 (migración siguiente): se borra el texto plano.
--
-- Además, `get_kiosk_boot_payload` deja de entregar lo que el kiosco no pinta:
-- `email` y `gender` del personal, y los comunicados que no le tocan a nadie de
-- los que marcan ahí. Se queda `birth_date`: el saludo de cumpleaños dice la
-- edad. Los comunicados que llegan siguen siendo exactamente los que
-- `getApplicableAnnouncement` (src/utils/timeClock.audit.js) puede mostrar a
-- alguien del padrón del kiosco (sucursal + empleados con la sucursal asignada
-- + cobertura de la semana), con las mismas reglas: GLOBAL, BRANCH por sucursal
-- del empleado, ROLE por cargo principal (sin mayúsculas) y EMPLOYEE por id.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.kiosco_token_hash(p_token uuid)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.digest(p_token::text, 'sha256'), 'hex');
$$;

-- p_plano: la columna en claro mientras exista (paso 1). En el paso 2 se ignora.
CREATE OR REPLACE FUNCTION public.kiosco_token_ok(p_hash text, p_plano uuid, p_dado uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT p_dado IS NOT NULL
     AND (p_hash = public.kiosco_token_hash(p_dado)
          OR (p_hash IS NULL AND p_plano = p_dado));
$$;

REVOKE EXECUTE ON FUNCTION public.kiosco_token_hash(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.kiosco_token_ok(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosco_token_hash(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kiosco_token_ok(text, uuid, uuid) TO service_role;

ALTER TABLE public.kiosk_devices ADD COLUMN IF NOT EXISTS device_token_hash text;

UPDATE public.kiosk_devices
   SET device_token_hash = public.kiosco_token_hash(device_token)
 WHERE device_token IS NOT NULL
   AND device_token_hash IS DISTINCT FROM public.kiosco_token_hash(device_token);

CREATE UNIQUE INDEX IF NOT EXISTS kiosk_devices_device_token_hash_key
  ON public.kiosk_devices (device_token_hash);

CREATE OR REPLACE FUNCTION public.kiosk_devices_hash_del_token()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.device_token IS NOT NULL THEN
    NEW.device_token_hash := public.kiosco_token_hash(NEW.device_token);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.kiosk_devices_hash_del_token() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kiosk_devices_hash_del_token ON public.kiosk_devices;
CREATE TRIGGER trg_kiosk_devices_hash_del_token
  BEFORE INSERT OR UPDATE OF device_token ON public.kiosk_devices
  FOR EACH ROW EXECUTE FUNCTION public.kiosk_devices_hash_del_token();

-- ── Las seis funciones que comparaban el token en claro ─────────────────────
-- (las demás pasan por kiosco_sucursal). Cuerpos copiados de la definición viva;
-- sólo cambia la línea del token, y en el boot el recorte de arriba.

CREATE OR REPLACE FUNCTION public.kiosco_sucursal(p_device_id uuid, p_device_token uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT kd.branch_id
      FROM public.kiosk_devices kd
     WHERE kd.id = p_device_id
       AND public.kiosco_token_ok(kd.device_token_hash, kd.device_token, p_device_token)
       AND kd.status = 'ACTIVE'
       AND kd.revoked_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.verify_kiosk_device(p_device_id uuid, p_device_token uuid)
 RETURNS TABLE(branch_id bigint, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT kd.branch_id, kd.status
  FROM public.kiosk_devices kd
  WHERE kd.id = p_device_id
    AND public.kiosco_token_ok(kd.device_token_hash, kd.device_token, p_device_token)
    AND kd.status = 'ACTIVE';
$function$;

CREATE OR REPLACE FUNCTION public.verify_kiosk_pin(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch_id BIGINT;
    v_hash      TEXT;
    v_fails     INT;
    v_ok        BOOLEAN := false;
BEGIN
    SELECT branch_id INTO v_branch_id
    FROM public.kiosk_devices
    WHERE id = p_device_id
      AND public.kiosco_token_ok(device_token_hash, device_token, p_device_token)
      AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      AND revoked_at IS NULL;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    IF public.employee_esta_bloqueado(p_employee_id) THEN
        RETURN json_build_object('ok', false, 'motivo', 'SIN_ACCESO');
    END IF;

    SELECT count(*) INTO v_fails
    FROM public.kiosk_pin_attempts
    WHERE device_id = p_device_id
      AND succeeded = false
      AND created_at > now() - INTERVAL '5 minutes';

    IF v_fails >= 10 THEN
        INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
        VALUES (p_device_id, p_employee_id, false);
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    SELECT pin_hash INTO v_hash
    FROM public.kiosk_credentials
    WHERE employee_id = p_employee_id;

    IF v_hash IS NOT NULL THEN
        v_ok := (extensions.crypt(p_pin, v_hash) = v_hash);
    END IF;

    INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
    VALUES (p_device_id, p_employee_id, v_ok);

    RETURN json_build_object('ok', v_ok);
END $function$;

CREATE OR REPLACE FUNCTION public.verify_kiosk_authorization(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_code text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch_id BIGINT;
    v_fails     INT;
    v_code      TEXT := upper(btrim(COALESCE(p_code, '')));
    v_needs_su  BOOLEAN;
    v_bucket    TIMESTAMPTZ := date_trunc('hour', now());
    v_expected  TEXT;
    v_ok        BOOLEAN := false;
    v_method    TEXT    := NULL;
    v_who       TEXT    := NULL;
    rec         RECORD;
BEGIN
    SELECT branch_id INTO v_branch_id
    FROM public.kiosk_devices
    WHERE id = p_device_id
      AND public.kiosco_token_ok(device_token_hash, device_token, p_device_token)
      AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      AND revoked_at IS NULL;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    IF public.employee_esta_bloqueado(p_employee_id) THEN
        RETURN json_build_object('ok', false, 'motivo', 'SIN_ACCESO',
                                 'method', NULL, 'authorizer_name', NULL);
    END IF;

    SELECT count(*) INTO v_fails
    FROM public.kiosk_pin_attempts
    WHERE device_id = p_device_id
      AND succeeded = false
      AND created_at > now() - INTERVAL '5 minutes';

    IF v_fails >= 10 THEN
        INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
        VALUES (p_device_id, p_employee_id, false);
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.employees e
        LEFT JOIN public.roles rl1 ON rl1.id = e.role_id
        LEFT JOIN public.roles rl2 ON rl2.id = e.secondary_role_id
        WHERE e.id = p_employee_id
          AND (upper(COALESCE(rl1.name, '')) LIKE '%JEFE%'
            OR upper(COALESCE(rl2.name, '')) LIKE '%JEFE%')
    ) INTO v_needs_su;

    FOR rec IN SELECT unnest(ARRAY[v_bucket, v_bucket - INTERVAL '1 hour']) AS b LOOP
        v_expected := public.kiosk_auth_code_for(v_branch_id, rec.b, false)
                   || CASE WHEN v_needs_su
                           THEN public.kiosk_auth_code_for(v_branch_id, rec.b, true)
                           ELSE '' END;
        IF v_code = v_expected THEN
            v_ok     := true;
            v_method := 'HOURLY_CODE';
            EXIT;
        END IF;
    END LOOP;

    -- `NOT v_needs_su`: a un jefe o subjefe no lo autoriza el PIN de nadie,
    -- ni el propio (que ya estaba excluido) ni el de un par presente en la
    -- sala. Le corresponde el código SU y sólo el código SU.
    IF NOT v_ok AND NOT v_needs_su THEN
        FOR rec IN
            SELECT e.id,
                   COALESCE(e.name, e.first_names || ' ' || e.last_names) AS nombre,
                   k.pin_hash
            FROM public.employees e
            JOIN public.kiosk_credentials k ON k.employee_id = e.id
            LEFT JOIN public.roles rl1 ON rl1.id = e.role_id
            LEFT JOIN public.roles rl2 ON rl2.id = e.secondary_role_id
            WHERE e.branch_id = v_branch_id
              AND e.id <> p_employee_id
              AND e.status = 'ACTIVO'
              AND NOT public.employee_esta_bloqueado(e.id)
              AND (upper(COALESCE(rl1.name, '')) ~ '(JEFE|ADMIN|SUPERVISOR|GERENTE)'
                OR upper(COALESCE(rl2.name, '')) ~ '(JEFE|ADMIN|SUPERVISOR|GERENTE)')
        LOOP
            IF extensions.crypt(v_code, rec.pin_hash) = rec.pin_hash THEN
                v_ok     := true;
                v_method := 'SUPERVISOR_PIN';
                v_who    := rec.nombre;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
    VALUES (p_device_id, p_employee_id, v_ok);

    RETURN json_build_object('ok', v_ok, 'method', v_method, 'authorizer_name', v_who);
END $function$;

-- jsonb-agg: el padrón de cobertura de UNA sucursal en una semana (un puñado
-- de filas); el cuerpo no cambia respecto de la definición viva.
CREATE OR REPLACE FUNCTION public.get_kiosk_coverage_employees(p_device_id uuid, p_device_token uuid, p_week_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch_id BIGINT;
BEGIN
    SELECT branch_id INTO v_branch_id
    FROM public.kiosk_devices
    WHERE id = p_device_id
      AND public.kiosco_token_ok(device_token_hash, device_token, p_device_token)
      AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      AND revoked_at IS NULL;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    RETURN (
        SELECT COALESCE(jsonb_agg(emp_data), '[]'::jsonb)
        FROM (
            SELECT jsonb_build_object(
                'id',              e.id,
                'name',            e.name,
                'photo_url',       e.photo_url,
                'status',          e.status,
                'branch_id',       e.branch_id,
                'role',            COALESCE(r.name, ''),
                'secondary_role',  COALESCE(sr.name, ''),
                'exceptions',      COALESCE(e.exceptions, '[]'::jsonb),
                'has_roster',      true,
                'active_event_type', (
                    SELECT ee.type
                    FROM   public.employee_events ee
                    WHERE  ee.employee_id = e.id
                      AND  ee.date <= CURRENT_DATE
                      AND  COALESCE(ee.metadata->>'endDate', ee.date::text) >= CURRENT_DATE::text
                      AND  ee.type IN ('VACATION','DISABILITY','PERMIT','INDUCTION')
                    ORDER BY ee.date DESC
                    LIMIT  1
                ),
                'weekly_roster',
                    COALESCE(
                        (SELECT er.schedule_data
                         FROM   public.employee_rosters er
                         WHERE  er.employee_id    = e.id
                           AND  er.week_start_date = p_week_start
                         ORDER BY (er.status = 'PUBLISHED') DESC
                         LIMIT  1),
                        '{}'::jsonb
                    )
                    ||
                    COALESCE(
                        (SELECT jsonb_object_agg(sc2.day_of_week::text, sc2.schedule_data)
                         FROM   public.schedule_coverage sc2
                         WHERE  sc2.employee_id        = e.id
                           AND  sc2.coverage_branch_id = v_branch_id
                           AND  sc2.week_start_date    = p_week_start),
                        '{}'::jsonb
                    )
            ) AS emp_data
            FROM (
                SELECT DISTINCT employee_id
                FROM   public.schedule_coverage
                WHERE  coverage_branch_id = v_branch_id
                  AND  week_start_date    = p_week_start
            ) covered
            JOIN public.employees_safe e ON e.id = covered.employee_id
            LEFT JOIN public.roles r  ON r.id  = e.role_id
            LEFT JOIN public.roles sr ON sr.id = e.secondary_role_id
            WHERE UPPER(COALESCE(e.status, 'ACTIVO')) <> 'INACTIVO'
        ) sub
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_kiosk_boot_payload(p_device_id uuid, p_device_token uuid, p_week_start date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id BIGINT;
  v_payload   JSON;
  v_prev_week date;
BEGIN
  SELECT branch_id INTO v_branch_id
  FROM public.kiosk_devices
  WHERE id = p_device_id
    AND public.kiosco_token_ok(device_token_hash, device_token, p_device_token)
    AND status = 'ACTIVE' AND revoked_at IS NULL;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Marcador no encontrado o datos incorrectos';
  END IF;

  v_prev_week := p_week_start - INTERVAL '7 days';

  WITH padron AS (
    -- Quienes pueden marcar en este kiosco: los mismos dos conjuntos que
    -- 'employees' (abajo) y get_kiosk_coverage_employees.
    SELECT e.id, e.branch_id, lower(COALESCE(r.name, '')) AS cargo
      FROM (
        SELECT e.id FROM public.employees e
         WHERE e.branch_id = v_branch_id AND e.status = 'ACTIVO'
        UNION
        SELECT eb.employee_id FROM public.employee_branches eb
          JOIN public.employees emp ON emp.id = eb.employee_id
         WHERE eb.branch_id = v_branch_id AND emp.status = 'ACTIVO'
        UNION
        SELECT sc.employee_id FROM public.schedule_coverage sc
          JOIN public.employees emp ON emp.id = sc.employee_id
         WHERE sc.coverage_branch_id = v_branch_id
           AND sc.week_start_date = p_week_start
           AND UPPER(COALESCE(emp.status, 'ACTIVO')) <> 'INACTIVO'
      ) ids
      JOIN public.employees e ON e.id = ids.id
      LEFT JOIN public.roles r ON r.id = e.role_id
  )
  SELECT json_build_object(
    'shifts', (
      SELECT COALESCE(json_agg(s), '[]'::json)
      FROM public.shifts s
      WHERE (s.branch_id IS NULL OR s.branch_id = v_branch_id)
        AND s.is_active = true
    ),

    'announcements', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',            a.id,
        'title',         a.title,
        'message',       a.message,
        'target_type',   a.target_type,
        'target_value',  a.target_value,
        'priority',      a.priority,
        'read_by',       a.read_by,
        'prev_read_by',  a.prev_read_by,
        'created_by',    a.created_by,
        'edited_at',     a.edited_at,
        'scheduled_for', a.scheduled_for,
        'metadata',      a.metadata,
        'is_archived',   a.is_archived
      )), '[]'::json)
      FROM public.announcements a
      WHERE a.is_archived = false
        AND (
          a.target_type = 'GLOBAL'
          OR (a.target_type = 'BRANCH' AND EXISTS (
                SELECT 1 FROM padron p WHERE p.branch_id::text = a.target_value #>> '{}'))
          OR (a.target_type = 'ROLE' AND EXISTS (
                SELECT 1 FROM padron p WHERE p.cargo = lower(a.target_value #>> '{}')))
          OR (a.target_type = 'EMPLOYEE' AND EXISTS (
                SELECT 1 FROM padron p
                 WHERE CASE WHEN jsonb_typeof(a.target_value) = 'array'
                            THEN a.target_value ? p.id::text
                            ELSE p.id::text = a.target_value #>> '{}' END))
        )
    ),

    'employees', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',                e.id,
        'name',              COALESCE(e.name, e.first_names || ' ' || e.last_names),
        'first_names',       e.first_names,
        'last_names',        e.last_names,
        'branch_id',         e.branch_id,
        'photo_url',         e.photo_url,
        'birth_date',        e.birth_date,
        'role_id',           e.role_id,
        'secondary_role_id', e.secondary_role_id,
        'role',              main_r.name,
        'secondary_role',    sec_r.name,
        'weekly_roster', COALESCE(
          NULLIF(er.schedule_data, '{}'::jsonb),
          er_prev.schedule_data,
          '{}'::jsonb
        ),
        'has_roster', (er.id IS NOT NULL OR er_prev.id IS NOT NULL),
        'active_event_type', (
          SELECT ev.type
          FROM public.employee_events ev
          WHERE ev.employee_id = e.id
            AND ev.type IN ('VACATION', 'DISABILITY', 'PERMIT', 'SUPPORT')
            AND ev.date <= CURRENT_DATE
            AND COALESCE(ev.metadata->>'endDate', ev.date::text) >= CURRENT_DATE::text
            AND NOT EXISTS (
              SELECT 1 FROM public.employee_events recall
              WHERE recall.employee_id = e.id
                AND recall.type = 'VACATION_RECALL'
                AND recall.date = CURRENT_DATE
            )
          ORDER BY ev.date DESC
          LIMIT 1
        )
      )), '[]'::json)
      FROM (
        SELECT e.id
        FROM public.employees e
        WHERE e.branch_id = v_branch_id AND e.status = 'ACTIVO'
        UNION
        SELECT eb.employee_id AS id
        FROM public.employee_branches eb
        JOIN public.employees emp ON emp.id = eb.employee_id
        WHERE eb.branch_id = v_branch_id AND emp.status = 'ACTIVO'
      ) AS emp_ids
      JOIN public.employees e ON e.id = emp_ids.id
      LEFT JOIN public.roles main_r ON e.role_id = main_r.id
      LEFT JOIN public.roles sec_r  ON e.secondary_role_id = sec_r.id
      LEFT JOIN public.employee_rosters er
             ON e.id = er.employee_id AND er.week_start_date = p_week_start AND er.status = 'PUBLISHED'
      LEFT JOIN public.employee_rosters er_prev
             ON e.id = er_prev.employee_id AND er_prev.week_start_date = v_prev_week AND er_prev.status = 'PUBLISHED'
    ),

    'branches', (
      SELECT COALESCE(json_agg(b), '[]'::json)
      FROM (SELECT id, name FROM public.branches ORDER BY name) b
    ),

    'holidays', (
      SELECT COALESCE(json_agg(h), '[]'::json)
      FROM public.holidays h
      WHERE EXTRACT(YEAR FROM h.holiday_date) = EXTRACT(YEAR FROM CURRENT_DATE)
         OR h.is_recurring = true
    )
  ) INTO v_payload;

  RETURN v_payload;
END;
$function$;
