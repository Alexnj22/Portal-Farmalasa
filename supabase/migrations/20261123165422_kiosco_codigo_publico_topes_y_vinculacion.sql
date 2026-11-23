-- Kiosco: tres arreglos de seguridad (aprobados por el usuario el 2026-11-23).
-- Parte de las definiciones VIVAS (pg_get_functiondef, después de
-- 20261123140631 y 20261123140803).
--
-- (1) El número de empleado ya no identifica. Seis funciones caían a
--     `employees.code` cuando el valor no era un PIN de carné. Ese número es
--     público (sale en facturas y en Ventas). Antes de quitarlo se midió en
--     producción: los 55 activos tienen PIN de 8 caracteres y ninguno coincide
--     con su código; todos los flujos vivos (kiosco, apoyo de pedido, retiro,
--     ruta de bolsas, entrega de efectivo) leen el carné con el lector o la
--     cámara, y el lector del portal descarta lo tecleado; el carné de papel
--     se resuelve por `resolver_carne_temporal` (hash), que no cambia; y
--     `probar_identidad` (único que pasa CARNE a `verificar_persona`) no se
--     llama desde ningún frente.
--     Además el freno de `kiosco_identificar` contaba por SUCURSAL: 20 fallos
--     de un equipo dejaban sin marcar a toda la sucursal. Ahora cuenta por
--     EQUIPO (columna nueva `intentos_identidad.device_id`).
-- (2) PIN y código de autorización del kiosco: además de 10 fallos / 5 min por
--     equipo, 10 fallos por empleado en 24 h y 30 por sucursal en 24 h.
-- (3) Vinculación: emitir un ticket de kiosco o un código de caja exige
--     alcance ALL en el módulo, o que la sucursal sea la propia.
SET lock_timeout = '5s';

-- ── (1) ────────────────────────────────────────────────────────────────────
ALTER TABLE public.intentos_identidad ADD COLUMN IF NOT EXISTS device_id uuid;
COMMENT ON COLUMN public.intentos_identidad.device_id IS
  'Equipo del kiosco que hizo el intento (sólo KIOSCO_CARNE). El freno de kiosco_identificar cuenta por equipo, no por sucursal.';

CREATE INDEX IF NOT EXISTS idx_intentos_identidad_kiosco_fallos
    ON public.intentos_identidad (device_id, created_at DESC)
 WHERE proposito = 'KIOSCO_CARNE' AND NOT exito;

