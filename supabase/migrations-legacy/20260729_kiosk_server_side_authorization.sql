-- 20260729_kiosk_server_side_authorization
--
-- Fase 4 del rediseño de credenciales del kiosco (AUDITORIA-SUPABASE-2026-07-29.md,
-- S1-ter). Mueve al servidor la autorización de las excepciones que afectan
-- planilla.
--
-- Problema: los tres caminos de autorización del kiosco no tienen ningún secreto.
--
--   src/utils/helpers.js:180
--   getHourlyCode  = () => Math.sin((año*365)+(día*31)+(mes*12)+(hora*60)) → 4 díg.
--   getSuPinSuffix = () => Math.sin(seed + 1337)                          → 2 díg.
--
-- Son funciones deterministas del reloj, calculadas EN EL NAVEGADOR, y la
-- comparación también es client-side (useTimeClockEngine.js:745). Cualquiera que
-- abra el bundle JS —que es público— calcula el código de la hora y se autoriza
-- sus propias horas extra. El tercer camino, el kiosk_pin del supervisor, es
-- SHA-256(code), igual de derivable.
--
-- Las reglas que esto protege están bien (timeClock.helpers.js:130-259): el PIN
-- se pide solo en los 6 casos que tocan planilla — SPECIAL_OUT_REQUEST,
-- IN_EXTRA en día libre, IN_EARLY (>30 min), IN_AFTER_SHIFT, OUT_LATE (>15 min)
-- e IN_EXTRA tras OUT. Lo que falla es la credencial, no la regla.
--
-- Diseño:
--   · Un pepper de 32 bytes en Vault. El código pasa a ser
--     HMAC-SHA256(pepper, branch:hora:variante) — mismo formato de 4+2 dígitos
--     para no cambiar el teclado del kiosco ni el flujo de "llamo al jefe".
--   · Se acepta el bucket actual Y el anterior: el jefe puede leer el código a
--     las 10:59 y el empleado teclearlo a las 11:01. El esquema viejo tenía el
--     mismo borde y no lo contemplaba.
--   · El código va por sucursal: uno de La Popular no autoriza en La Salud.
--   · verify_kiosk_authorization reemplaza TODO el bloque client-side, incluida
--     la vía alternativa del PIN personal del supervisor, que ahora se compara
--     contra kiosk_credentials (bcrypt) y no contra un valor derivable.

SET lock_timeout = '5s';

-- ------------------------------------------------------------------- secreto
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'kiosk_auth_pepper') THEN
        PERFORM vault.create_secret(
            encode(extensions.gen_random_bytes(32), 'hex'),
            'kiosk_auth_pepper',
            'Pepper del codigo horario de autorizacion del kiosco. Reemplaza getHourlyCode/getSuPinSuffix, que se calculaban en el navegador sin secreto.'
        );
    END IF;
END $$;

