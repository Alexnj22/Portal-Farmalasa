SET lock_timeout = '5s';

-- A un jefe o subjefe lo autoriza el código SU, y nada más.
--
-- Quedaba un hueco después de `nadie_se_autoriza_a_si_mismo_en_el_kiosco`: el
-- sufijo SU se exigía sólo por el camino del CÓDIGO DE LA HORA; el camino del
-- PIN de un par no lo pedía. O sea que la misma regla valía distinto según la
-- sala:
--
--   · Salud 1 y Salud 4 tienen DOS personas con cargo de jefatura (la jefa de
--     sala y una regente de enfermería con «Subjefe/a de Sala» de secundario),
--     así que se autorizaban entre ellas con su PIN, sin ningún código SU.
--   · Las otras cinco salas tienen una sola, y ahí el SU ya era el único
--     camino porque no hay par.
--
-- Decisión del usuario (2026-08-31): sólo el código SU. Si a quien marca le
-- corresponde SU —`v_needs_su`, que es cargo o cargo secundario conteniendo
-- «JEFE», y por eso «SUBJEFE» entra— el bucle del PIN ni se recorre.
--
-- Que el rebote se entienda depende de la otra mitad, que salió en v2.880.1: el
-- cartel «Requiere código SU (6 dígitos)» del kiosco no se mostraba nunca
-- porque comparaba el cargo por igualdad contra 'JEFE'. Sin ese cartel, esta
-- migración sola convertiría un caso legítimo en un «código incorrecto» sin
-- explicación.
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
