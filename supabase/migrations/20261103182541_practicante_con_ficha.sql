-- ── El practicante tiene ficha y entra al portal (2026-11-03) ──────────────
--
-- Pedido del usuario: al dar de alta un practicante, «que se pueda subir el
-- DUI la foto, así como en empleado, y que lo lea y sea igual», y que entre
-- al portal «a los módulos que se le asignen» — pero NO al kiosco.
--
-- Hasta hoy `practicantes` era una tabla suelta: sin usuario, sin foto, sin
-- lectura del DUI. Todo eso ya existe para `employees`, así que el practicante
-- pasa a tener una ficha ahí con `tipo_ficha = 'practicante'` y `practicantes`
-- se queda con lo que es de la pasantía (institución, tutor, fechas, horas,
-- convenio), enlazada por `employee_id`.
--
-- Por qué un tipo propio y no `servicio_externo`: las ~20 funciones que
-- preguntan «¿es personal en planilla?» lo hacen con
-- `coalesce(tipo_ficha,'empleado') = 'empleado'`, así que un tipo nuevo queda
-- FUERA de planilla, horarios, vacaciones y avisos de sala sin tocar ninguna.
-- Y el kiosco tiene que poder distinguirlo, que con `servicio_externo` no
-- podría sin frenar también al contador.
SET lock_timeout = '5s';

-- 1. El tipo nuevo.
ALTER TABLE public.employees DROP CONSTRAINT employees_tipo_ficha_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_tipo_ficha_check
  CHECK (tipo_ficha IN ('empleado', 'servicio_externo', 'tecnica', 'practicante'));

COMMENT ON COLUMN public.employees.tipo_ficha IS
  'empleado = persona en planilla · servicio_externo = presta un servicio y entra al portal, '
  'no es personal contratado · tecnica = cuenta del sistema · practicante = horas sociales: '
  'entra al portal con su cargo, NO marca en el kiosco ni está en planilla (sus datos de la '
  'pasantía viven en practicantes, por employee_id).';

-- 2. El enlace. Único: una ficha es de UN practicante. `SET NULL` y no
--    CASCADE: borrar la ficha no puede llevarse el convenio ni la pasantía.
ALTER TABLE public.practicantes
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS practicantes_employee_id_key
  ON public.practicantes (employee_id) WHERE employee_id IS NOT NULL;

-- 3. El cargo. Arranca sólo con los avisos: lo demás se le asigna en Roles,
--    que es lo que el usuario pidió («los módulos que se le asignen»). Sin
--    filas de permiso, el cargo entraría a un portal vacío.
--
--    El contador de `roles.id` estaba ATRÁS de la tabla (medido: 39, con el
--    id 40 ya ocupado por una fila insertada con id explícito). Sin esto el
--    insert choca con la llave primaria.
SELECT setval(pg_get_serial_sequence('public.roles', 'id'),
              greatest((SELECT max(id) FROM public.roles), 1));

INSERT INTO public.roles (name, scope)
SELECT 'Practicante', 'BRANCH'
 WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Practicante');

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'emp_announcements', true, false, false, 'ALL'
  FROM public.roles r
 WHERE r.name = 'Practicante'
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.role_id = r.id AND rp.module_key = 'emp_announcements');

-- 4. El kiosco no lo deja marcar. En los DOS sitios: identificar (para que la
--    pantalla le hable con su nombre) y marcar (porque un frente viejo o la
--    cola sin red pueden llegar directo acá).
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

    -- Practicante (2026-11-03): entra al portal, pero no marca. Sus horas no
    -- son jornada laboral y no van a planilla.
    IF EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_id AND e.tipo_ficha = 'practicante') THEN
        RETURN json_build_object(
            'ok',          false,
            'motivo',      'NO_MARCA',
            'employee_id', v_id,
            'nombre',      (SELECT e.name FROM public.employees e WHERE e.id = v_id)
        );
    END IF;

    -- Suspendida por el RIT Art. 83. Mismo criterio que el bloqueo, y ADEMÁS la
    -- fecha de vuelta: quien está parado frente al kiosco necesita saber si
    -- vuelve mañana o en tres semanas, y preguntárselo a su jefe es justo lo
    -- que una pantalla puede ahorrarle.
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

    -- Practicante (2026-11-03): no marca. Mismo freno que en
    -- `kiosco_identificar`, repetido porque la cola sin red llega directo acá.
    IF EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id AND e.tipo_ficha = 'practicante') THEN
        RETURN json_build_object('ok', false, 'motivo', 'NO_MARCA');
    END IF;

    -- Vacaciones / incapacidad / permiso vigente: no se marca. El navegador ya
    -- lo frena, pero un frente desactualizado no puede ser la única barrera.
    SELECT ev.type INTO v_evento
      FROM public.employee_events ev
     WHERE ev.employee_id = p_employee_id
       AND ev.type IN ('VACATION','DISABILITY','PERMIT','SUSPENSION')
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
