SET lock_timeout = '5s';

-- ═══ Los tres lugares que leen un carné aprenden el de papel ════════════════
--
-- El cuarto es `ensure_user_by_code` (la edge function del login), que va
-- aparte porque no es SQL.
--
-- El orden es el mismo en los tres y NO es arbitrario: PIN del carné, después
-- código de empleado, y el de papel AL FINAL. Un carné de papel es la excepción
-- —dura un día y hay pocos vivos a la vez—, así que buscarlo primero costaría
-- una consulta de más en cada escaneo del kiosco para el caso raro.
--
-- El método queda escrito en `intentos_identidad`: 'CARNE_TEMPORAL'. Sin eso,
-- una entrada con papel se vería en la bitácora igual que una con el carné
-- plástico, que es justo la diferencia que alguien va a querer auditar.

-- ── 1. El kiosco de marcación ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosco_identificar(
    p_device_id    uuid,
    p_device_token uuid,
    p_carne        text
)
 RETURNS json
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch  bigint;
    v_limpio  text := upper(regexp_replace(coalesce(p_carne, ''), '\s', '', 'g'));
    v_fallos  integer;
    v_id      uuid;
    v_metodo  text := NULL;
BEGIN
    v_branch := public.kiosco_sucursal(p_device_id, p_device_token);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    IF v_limpio = '' THEN
        RETURN json_build_object('ok', false, 'motivo', 'VACIO');
    END IF;

    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.branch_id = v_branch
       AND i.proposito = 'KIOSCO_CARNE'
       AND NOT i.exito
       AND i.created_at > now() - interval '15 minutes';

    IF v_fallos >= 20 THEN
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    -- Primero el PIN del carné (8 alfanuméricos: espacio grande, es el que se
    -- escanea). Después el código, que es corto y por eso va segundo.
    SELECT e.id, 'CARNE' INTO v_id, v_metodo
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.kiosk_pin, '')) <> ''
       AND upper(btrim(e.kiosk_pin)) = v_limpio
       AND public.kiosco_cubre_empleado(e.id, v_branch)
     LIMIT 1;

    IF v_id IS NULL THEN
        SELECT e.id, 'CODIGO' INTO v_id, v_metodo
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND btrim(coalesce(e.code, '')) <> ''
           AND upper(btrim(e.code)) = v_limpio
           AND public.kiosco_cubre_empleado(e.id, v_branch)
         LIMIT 1;
    END IF;

    -- El carné de papel del día. Va al final y con la MISMA exigencia de
    -- cobertura que los otros dos: un papel no habilita a marcar en una sala
    -- que no es la suya.
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

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (NULL, 'KIOSCO_CARNE', v_id, coalesce(v_metodo, 'DESCONOCIDO'), v_id IS NOT NULL, v_branch);

    IF v_id IS NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'NO_ENCONTRADO');
    END IF;

    RETURN json_build_object(
        'ok',          true,
        'employee_id', v_id,
        'metodo',      v_metodo
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kiosco_identificar(uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.kiosco_identificar(uuid, uuid, text) TO anon, authenticated, service_role;

-- ── 2. El apoyo de un pedido ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.identificar_por_carne(p_valor text)
 RETURNS TABLE(id uuid, name text, first_names text, last_names text, photo_url text)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
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

    SELECT e.id, 'CARNE' INTO v_hit, v_metodo
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.kiosk_pin, '')) <> ''
       AND upper(btrim(e.kiosk_pin)) = v_limpio
       AND public.kiosco_cubre_empleado(e.id, v_sala)
     LIMIT 1;

    IF v_hit IS NULL THEN
        SELECT e.id, 'CODIGO' INTO v_hit, v_metodo
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND btrim(coalesce(e.code, '')) <> ''
           AND upper(btrim(e.code)) = v_limpio
           AND public.kiosco_cubre_empleado(e.id, v_sala)
         LIMIT 1;
    END IF;

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

REVOKE EXECUTE ON FUNCTION public.identificar_por_carne(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.identificar_por_carne(text) TO authenticated, service_role;

-- ── 3. La entrega del efectivo ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.probar_identidad_por_carne(p_secreto text)
 RETURNS json
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
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

    -- PIN primero, codigo despues. Es el orden de `kiosco_identificar` y el
    -- motivo esta medido (20260817154613): de los 46 carnes con PIN, CERO
    -- coinciden con su codigo, y lo que trae impreso el carne es el PIN.
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
        SELECT e.id INTO v_hit
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND btrim(coalesce(e.code, '')) <> ''
           AND upper(btrim(e.code)) = v_limpio
         LIMIT 1;
    END IF;

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

REVOKE EXECUTE ON FUNCTION public.probar_identidad_por_carne(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.probar_identidad_por_carne(text) TO authenticated, service_role;

-- ── 4. El permiso ──────────────────────────────────────────────────────────
--
-- Los mismos roles que hoy pueden editar el listado de personal, más Gerencia.
-- `can_edit` es el que emite; `can_view` deja ver el registro de quién imprimió
-- qué carné y hasta cuándo valía.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
VALUES
    (2,  'carne_temporal', true, true, false, 'ALL'),
    (3,  'carne_temporal', true, true, false, 'ALL'),
    (11, 'carne_temporal', true, true, false, 'ALL'),
    (13, 'carne_temporal', true, true, false, 'ALL'),
    (33, 'carne_temporal', true, true, false, 'ALL')
ON CONFLICT (role_id, module_key) DO NOTHING;