-- --------------------------------------------------------------- derivación
-- Interna: nunca se expone a la API. p_su=false → 4 dígitos (código base),
-- p_su=true → 2 dígitos (sufijo para empleados JEFE/SUBJEFE).
CREATE OR REPLACE FUNCTION public.kiosk_auth_code_for(
    p_branch_id BIGINT,
    p_bucket    TIMESTAMPTZ,
    p_su        BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
    v_secret TEXT;
    v_hex    TEXT;
    v_num    INT;
BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'kiosk_auth_pepper';

    IF v_secret IS NULL THEN
        RAISE EXCEPTION 'KIOSK_PEPPER_MISSING';
    END IF;

    v_hex := encode(
        extensions.hmac(
            COALESCE(p_branch_id::text, '-') || ':' ||
            to_char(p_bucket AT TIME ZONE 'UTC', 'YYYYMMDDHH24') || ':' ||
            CASE WHEN p_su THEN 'SU' ELSE 'BASE' END,
            v_secret, 'sha256'),
        'hex');

    -- 7 nibbles con un 0 al frente → siempre positivo, sin borde de INT_MIN.
    v_num := ('x0' || substr(v_hex, 1, 7))::bit(32)::int;

    RETURN CASE WHEN p_su
                THEN lpad((v_num % 100)::text,   2, '0')
                ELSE lpad((v_num % 10000)::text, 4, '0')
           END;
END $$;

REVOKE EXECUTE ON FUNCTION public.kiosk_auth_code_for(BIGINT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------- el jefe lee el código
-- Reemplaza el getHourlyCode() de AppLayout.jsx:198/249. Mismo permiso que ya
-- gobierna mostrar el PIN en la UI (kiosk_pin / can_view).
CREATE OR REPLACE FUNCTION public.get_kiosk_auth_code(p_branch_id BIGINT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_branch BIGINT;
    v_bucket TIMESTAMPTZ := date_trunc('hour', now());
BEGIN
    IF NOT (SELECT auth_has_module_permission('kiosk_pin', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    v_branch := COALESCE(p_branch_id, (SELECT auth_employee_branch_id())::bigint);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'BRANCH_REQUIRED';
    END IF;

    -- Scope: solo su sucursal, salvo permiso ALL.
    IF p_branch_id IS NOT NULL
       AND (SELECT auth_module_scope('kiosk_pin')) <> 'ALL'
       AND p_branch_id <> (SELECT auth_employee_branch_id())::bigint THEN
        RAISE EXCEPTION 'FORBIDDEN_BRANCH';
    END IF;

    RETURN json_build_object(
        'code',       public.kiosk_auth_code_for(v_branch, v_bucket, false),
        'su_suffix',  public.kiosk_auth_code_for(v_branch, v_bucket, true),
        'branch_id',  v_branch,
        'valid_until', v_bucket + INTERVAL '1 hour'
    );
END $$;

REVOKE EXECUTE ON FUNCTION public.get_kiosk_auth_code(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_kiosk_auth_code(BIGINT) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_kiosk_auth_code IS
    'Codigo horario de autorizacion del kiosco, para que el jefe lo lea en el portal. Gated por kiosk_pin/can_view. Rota cada hora y es distinto por sucursal.';

-- ------------------------------------------------- el kiosco lo verifica
-- Reemplaza el bloque client-side de useTimeClockEngine.js:721-760, incluida la
-- via alternativa del PIN personal del supervisor.
CREATE OR REPLACE FUNCTION public.verify_kiosk_authorization(
    p_device_id    UUID,
    p_device_token UUID,
    p_employee_id  UUID,
    p_code         TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
    r           RECORD;
BEGIN
    SELECT branch_id INTO v_branch_id
    FROM public.kiosk_devices
    WHERE id = p_device_id
      AND device_token = p_device_token
      AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      AND revoked_at IS NULL;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
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

    -- ¿El empleado autorizado es JEFE/SUBJEFE? Entonces el código lleva sufijo.
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
        LEFT JOIN public.roles r  ON r.id  = e.role_id
        LEFT JOIN public.roles r2 ON r2.id = e.secondary_role_id
        WHERE e.id = p_employee_id
          AND (upper(COALESCE(r.name, '')) LIKE '%JEFE%'
            OR upper(COALESCE(r2.name, '')) LIKE '%JEFE%')
    ) INTO v_needs_su;

    -- 1) Código horario del servidor: bucket actual y anterior (borde de hora).
    FOR r IN SELECT unnest(ARRAY[v_bucket, v_bucket - INTERVAL '1 hour']) AS b LOOP
        v_expected := public.kiosk_auth_code_for(v_branch_id, r.b, false)
                   || CASE WHEN v_needs_su
                           THEN public.kiosk_auth_code_for(v_branch_id, r.b, true)
                           ELSE '' END;
        IF v_code = v_expected THEN
            v_ok     := true;
            v_method := 'HOURLY_CODE';
            EXIT;
        END IF;
    END LOOP;

    -- 2) PIN personal de un supervisor de esa sucursal (bcrypt, no derivable).
    IF NOT v_ok THEN
        FOR r IN
            SELECT e.id, COALESCE(e.name, e.first_names || ' ' || e.last_names) AS nombre, k.pin_hash
            FROM public.employees e
            JOIN public.kiosk_credentials k ON k.employee_id = e.id
            LEFT JOIN public.roles ro  ON ro.id  = e.role_id
            LEFT JOIN public.roles ro2 ON ro2.id = e.secondary_role_id
            WHERE e.branch_id = v_branch_id
              AND e.status = 'ACTIVO'
              AND (upper(COALESCE(ro.name,  '')) ~ '(JEFE|ADMIN|SUPERVISOR|GERENTE)'
                OR upper(COALESCE(ro2.name, '')) ~ '(JEFE|ADMIN|SUPERVISOR|GERENTE)')
        LOOP
            IF extensions.crypt(v_code, r.pin_hash) = r.pin_hash THEN
                v_ok     := true;
                v_method := 'SUPERVISOR_PIN';
                v_who    := r.nombre;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
    VALUES (p_device_id, p_employee_id, v_ok);

    RETURN json_build_object('ok', v_ok, 'method', v_method, 'authorizer_name', v_who);
END $$;

REVOKE EXECUTE ON FUNCTION public.verify_kiosk_authorization(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verify_kiosk_authorization(UUID, UUID, UUID, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.verify_kiosk_authorization IS
    'Autoriza una excepcion de marcaje desde un kiosco vinculado: acepta el codigo horario del servidor o el PIN personal de un supervisor de la sucursal. anon a proposito (el kiosco es pre-login); valida device_token y aplica rate limit.';
