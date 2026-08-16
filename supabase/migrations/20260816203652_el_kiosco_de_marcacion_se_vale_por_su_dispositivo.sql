-- El kiosco de marcación se vale por su propio dispositivo, sin sesión.
--
-- Hallazgo que origina esta migración (auditoría 2026-08-16, medido contra el
-- entorno de pruebas con la llave pública): la pantalla `/kiosk` corre SIN
-- sesión a propósito —`App.jsx` sólo llama `fetchKioskBoot()` cuando NO hay
-- usuario— pero **todas** sus escrituras van a tablas con policy `TO
-- authenticated`. Comprobado: `SELECT` e `INSERT` sobre `attendance` con la
-- llave anónima devuelven `HTTP 401 permission denied for function
-- auth_employee_id`. O sea que el kiosco:
--
--   · no puede leer los marcajes del día  → no sabe si alguien ya entró, y
--     resuelve SIEMPRE «IN» porque su lista de marcajes llega vacía;
--   · no puede insertar el marcaje        → `registerAttendance` lanza, el
--     marcaje cae a la cola local y se reintenta para siempre contra la misma
--     policy que lo rechaza. En pantalla dice «Sin conexión: marcaje guardado,
--     se sincronizará solo» — un éxito que nunca ocurre;
--   · no puede escribir en `audit_logs`   → la bitácora de seguridad del
--     kiosco (tecleo manual bloqueado, PIN incorrecto, marcaje duplicado,
--     marcaje sin PIN) no registra NADA;
--   · no puede marcar un aviso como leído → el aviso reaparece en cada marcaje;
--   · no puede declarar un turno          → la solicitud a Talento Humano se
--     pierde en silencio.
--
-- La corrección no es abrir esas tablas a `anon`: es darle al kiosco la misma
-- puerta que ya tiene para leer su arranque —el par `device_id`/`device_token`
-- de `kiosk_devices`, que ya validan `verify_kiosk_device` y
-- `get_kiosk_boot_payload`—. Cada función de acá valida ese par primero y
-- trabaja acotada a la sucursal de ESE equipo.
--
-- Tres cosas que mejoran respecto de escribir desde el navegador:
--
--   1. **La hora la pone el servidor.** Antes el marcaje llevaba el reloj de la
--      computadora del kiosco; mover ese reloj movía la planilla. `p_momento`
--      existe sólo para la cola sin conexión, acepta hasta 24 h hacia atrás,
--      nunca el futuro, y deja el marcaje señalado como recuperado.
--   2. **El equipo sólo marca a su propia gente.** Sucursal del empleado,
--      sucursal secundaria o cobertura de la semana. Un kiosco de una sala no
--      puede fabricar el marcaje de alguien de otra.
--   3. **El carné se resuelve en el servidor.** Hasta hoy el arranque repartía
--      el código de cada empleado al navegador y la comparación era local. Ese
--      código es la contraseña del portal de esa persona (`ensure_user_by_code`
--      entra con él), así que repartirlo entrega 46 credenciales a un equipo
--      compartido. Ahora viaja el valor escaneado, vuelve un id, y el código
--      sale del arranque.
--
-- Probado entero en el branch `staging` antes de acá: identificación por PIN de
-- carné y por código, carné inexistente, credencial de equipo equivocada,
-- marcaje, doble escaneo, empleado de otra sucursal, tipo inventado, hora en el
-- futuro, marcaje recuperado con su hora real, bitácora, acción de bitácora
-- inventada y turno declarado. Más el kiosco real en el navegador contra ese
-- entorno (`tests/e2e/kiosco-marcacion.spec.js`).

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helpers internos — no los ejecuta nadie de afuera
-- ─────────────────────────────────────────────────────────────────────────────

-- Sucursal del equipo, o NULL si el par no existe / está revocado.
CREATE OR REPLACE FUNCTION public.kiosco_sucursal(p_device_id uuid, p_device_token uuid)
 RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT kd.branch_id
      FROM public.kiosk_devices kd
     WHERE kd.id = p_device_id
       AND kd.device_token = p_device_token
       AND kd.status = 'ACTIVE'
       AND kd.revoked_at IS NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.kiosco_sucursal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kiosco_sucursal(uuid, uuid) TO service_role;

