-- 20260729_fix_kiosk_auth_record_shadowing
--
-- Corrige un bug de shadowing en verify_kiosk_authorization
-- (20260729_kiosk_server_side_authorization), detectado al probar la función
-- contra un dispositivo de kiosco de prueba.
--
--   ERROR: 55000 record "r" is not assigned yet
--
-- La función declaraba `r RECORD` como variable de los FOR ... LOOP, y además
-- usaba `r` como alias de tabla dentro del EXISTS que decide si el empleado es
-- JEFE/SUBJEFE:
--
--   LEFT JOIN public.roles r ON r.id = e.role_id
--   ... upper(COALESCE(r.name, '')) LIKE '%JEFE%'
--
-- PL/pgSQL resuelve `r.name` contra la VARIABLE (un record todavía sin asignar)
-- antes que contra el alias de la consulta, así que cualquier llamada reventaba
-- en la línea 37 — es decir, toda autorización de excepción de marcaje habría
-- fallado. Sin la prueba esto llegaba a producción intacto.
--
-- Fix: la variable de bucle pasa a `rec` y los alias de roles a `rl1`/`rl2`,
-- sin colisión posible.

SET lock_timeout = '5s';

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
    rec         RECORD;
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

    IF NOT v_ok THEN
        FOR rec IN
            SELECT e.id,
                   COALESCE(e.name, e.first_names || ' ' || e.last_names) AS nombre,
                   k.pin_hash
            FROM public.employees e
            JOIN public.kiosk_credentials k ON k.employee_id = e.id
            LEFT JOIN public.roles rl1 ON rl1.id = e.role_id
            LEFT JOIN public.roles rl2 ON rl2.id = e.secondary_role_id
            WHERE e.branch_id = v_branch_id
              AND e.status = 'ACTIVO'
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
END $$;
