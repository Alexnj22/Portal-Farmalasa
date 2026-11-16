-- Lenguaje: «kiosco» → marcador, «marcaje» → marcación en dos textos visibles.
-- Cada función parte de su definición viva (2026-11-16); sólo cambia el literal.
SET lock_timeout = '5s';

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
    RAISE EXCEPTION 'Marcador no encontrado o datos incorrectos';
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
            'timeline_title', 'Marcación registrada',
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