-- ¿Este equipo puede marcarle a esta persona? Sucursal propia, sucursal
-- secundaria (`employee_branches`) o cobertura de la semana en curso.
CREATE OR REPLACE FUNCTION public.kiosco_cubre_empleado(p_employee_id uuid, p_branch_id bigint)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = p_employee_id
           AND e.status = 'ACTIVO'
           AND (
                e.branch_id = p_branch_id
             OR EXISTS (SELECT 1 FROM public.employee_branches eb
                         WHERE eb.employee_id = e.id AND eb.branch_id = p_branch_id)
             OR EXISTS (SELECT 1 FROM public.schedule_coverage sc
                         WHERE sc.employee_id = e.id
                           AND sc.coverage_branch_id = p_branch_id
                           AND sc.week_start_date >= (CURRENT_DATE - INTERVAL '7 days'))
           )
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.kiosco_cubre_empleado(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kiosco_cubre_empleado(uuid, bigint) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ¿De quién es este carné?
-- ─────────────────────────────────────────────────────────────────────────────
--
-- El carné impreso lleva el PIN de 8 caracteres (`FormNovedad.jsx` lo dibuja
-- con JsBarcode sobre `kiosk_pin`), no el código de empleado — comprobado: de
-- los 46 carnés con PIN, CERO tienen PIN igual al código, así que el kiosco,
-- que comparaba contra `code`, no habría reconocido ni un carné.
--
-- Se acepta también el código porque Talento Humano lo teclea cuando un carné
-- se despega o todavía no se imprimió. Los dos caminos quedan registrados con
-- el método usado, así que se puede medir cuál se usa.
--
-- Freno: 20 carnés no reconocidos en 15 minutos por equipo. Sin esto, el par
-- device/token —que vive en el disco de un equipo compartido— convierte esta
-- función en un oráculo para reconstruir la tabla de códigos a fuerza bruta.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Los marcajes que el kiosco necesita conocer
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Desde ayer 00:00 hora de El Salvador: el motor necesita el día de hoy para
-- decidir el tipo de marcaje, y el de ayer para los turnos que cruzan la
-- medianoche (`getLastPunchOfDay` arrastra la entrada abierta del día anterior).
--
-- Volumen real: 49 empleados activos, ~6 marcajes por persona y día → menos de
-- 600 filas por llamada aun contando las dos jornadas. Muy por debajo del tope
-- de 1000 de PostgREST, y además esto devuelve UN json, al que ese tope no le
-- aplica.
CREATE OR REPLACE FUNCTION public.kiosco_marcajes_recientes(
    p_device_id    uuid,
    p_device_token uuid
)
 RETURNS json
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch bigint;
    v_desde  timestamptz;
BEGIN
    v_branch := public.kiosco_sucursal(p_device_id, p_device_token);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    v_desde := (((current_timestamp AT TIME ZONE 'America/El_Salvador')::date - 1)::timestamp)
               AT TIME ZONE 'America/El_Salvador';

    RETURN (
        SELECT coalesce(json_agg(to_json(t) ORDER BY t.timestamp), '[]'::json)
          FROM (
            SELECT a.id, a.employee_id, a.timestamp, a.type, a.details
              FROM public.attendance a
             WHERE a.timestamp >= v_desde
               AND public.kiosco_cubre_empleado(a.employee_id, v_branch)
          ) t
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kiosco_marcajes_recientes(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.kiosco_marcajes_recientes(uuid, uuid) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Registrar el marcaje
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `p_momento` es SÓLO para la cola sin conexión. Sin él, un marcaje recuperado
-- media jornada después se guardaba con la hora del reintento
-- —`registerAttendance` hacía `new Date()` al insertar, ignorando cuándo ocurrió
-- de verdad— y la planilla recibía una entrada a las 3 de la tarde.
CREATE OR REPLACE FUNCTION public.kiosco_marcar(
    p_device_id    uuid,
    p_device_token uuid,
    p_employee_id  uuid,
    p_tipo         text,
    p_detalles     jsonb DEFAULT '{}'::jsonb,
    p_momento      timestamptz DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
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

REVOKE EXECUTE ON FUNCTION public.kiosco_marcar(uuid, uuid, uuid, text, jsonb, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.kiosco_marcar(uuid, uuid, uuid, text, jsonb, timestamptz) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Bitácora de seguridad del kiosco
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `appendAuditLog` escribe directo en `audit_logs`, cuya policy exige
-- `user_id = auth_employee_id()`. Sin sesión eso es NULL, así que hoy el kiosco
-- no deja rastro de sus eventos de seguridad: tecleo manual bloqueado, PIN
-- incorrecto, marcaje sin autorizar, marcaje duplicado, marcaje bloqueado por
-- vacaciones. Precisamente lo que hay que poder investigar.
--
-- La lista de acciones es cerrada para que un equipo con el token no pueda
-- inventar entradas de bitácora de cualquier tipo.
CREATE OR REPLACE FUNCTION public.kiosco_bitacora(
    p_device_id    uuid,
    p_device_token uuid,
    p_accion       text,
    p_employee_id  uuid DEFAULT NULL,
    p_detalles     jsonb DEFAULT '{}'::jsonb
)
 RETURNS json
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch      bigint;
    v_branch_name text;
    v_device_name text;
    v_nombre      text;
    v_detalles    jsonb := coalesce(p_detalles, '{}'::jsonb);
BEGIN
    v_branch := public.kiosco_sucursal(p_device_id, p_device_token);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    IF p_accion NOT IN (
        'INTENTO_MANUAL_BLOQUEADO', 'INTENTO_PIN_INCORRECTO', 'MARCAJE_SIN_PIN',
        'MARCAJE_DUPLICADO_BLOQUEADO', 'MARCAJE_BLOQUEADO_EVENTO',
        'AUTORIZACION_KIOSK_PIN', 'AUTORIZACION_OFFLINE_PENDIENTE',
        'CARNE_NO_RECONOCIDO'
    ) THEN
        RAISE EXCEPTION 'KIOSK_ACCION_INVALIDA: %', p_accion;
    END IF;

    SELECT b.name INTO v_branch_name FROM public.branches b WHERE b.id = v_branch;
    SELECT kd.device_name INTO v_device_name FROM public.kiosk_devices kd WHERE kd.id = p_device_id;
    IF p_employee_id IS NOT NULL THEN
        SELECT e.name INTO v_nombre FROM public.employees e WHERE e.id = p_employee_id;
    END IF;

    -- El valor tecleado NUNCA se guarda: un dedazo mete ahí el PIN real de
    -- quien lo escribió, y `audit_logs` lo lee cualquiera con `auditview`.
    v_detalles := v_detalles - 'codigo_intentado' - 'pin' - 'carne' - 'valor';

    INSERT INTO public.audit_logs
        (user_id, user_name, action, target_id, details, source, severity,
         branch_id, branch_name, device_name, input_method)
    VALUES (
        p_employee_id, coalesce(v_nombre, 'Kiosco'), p_accion, p_employee_id::text,
        v_detalles, 'KIOSK',
        CASE WHEN p_accion = 'AUTORIZACION_KIOSK_PIN' THEN 'INFO' ELSE 'WARNING' END,
        v_branch, v_branch_name, v_device_name,
        nullif(v_detalles->>'inputMethod', '')
    );

    RETURN json_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kiosco_bitacora(uuid, uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.kiosco_bitacora(uuid, uuid, text, uuid, jsonb) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Aviso leído
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `markAnnouncementAsRead` hace UPDATE sobre `announcements`, que exige
-- `announcements.can_edit`. Sin sesión no pasa, así que el aviso vuelve a
-- aparecer en cada marcaje y nadie queda registrado como que lo leyó.
CREATE OR REPLACE FUNCTION public.kiosco_aviso_leido(
    p_device_id       uuid,
    p_device_token    uuid,
    p_announcement_id uuid,
    p_employee_id     uuid
)
 RETURNS json
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch bigint;
BEGIN
    v_branch := public.kiosco_sucursal(p_device_id, p_device_token);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    IF NOT public.kiosco_cubre_empleado(p_employee_id, v_branch) THEN
        RAISE EXCEPTION 'KIOSK_EMPLEADO_FUERA_DE_SUCURSAL';
    END IF;

    UPDATE public.announcements a
       SET read_by = a.read_by || jsonb_build_array(jsonb_build_object(
                       'employeeId', p_employee_id::text,
                       'readAt',     now()))
     WHERE a.id = p_announcement_id
       AND NOT (a.read_by @> jsonb_build_array(jsonb_build_object('employeeId', p_employee_id::text)))
       AND NOT (a.read_by @> to_jsonb(ARRAY[p_employee_id::text]));

    RETURN json_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kiosco_aviso_leido(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.kiosco_aviso_leido(uuid, uuid, uuid, uuid) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Turno declarado en el kiosco
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Quien marca en un día que su horario da por libre declara de qué hora a qué
-- hora viene, y Talento Humano lo valida en su revisión. Hoy ese insert va
-- directo a `approval_requests`, cuya policy exige que la fila sea del propio
-- usuario — sin sesión, se pierde en silencio (el código ni siquiera mira el
-- error: la función se llama `insertApprovalRequestSilent`).
CREATE OR REPLACE FUNCTION public.kiosco_declarar_turno(
    p_device_id    uuid,
    p_device_token uuid,
    p_employee_id  uuid,
    p_inicio       text,
    p_fin          text,
    p_metadata     jsonb DEFAULT '{}'::jsonb
)
 RETURNS json
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
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

REVOKE EXECUTE ON FUNCTION public.kiosco_declarar_turno(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.kiosco_declarar_turno(uuid, uuid, uuid, text, text, jsonb) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. El arranque deja de repartir el código de empleado
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Con la identificación resuelta en el servidor, `code` ya no hace falta en el
-- navegador — y repartirlo entregaba a un equipo compartido la contraseña del
-- portal de cada persona de la sala. Se agrega `has_roster` para que el kiosco
-- pueda distinguir «hoy libre» de «sin horario cargado», que no son lo mismo:
-- para la semana del 17-ago-2026, 41 de 49 empleados activos no tienen horario
-- publicado, y sin esa distinción cada uno de sus marcajes habría exigido
-- autorización de supervisor.
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
  WHERE id = p_device_id AND device_token = p_device_token
    AND status = 'ACTIVE' AND revoked_at IS NULL;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Kiosco no encontrado o credenciales inválidas';
  END IF;

  v_prev_week := p_week_start - INTERVAL '7 days';

  SELECT json_build_object(
    'shifts', (
      SELECT COALESCE(json_agg(s), '[]'::json)
      FROM public.shifts s
      WHERE (s.branch_id IS NULL OR s.branch_id = v_branch_id)
        AND s.is_active = true
    ),

    'announcements', (
      SELECT COALESCE(json_agg(a), '[]'::json)
      FROM public.announcements a
      WHERE a.is_archived = false
    ),

    'employees', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',                e.id,
        'name',              COALESCE(e.name, e.first_names || ' ' || e.last_names),
        'first_names',       e.first_names,
        'last_names',        e.last_names,
        'branch_id',         e.branch_id,
        'photo_url',         e.photo_url,
        'gender',            e.gender,
        'birth_date',        e.birth_date,
        'email',             e.email,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. La lista de cobertura estaba rota — dos veces
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `get_kiosk_coverage_employees` es la que hace que un kiosco reconozca a quien
-- viene a cubrir desde otra sala. Comprobado llamándola en producción:
--
--   ERROR 42703: column e.code does not exist
--
-- Se rompió el 2026-08-16 al sacar `code` y `kiosk_pin` de `employees_safe`
-- (migración `20260816014507`). Nadie lo vio porque el navegador la envuelve en
-- un `catch {}` marcado «non-fatal»: la cobertura simplemente dejó de llegar.
-- Detrás de ese error hay un segundo, tapado por el primero: filtra por
-- `ee.end_date`, columna que `employee_events` NO tiene — la fecha de fin vive
-- en `metadata->>'endDate'`, que es como la leen el resto de las consultas.
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
      AND device_token = p_device_token
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