CREATE OR REPLACE FUNCTION public.kiosco_identificar(p_device_id uuid, p_device_token uuid, p_carne text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch  bigint;
    v_limpio  text := upper(regexp_replace(coalesce(p_carne, ''), '\s', '', 'g'));
    v_fallos  integer;
    v_id      uuid;
    v_metodo  text := NULL;
    v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_hasta   text;
BEGIN
    v_branch := public.kiosco_sucursal(p_device_id, p_device_token);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    IF v_limpio = '' THEN
        RETURN json_build_object('ok', false, 'motivo', 'VACIO');
    END IF;

    -- El freno cuenta por EQUIPO. Por sucursal, 20 fallos desde un equipo
    -- dejaban sin marcar a todos los equipos de la sala. Con sólo el PIN de 8
    -- alfanuméricos, 20 intentos cada 15 min no adivinan nada.
    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.device_id = p_device_id
       AND i.proposito = 'KIOSCO_CARNE'
       AND NOT i.exito
       AND i.created_at > now() - interval '15 minutes';

    IF v_fallos >= 20 THEN
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    -- Sólo el PIN del carné (8 alfanuméricos). El código de empleado es
    -- público y ya no identifica (2026-11-23).
    SELECT e.id, 'CARNE' INTO v_id, v_metodo
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.kiosk_pin, '')) <> ''
       AND upper(btrim(e.kiosk_pin)) = v_limpio
       AND public.kiosco_cubre_empleado(e.id, v_branch)
     LIMIT 1;

    -- El carné de papel del día. Con la MISMA exigencia de cobertura: un papel
    -- no habilita a marcar en una sala que no es la suya.
    IF v_id IS NULL THEN
        v_id := public.resolver_carne_temporal(v_limpio);
        IF v_id IS NOT NULL THEN
            IF public.kiosco_cubre_empleado(v_id, v_branch) THEN
                v_metodo := 'CARNE_TEMPORAL';
            ELSE
                v_id := NULL;
            END IF;
        END IF;
    END IF;

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id, device_id)
    VALUES (NULL, 'KIOSCO_CARNE', v_id, coalesce(v_metodo, 'DESCONOCIDO'), v_id IS NOT NULL, v_branch, p_device_id);

    IF v_id IS NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'NO_ENCONTRADO');
    END IF;

    -- Bloqueada: se la reconoció, y por eso el intento de arriba quedó como
    -- exitoso. Lo que se niega es el acceso, y se dice con su nombre para que
    -- la pantalla no invente que el carné está roto.
    IF public.employee_esta_bloqueado(v_id) THEN
        RETURN json_build_object(
            'ok',          false,
            'motivo',      'SIN_ACCESO',
            'employee_id', v_id,
            'nombre',      (SELECT e.name FROM public.employees e WHERE e.id = v_id)
        );
    END IF;

    -- Suspendida por el RIT Art. 83: además, la fecha de vuelta.
    IF public.esta_suspendido(v_id, v_hoy) THEN
        SELECT coalesce(nullif(x.metadata->>'endDate', ''), x.date::text) INTO v_hasta
          FROM public.employee_events x
         WHERE x.employee_id = v_id
           AND x.type = 'SUSPENSION'
           AND x.date <= v_hoy
           AND coalesce(nullif(x.metadata->>'endDate','')::date, x.date) >= v_hoy
         ORDER BY x.date DESC
         LIMIT 1;

        RETURN json_build_object(
            'ok',          false,
            'motivo',      'SUSPENDIDO',
            'employee_id', v_id,
            'nombre',      (SELECT e.name FROM public.employees e WHERE e.id = v_id),
            'hasta',       v_hasta
        );
    END IF;

    RETURN json_build_object(
        'ok',          true,
        'employee_id', v_id,
        'metodo',      v_metodo
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.identificar_por_carne(p_valor text)
 RETURNS TABLE(id uuid, name text, first_names text, last_names text, photo_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid := (SELECT auth_employee_id());
    v_sala   bigint := (SELECT auth_employee_branch_id());
    v_limpio text := upper(regexp_replace(coalesce(p_valor, ''), '\s', '', 'g'));
    v_fallos integer;
    v_hit    uuid;
    v_metodo text := NULL;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF v_sala IS NULL THEN
        RAISE EXCEPTION 'Tu ficha no tiene sucursal asignada: pide que te asignen una para poder confirmar carnes.';
    END IF;
    IF v_limpio = '' THEN RETURN; END IF;

    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.quien = v_yo AND i.proposito = 'CARNE_LOOKUP'
       AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

    IF v_fallos >= 20 THEN
        RAISE EXCEPTION 'Demasiados carnes sin reconocer seguidos. Espera unos minutos.';
    END IF;

    -- Sólo el PIN del carné; el código de empleado es público (2026-11-23).
    SELECT e.id, 'CARNE' INTO v_hit, v_metodo
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.kiosk_pin, '')) <> ''
       AND upper(btrim(e.kiosk_pin)) = v_limpio
       AND public.kiosco_cubre_empleado(e.id, v_sala)
     LIMIT 1;

    IF v_hit IS NULL THEN
        v_hit := public.resolver_carne_temporal(v_limpio);
        IF v_hit IS NOT NULL THEN
            IF public.kiosco_cubre_empleado(v_hit, v_sala) THEN
                v_metodo := 'CARNE_TEMPORAL';
            ELSE
                v_hit := NULL;
            END IF;
        END IF;
    END IF;

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (v_yo, 'CARNE_LOOKUP', v_hit, coalesce(v_metodo, 'DESCONOCIDO'), v_hit IS NOT NULL, v_sala);

    RETURN QUERY
    SELECT e.id, e.name, e.first_names, e.last_names, e.photo_url
      FROM public.employees e WHERE e.id = v_hit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.retiro_firmar_carne(p_valor text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quien  uuid   := (SELECT public.auth_employee_id());
  v_sala   bigint := (SELECT public.auth_employee_branch_id());
  v_limpio text   := upper(regexp_replace(coalesce(p_valor, ''), '\s', '', 'g'));
  v_fallos integer;
  v_hit    uuid;
  v_metodo text := NULL;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;
  IF v_limpio = '' THEN
    RETURN json_build_object('ok', false, 'codigo', 'CARNE_VACIO',
      'error', 'No se leyó ningún código. Vuelve a pasar el carné.');
  END IF;

  SELECT count(*) INTO v_fallos
    FROM public.intentos_identidad i
   WHERE i.quien = v_quien AND i.proposito = 'CARNE_LOOKUP'
     AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

  IF v_fallos >= 20 THEN
    RETURN json_build_object('ok', false, 'codigo', 'DEMASIADOS',
      'error', 'Demasiados carnés sin reconocer seguidos. Espera unos minutos.');
  END IF;

  -- Sólo el PIN que trae impreso el carné; el código de empleado es público
  -- y ya no identifica (2026-11-23).
  SELECT e.id, 'CARNE' INTO v_hit, v_metodo
    FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND btrim(coalesce(e.kiosk_pin, '')) <> ''
     AND upper(btrim(e.kiosk_pin)) = v_limpio
   LIMIT 1;

  -- El carné de papel del día vale lo mismo que el de plástico: quien lo tiene
  -- es porque Administración se lo imprimió hoy.
  IF v_hit IS NULL THEN
    v_hit := public.resolver_carne_temporal(v_limpio);
    IF v_hit IS NOT NULL THEN v_metodo := 'CARNE_TEMPORAL'; END IF;
  END IF;

  INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
  VALUES (v_quien, 'CARNE_LOOKUP', v_hit, coalesce(v_metodo, 'DESCONOCIDO'), v_hit IS NOT NULL, v_sala);

  IF v_hit IS NULL THEN
    RETURN json_build_object('ok', false, 'codigo', 'CARNE_DESCONOCIDO',
      'error', 'Ese carné no es de nadie.');
  END IF;

  RETURN public.retiro_firmar(v_hit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.probar_identidad_por_carne(p_secreto text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid   := (SELECT auth_employee_id());
    v_sala   bigint := (SELECT auth_employee_branch_id());
    v_limpio text   := upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g'));
    v_fallos integer;
    v_hit    uuid;
    v_metodo text := 'CARNE';
    v_token  uuid;
    v_emp    record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_limpio = '' THEN
        RETURN json_build_object('ok', false, 'motivo', 'No se leyo nada. Pasa el carne por el lector.');
    END IF;

    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.quien = v_yo AND i.proposito = 'RETIRO'
       AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

    IF v_fallos >= 10 THEN
        RETURN json_build_object('ok', false,
            'motivo', 'Demasiados carnes sin reconocer seguidos. Espera unos minutos.');
    END IF;

    -- Sólo el PIN que trae impreso el carné; el código de empleado es público
    -- y ya no identifica (2026-11-23).
    --
    -- Sin filtro de sucursal a proposito — quien recolecta el efectivo es de
    -- administracion y no pertenece a la sala donde firma.
    SELECT e.id INTO v_hit
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.kiosk_pin, '')) <> ''
       AND upper(btrim(e.kiosk_pin)) = v_limpio
     LIMIT 1;

    IF v_hit IS NULL THEN
        v_hit := public.resolver_carne_temporal(v_limpio);
        IF v_hit IS NOT NULL THEN v_metodo := 'CARNE_TEMPORAL'; END IF;
    END IF;

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (v_yo, 'RETIRO', v_hit, v_metodo, v_hit IS NOT NULL, v_sala);

    IF v_hit IS NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'Ese carne no es de nadie activo.');
    END IF;

    INSERT INTO public.identidad_vales (employee_id, metodo, emitido_por)
    VALUES (v_hit, 'CARNE', v_yo)
    RETURNING token INTO v_token;

    SELECT e.id, e.name, e.photo_url INTO v_emp
      FROM public.employees e WHERE e.id = v_hit;

    RETURN json_build_object(
        'ok', true,
        'vale', v_token,
        'employee', json_build_object('id', v_emp.id, 'name', v_emp.name, 'photo_url', v_emp.photo_url)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public._carne_a_empleado(p_valor text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quien  uuid   := public.auth_employee_id();
  v_sala   bigint := public.auth_employee_branch_id();
  v_limpio text   := upper(regexp_replace(coalesce(p_valor, ''), '\s', '', 'g'));
  v_fallos integer;
  v_hit    uuid;
  v_metodo text;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;
  IF v_limpio = '' THEN
    RETURN json_build_object('ok', false, 'codigo', 'CARNE_VACIO', 'error', 'No se leyó ningún código. Vuelve a pasar el carné.');
  END IF;
  SELECT count(*) INTO v_fallos FROM public.intentos_identidad i
   WHERE i.quien = v_quien AND i.proposito = 'CARNE_LOOKUP' AND NOT i.exito
     AND i.created_at > now() - interval '15 minutes';
  IF v_fallos >= 20 THEN
    RETURN json_build_object('ok', false, 'codigo', 'DEMASIADOS', 'error', 'Demasiados carnés sin reconocer seguidos. Espera unos minutos.');
  END IF;
  -- Sólo el PIN del carné; el código de empleado es público (2026-11-23).
  SELECT e.id, 'CARNE' INTO v_hit, v_metodo FROM public.employees e
   WHERE e.status = 'ACTIVO' AND btrim(coalesce(e.kiosk_pin, '')) <> '' AND upper(btrim(e.kiosk_pin)) = v_limpio LIMIT 1;
  IF v_hit IS NULL THEN
    v_hit := public.resolver_carne_temporal(v_limpio);
    IF v_hit IS NOT NULL THEN v_metodo := 'CARNE_TEMPORAL'; END IF;
  END IF;
  INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
  VALUES (v_quien, 'CARNE_LOOKUP', v_hit, coalesce(v_metodo, 'DESCONOCIDO'), v_hit IS NOT NULL, v_sala);
  IF v_hit IS NULL THEN
    RETURN json_build_object('ok', false, 'codigo', 'CARNE_DESCONOCIDO', 'error', 'Ese carné no es de nadie.');
  END IF;
  RETURN json_build_object('ok', true, 'id', v_hit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.verificar_persona(p_employee_id uuid, p_metodo text, p_secreto text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
    v_ok     boolean := false;
    v_limpio text    := upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g'));
BEGIN
    IF p_employee_id IS NULL OR v_limpio = '' THEN
        RETURN false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = p_employee_id AND e.status = 'ACTIVO') THEN
        RETURN false;
    END IF;

    IF p_metodo = 'CARNE' THEN
        -- Sólo el PIN que trae el carné impreso. El código de empleado es
        -- público y ya no prueba nada (2026-11-23).
        SELECT true INTO v_ok FROM public.employees e
         WHERE e.id = p_employee_id
           AND btrim(coalesce(e.kiosk_pin, '')) <> ''
           AND upper(btrim(e.kiosk_pin)) = v_limpio;
        RETURN coalesce(v_ok, false);
    END IF;

    IF p_metodo = 'CLAVE' THEN
        -- La contraseña NO se normaliza: sus espacios y sus mayúsculas son
        -- parte del secreto.
        SELECT true INTO v_ok
          FROM auth.users u
         WHERE u.encrypted_password IS NOT NULL
           AND u.encrypted_password = extensions.crypt(p_secreto, u.encrypted_password)
           AND (u.id = p_employee_id
                OR u.id IN (SELECT l.auth_user_id FROM public.employee_auth_accounts l
                             WHERE l.employee_id = p_employee_id))
         LIMIT 1;
        RETURN coalesce(v_ok, false);
    END IF;

    RETURN false;
END;
$function$;

-- ── (2) ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kiosk_pin_attempts_emp_fallos
    ON public.kiosk_pin_attempts (employee_id, created_at DESC)
 WHERE NOT succeeded;

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
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    -- Tope por persona: 10 fallos en 24 h, sumando todos los equipos.
    SELECT count(*) INTO v_fails
    FROM public.kiosk_pin_attempts
    WHERE employee_id = p_employee_id
      AND succeeded = false
      AND created_at > now() - INTERVAL '24 hours';

    IF v_fails >= 10 THEN
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    -- Tope por sucursal: 30 fallos en 24 h entre todos sus equipos.
    SELECT count(*) INTO v_fails
    FROM public.kiosk_pin_attempts a
    JOIN public.kiosk_devices d ON d.id = a.device_id
    WHERE d.branch_id = v_branch_id
      AND a.succeeded = false
      AND a.created_at > now() - INTERVAL '24 hours';

    IF v_fails >= 30 THEN
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
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    -- Tope por persona: 10 fallos en 24 h, sumando todos los equipos.
    SELECT count(*) INTO v_fails
    FROM public.kiosk_pin_attempts
    WHERE employee_id = p_employee_id
      AND succeeded = false
      AND created_at > now() - INTERVAL '24 hours';

    IF v_fails >= 10 THEN
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    -- Tope por sucursal: 30 fallos en 24 h entre todos sus equipos. Es lo que
    -- acota adivinar el código por hora (4 dígitos, valen dos a la vez).
    SELECT count(*) INTO v_fails
    FROM public.kiosk_pin_attempts a
    JOIN public.kiosk_devices d ON d.id = a.device_id
    WHERE d.branch_id = v_branch_id
      AND a.succeeded = false
      AND a.created_at > now() - INTERVAL '24 hours';

    IF v_fails >= 30 THEN
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

-- ── (3) ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosco_ticket_emitir(p_branch_id bigint, p_tipo text, p_nombre text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_codigo text := 'KV';
  v_nombre text;
  v_ticket public.kiosco_tickets_vinculacion;
BEGIN
  IF NOT (SELECT auth_has_module_permission('kiosco_vincular', 'can_view')) THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF p_tipo NOT IN ('marcacion', 'caja') THEN
    RAISE EXCEPTION 'TIPO_INVALIDO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'SUCURSAL_INVALIDA';
  END IF;
  -- Sólo para la sucursal propia, salvo alcance de red en el módulo: un
  -- equipo vinculado a otra sala marcaría y cobraría allí.
  IF NOT ((SELECT public.auth_module_scope('kiosco_vincular')) = 'ALL'
          OR p_branch_id = (SELECT public.auth_employee_branch_id())) THEN
    RAISE EXCEPTION 'SIN_ALCANCE';
  END IF;

  FOR i IN 0..9 LOOP
    v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
  END LOOP;
  v_nombre := coalesce(nullif(btrim(p_nombre), ''),
                       CASE p_tipo WHEN 'caja' THEN 'Kiosco de caja' ELSE 'Marcador' END);

  -- Retención: los tickets se vuelven inútiles a los 15 minutos; la traza se
  -- guarda 90 días, como el resto de los registros de sincronización.
  DELETE FROM public.kiosco_tickets_vinculacion WHERE created_at < now() - interval '90 days';

  INSERT INTO public.kiosco_tickets_vinculacion (codigo_hash, branch_id, tipo, device_name, emitido_por)
  VALUES (encode(extensions.digest(v_codigo, 'sha256'), 'hex'), p_branch_id, p_tipo, v_nombre, public.auth_employee_id())
  RETURNING * INTO v_ticket;

  RETURN json_build_object('codigo', v_codigo, 'vence_at', v_ticket.vence_at,
                           'tipo', v_ticket.tipo, 'device_name', v_ticket.device_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_codigo_de_vinculacion(p_branch_id bigint, p_nombre text)
 RETURNS TABLE(id uuid, codigo text, expira timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- Sin O/0/I/1: en un papel escrito a mano esos cuatro se leen igual, y el
    -- error aparecería recién al final de la instalación.
    v_abc  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_cod  text := '';
    v_dev  uuid;
    i      integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_branch_id IS NULL OR btrim(coalesce(p_nombre,'')) = '' THEN
        RAISE EXCEPTION 'Falta la sucursal o el nombre de la caja.';
    END IF;
    -- Sólo para la sucursal propia, salvo alcance de red en el módulo.
    IF NOT ((SELECT public.auth_module_scope('impresion')) = 'ALL'
            OR p_branch_id = (SELECT public.auth_employee_branch_id())) THEN
        RAISE EXCEPTION 'SIN_ALCANCE';
    END IF;

    FOR i IN 1..8 LOOP
        v_cod := v_cod || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1);
    END LOOP;

    INSERT INTO public.impresion_dispositivos
        (branch_id, nombre, created_by, codigo_vinculacion, vinculacion_expira)
    VALUES (p_branch_id, btrim(p_nombre), (SELECT auth_employee_id()),
            v_cod, now() + interval '15 minutes')
    RETURNING impresion_dispositivos.id INTO v_dev;

    RETURN QUERY SELECT v_dev, v_cod, now() + interval '15 minutes';
END;
$function$;
