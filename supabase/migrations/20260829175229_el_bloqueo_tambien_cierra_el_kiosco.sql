SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El bloqueo también cierra el kiosco.
--
-- Preguntado por el usuario el 2026-08-29, sobre una persona recién bloqueada
-- «por desvinculación»: «bloqueado significa que ni con carné, ni usuario /
-- contraseña puede acceder ni marcar en el kiosco ni en nada, ¿verdad?».
--
-- La respuesta medida era **no**. El portal sí: el hook devuelve 403 antes de
-- emitir el token —así que ni la contraseña ni el carné entran— y 168 tablas
-- llevan una policy RESTRICTIVE que exige `auth_no_bloqueado()`. Pero el kiosco
-- **no pasa por la sesión de la persona**: entra como `anon` con el token del
-- equipo, y por eso ni el hook ni las policies lo alcanzan. Sus cinco funciones
-- exigían que la ficha estuviera `ACTIVO` y que la sala le correspondiera —
-- nunca miraban `blocked_until`.
--
-- Medido sobre la ficha del reporte el mismo día: bloqueada, `status = ACTIVO`,
-- cubierta en su sala, con carné y código vivos. **Podía ir al kiosco y marcar
-- entrada.** Es la única persona bloqueada hoy, así que el hueco es de una — y
-- lo es porque bloquear estuvo roto doce días, no porque nadie lo usara.
--
-- El usuario eligió el alcance: bloqueado es **fuera de todo**, kiosco
-- incluido. Se frena en las cinco puertas, y la razón de que sean cinco y no
-- una es que cada una entra por su lado: identificar, marcar, declarar turno,
-- validar el PIN, y prestar el PIN de supervisor para autorizar a otro.
--
-- Dos decisiones que no son obvias:
--
--   · **Se la reconoce y DESPUÉS se le niega**, en vez de hacerla invisible.
--     Si `kiosco_identificar` contestara «no encontrado», la pantalla diría
--     «CARNÉ NO RECONOCIDO» y la persona iría a pedir un carné nuevo — un
--     mensaje falso manda a la gente por el camino equivocado. Devuelve
--     `motivo: 'SIN_ACCESO'` con el nombre para que el kiosco pueda decir lo
--     que pasa de verdad. Enseñar el nombre no filtra nada: hay que tener el
--     carné en la mano para llegar hasta acá.
--
--   · **El intento se anota como identificación EXITOSA.** `intentos_identidad`
--     alimenta un freno de 20 fallos en 15 minutos POR SUCURSAL: si el rechazo
--     contara como fallo, una persona bloqueada insistiendo veinte veces
--     dejaría sin kiosco a toda la sala. La identificación funcionó —el carné
--     es válido y se supo de quién es—; lo que se niega es el acceso, y eso lo
--     anota el kiosco en su bitácora.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1· Identificarse con el carné, el código o el papel del día ─────────────
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

    RETURN json_build_object(
        'ok',          true,
        'employee_id', v_id,
        'metodo',      v_metodo
    );
END;
$function$;

