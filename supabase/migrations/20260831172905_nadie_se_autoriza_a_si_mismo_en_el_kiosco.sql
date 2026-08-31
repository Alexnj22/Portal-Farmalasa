SET lock_timeout = '5s';

-- Autorizar una marcación es un acto de UNA SEGUNDA PERSONA.
--
-- El camino del PIN recorría a los autorizadores de la sucursal sin excluir a
-- quien está marcando, así que cualquiera cuyo cargo contuviera
-- JEFE/ADMIN/SUPERVISOR/GERENTE tecleaba su PROPIO PIN y quedaba autorizado,
-- con `authorizer_name` = él mismo. En 5 de las 7 salas hay exactamente UN
-- autorizador, así que ahí «la segunda persona» y «la misma persona» eran el
-- mismo PIN.
--
-- Y el refuerzo pensado justo para ese caso —el sufijo SU cuando a quien se
-- autoriza es un jefe— sólo vive en el camino del código por hora: el del PIN
-- no lo pedía, o sea que lo saltaba entero.
--
-- Decisión del usuario (2026-08-31): «no, no puede, para eso está el otro
-- código SU». Un jefe que necesita autorizarse pide el código SU a
-- administración; no se firma a sí mismo.
--
-- Lo único que cambia es `e.id <> p_employee_id` en el bucle del PIN. Se deja
-- anotado lo que NO cambia: quién puede autorizar se decide por el TEXTO del
-- cargo y no por un permiso, así que renombrar un cargo mueve esa lista sin
-- avisar («un rótulo no es una clave»). Eso es una decisión aparte.
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
      AND device_token = p_device_token
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