-- ── 2· Marcar entrada/salida ───────────────────────────────────────────────
-- El freno de verdad. Los otros cuatro evitan que la pantalla llegue hasta acá;
-- éste es el que impide la fila en `attendance` aunque alguien llame la función
-- por su cuenta, o el navegador esté desactualizado.
CREATE OR REPLACE FUNCTION public.kiosco_marcar(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_tipo text, p_detalles jsonb DEFAULT '{}'::jsonb, p_momento timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch      bigint;
    v_branch_name text;
    v_device_name text;
    v_momento     timestamptz := now();
    v_detalles    jsonb := coalesce(p_detalles, '{}'::jsonb);
    v_previo      timestamptz;
    v_fila        public.attendance%ROWTYPE;
    v_nombre      text;
    v_evento      text;
BEGIN
    v_branch := public.kiosco_sucursal(p_device_id, p_device_token);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    IF p_tipo IS NULL OR p_tipo NOT IN (
        'IN','OUT','OUT_LUNCH','IN_LUNCH','OUT_LACTATION','IN_LACTATION',
        'OUT_EARLY','OUT_BUSINESS','IN_RETURN','IN_EXTRA','OUT_EXTRA'
    ) THEN
        RAISE EXCEPTION 'KIOSK_TIPO_INVALIDO: %', p_tipo;
    END IF;

    IF NOT public.kiosco_cubre_empleado(p_employee_id, v_branch) THEN
        RAISE EXCEPTION 'KIOSK_EMPLEADO_FUERA_DE_SUCURSAL';
    END IF;

    -- Sin acceso al portal es sin acceso al kiosco. Va ANTES de todo lo demás:
    -- una persona bloqueada no marca, no importa qué diga su horario.
    IF public.employee_esta_bloqueado(p_employee_id) THEN
        RETURN json_build_object('ok', false, 'motivo', 'SIN_ACCESO');
    END IF;

    -- Vacaciones / incapacidad / permiso vigente: no se marca. El navegador ya
    -- lo frena, pero un frente desactualizado no puede ser la única barrera.
    SELECT ev.type INTO v_evento
      FROM public.employee_events ev
     WHERE ev.employee_id = p_employee_id
       AND ev.type IN ('VACATION','DISABILITY','PERMIT')
       AND ev.date <= CURRENT_DATE
       AND coalesce(ev.metadata->>'endDate', ev.date::text) >= CURRENT_DATE::text
       AND NOT EXISTS (
            SELECT 1 FROM public.employee_events recall
             WHERE recall.employee_id = p_employee_id
               AND recall.type = 'VACATION_RECALL'
               AND recall.date = CURRENT_DATE)
     ORDER BY ev.date DESC
     LIMIT 1;

    IF v_evento IS NOT NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'EVENTO_ACTIVO', 'evento', v_evento);
    END IF;

    -- Hora: la del servidor salvo que sea un marcaje recuperado de la cola.
    IF p_momento IS NOT NULL THEN
        IF p_momento > now() + interval '1 minute' THEN
            RAISE EXCEPTION 'KIOSK_MOMENTO_EN_EL_FUTURO';
        END IF;
        IF p_momento < now() - interval '24 hours' THEN
            RAISE EXCEPTION 'KIOSK_MOMENTO_DEMASIADO_VIEJO';
        END IF;
        v_momento  := p_momento;
        v_detalles := v_detalles || jsonb_build_object('recuperadoDeCola', true);
    END IF;

    -- Duplicado: el mismo tipo dos veces en 3 minutos es un doble escaneo. El
    -- navegador ya lo mira, pero decide sobre su copia local — que puede estar
    -- vieja, o directamente vacía si otro equipo marcó primero.
    SELECT max(a.timestamp) INTO v_previo
      FROM public.attendance a
     WHERE a.employee_id = p_employee_id
       AND a.type = p_tipo
       AND a.timestamp > v_momento - interval '3 minutes'
       AND a.timestamp <= v_momento;

    IF v_previo IS NOT NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'DUPLICADO', 'previo', v_previo);
    END IF;

    SELECT b.name INTO v_branch_name FROM public.branches b WHERE b.id = v_branch;
    SELECT kd.device_name INTO v_device_name FROM public.kiosk_devices kd WHERE kd.id = p_device_id;
    SELECT e.name INTO v_nombre FROM public.employees e WHERE e.id = p_employee_id;

    -- La procedencia la escribe el servidor, no el navegador: hasta hoy viajaba
    -- en `details.audit_info` armada por `buildKioskAuditInfo`, que recibía la
    -- configuración con el nombre de parámetro equivocado (`kioskData` contra
    -- `kioskConfig`) y por eso guardaba sucursal, equipo y método en blanco en
    -- TODOS los marcajes.
    v_detalles := v_detalles || jsonb_build_object(
        'kiosco', jsonb_build_object(
            'branch_id',   v_branch,
            'branch_name', v_branch_name,
            'device_id',   p_device_id,
            'device_name', v_device_name
        )
    );

    INSERT INTO public.attendance (employee_id, timestamp, type, details)
    VALUES (p_employee_id, v_momento, p_tipo, v_detalles)
    RETURNING * INTO v_fila;

    INSERT INTO public.audit_logs
        (user_id, user_name, action, target_id, details, source, severity,
         branch_id, branch_name, device_name, input_method)
    VALUES (
        p_employee_id, v_nombre, 'REGISTRO_ASISTENCIA', p_employee_id::text,
        jsonb_build_object(
            'timeline_title', 'Marcaje registrado',
            'dimension',      'OPERATIVE',
            'tipo_marcaje',   p_tipo,
            'momento',        v_momento
        ) || (v_detalles - 'kiosco'),
        'KIOSK',
        CASE WHEN v_detalles ? 'pinOmitido' OR v_detalles ? 'pendingVerification'
             THEN 'WARNING' ELSE 'INFO' END,
        v_branch, v_branch_name, v_device_name,
        nullif(v_detalles->>'inputMethod', '')
    );

    UPDATE public.kiosk_devices SET last_active_at = now() WHERE id = p_device_id;

    RETURN json_build_object('ok', true, 'marcaje', to_json(v_fila));
END;
$function$;

-- ── 3· Declarar el turno propio ────────────────────────────────────────────
-- Abre una solicitud a Talento Humano. Una persona sin acceso no abre trámites.
CREATE OR REPLACE FUNCTION public.kiosco_declarar_turno(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_inicio text, p_fin text, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch bigint;
    v_fecha  date := (current_timestamp AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
    v_branch := public.kiosco_sucursal(p_device_id, p_device_token);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    IF NOT public.kiosco_cubre_empleado(p_employee_id, v_branch) THEN
        RAISE EXCEPTION 'KIOSK_EMPLEADO_FUERA_DE_SUCURSAL';
    END IF;

    IF public.employee_esta_bloqueado(p_employee_id) THEN
        RETURN json_build_object('ok', false, 'motivo', 'SIN_ACCESO');
    END IF;

    IF p_inicio !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p_fin !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'KIOSK_HORA_INVALIDA';
    END IF;

    INSERT INTO public.approval_requests (employee_id, approver_id, type, status, note, metadata)
    VALUES (
        p_employee_id, NULL, 'SHIFT_EXCEPTION', 'PENDING',
        'Turno declarado en el kiosco — pendiente de revisión de Talento Humano',
        coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
            'date',          v_fecha,
            'declaredStart', p_inicio,
            'declaredEnd',   p_fin,
            'branchId',      v_branch
        )
    );

    RETURN json_build_object('ok', true);
END;
$function$;

-- ── 4· El PIN propio ───────────────────────────────────────────────────────
-- Devuelve `ok: false` sin llegar a comparar el hash. No es un ahorro: es que
-- un PIN correcto de alguien bloqueado no debe contestar «correcto» a nada.
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
      AND device_token = p_device_token
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

-- ── 5· Que un supervisor autorice a otro ───────────────────────────────────
-- Dos frenos, porque son dos personas distintas:
--   · a quién se autoriza — si está bloqueada, no hay autorización que valga;
--   · quién presta su PIN — un supervisor bloqueado deja de ser una llave.
-- El código horario de la sala no lo firma nadie, así que ahí sólo aplica el
-- primero.
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
