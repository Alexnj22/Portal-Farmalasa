-- Auditoría de login y sesiones 2026-10-14 · servidor (1/2).
SET lock_timeout = '5s';

-- (3) La clase de dispositivo la mandaba el navegador tal cual, y el servidor
-- le daba 30 días a quien dijera 'app': `localStorage.sb_device_class='app'`
-- convertía los 5 minutos de una sala en un mes, del lado del servidor también.
-- Ahora 'app' se le cree sólo a una sesión cuyo user-agent (lo registra Auth al
-- abrirla, el navegador no lo elige después) es de teléfono o de la app nativa.
-- Medido antes del cambio: las 38 sesiones 'app' vivas son todas de iPhone,
-- Android, CFNetwork u okhttp, así que ninguna cambia de clase.
CREATE OR REPLACE FUNCTION public.touch_session(p_device_class text DEFAULT 'navegador'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session uuid;
  v_user    uuid;
  v_clase   text;
  v_fila    public.session_activity%ROWTYPE;
  v_hay     boolean;
  v_limite  integer;
BEGIN
  -- El session_id sale del JWT, NUNCA de un parámetro: quien llama no puede
  -- elegir qué sesión está renovando.
  v_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_user    := auth.uid();
  IF v_session IS NULL OR v_user IS NULL THEN
    RETURN;
  END IF;

  v_clase := CASE
    WHEN p_device_class = 'app' AND EXISTS (
           SELECT 1 FROM auth.sessions s
            WHERE s.id = v_session
              AND s.user_agent ~* '(iphone|ipad|android|cfnetwork|okhttp|dalvik|expo)')
      THEN 'app'
    ELSE 'navegador'
  END;

  SELECT * INTO v_fila FROM public.session_activity WHERE session_id = v_session;
  v_hay := FOUND;

  IF v_hay THEN
    v_limite := public.session_idle_limit_minutes(v_user, coalesce(v_fila.device_class, 'navegador'));
    -- Una sesión que YA pasó su límite no se revive. El hook la va a rechazar en
    -- la próxima renovación; bumpearla acá la devolvía a la vida, y eso es
    -- exactamente lo que convertía 5 minutos en 20: al volver de una pestaña
    -- oculta el navegador late antes de que nadie compruebe nada.
    IF now() - v_fila.last_seen_at >= make_interval(mins => v_limite) THEN
      RETURN;
    END IF;
    UPDATE public.session_activity SET last_seen_at = now() WHERE session_id = v_session;
  ELSE
    INSERT INTO public.session_activity (session_id, user_id, device_class, last_seen_at)
    VALUES (v_session, v_user, v_clase, now())
    ON CONFLICT (session_id) DO UPDATE SET last_seen_at = now();
    -- device_class NO se actualiza en el conflicto a propósito: se congela en el INSERT.
  END IF;

  -- La última conexión de la persona sólo se mueve cuando el latido valió: si la
  -- sesión ya estaba vencida, la última vez que estuvo REALMENTE adentro es la
  -- anterior, no ésta.
  INSERT INTO public.session_last_seen (user_id, last_seen_at, device_class)
  VALUES (v_user, now(), v_clase)
  ON CONFLICT (user_id) DO UPDATE
    SET last_seen_at = now(),
        device_class = EXCLUDED.device_class;
END;
$function$;

-- (1) Un carné de papel abre la sesión de esa persona hasta medianoche: es el
-- mismo poder que cambiarle la contraseña. Quien emitía podía hacérselo a
-- cualquiera, gerente incluido, y recibía el secreto. Mismo freno que las
-- funciones de cuentas: no sobre un cargo de rango MAYOR al propio.
CREATE OR REPLACE FUNCTION public.emitir_carne_temporal(p_employee_id uuid, p_motivo text DEFAULT NULL::text, p_impreso_en bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- Sin 0/O ni 1/I/L: aunque el valor no se imprime, alguien puede tener que
    -- leerlo de un registro y confundir esas letras cuesta una investigación.
    c_alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    c_largo    constant int  := 10;
    v_yo        uuid := (SELECT auth_employee_id());
    v_emp       record;
    v_puede     boolean;
    v_bytes     bytea;
    v_secreto   text := '';
    v_vence     timestamptz;
    v_id        bigint;
    i           int;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    SELECT e.id, e.name, e.status, e.branch_id, e.carne_pendiente
      INTO v_emp
      FROM public.employees e WHERE e.id = p_employee_id;

    IF v_emp.id IS NULL THEN
        RAISE EXCEPTION 'No encontre a esa persona.';
    END IF;
    IF v_emp.status IS DISTINCT FROM 'ACTIVO' THEN
        RAISE EXCEPTION 'Esa persona no esta activa: no se le puede dar un carne.';
    END IF;

    v_puede := (SELECT auth_can_edit_any(ARRAY['carne_temporal']))
        OR (v_emp.carne_pendiente AND (SELECT auth_can_edit_any(ARRAY['staff_list'])));
    IF NOT v_puede THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    IF p_employee_id <> v_yo
       AND public.rango_de_empleado(p_employee_id) > public.rango_de_empleado(v_yo) THEN
        RAISE EXCEPTION 'FORBIDDEN: no puedes emitir un carne para un cargo superior al tuyo.';
    END IF;

    -- El `::timestamp` NO es decorativo: sin él, `date AT TIME ZONE text`
    -- resuelve a la variante `timestamptz → timestamp` y devuelve el MEDIODÍA.
    v_vence := (((now() AT TIME ZONE 'America/El_Salvador')::date + 1)::timestamp
                AT TIME ZONE 'America/El_Salvador');

    v_bytes := extensions.gen_random_bytes(c_largo);
    FOR i IN 1..c_largo LOOP
        v_secreto := v_secreto
            || substr(c_alfabeto, 1 + (get_byte(v_bytes, i - 1) % length(c_alfabeto)), 1);
    END LOOP;

    -- El papel anterior de esa persona muere en el acto.
    UPDATE public.carnes_temporales
       SET anulado_el = now()
     WHERE employee_id = p_employee_id AND anulado_el IS NULL AND vence_el > now();

    INSERT INTO public.carnes_temporales
        (employee_id, secreto_hash, vence_el, emitido_por, branch_id, impreso_en, motivo)
    VALUES (
        p_employee_id,
        encode(extensions.digest(v_secreto, 'sha256'), 'hex'),
        v_vence, v_yo, v_emp.branch_id, p_impreso_en,
        nullif(btrim(coalesce(p_motivo,'')), '')
    )
    RETURNING id INTO v_id;

    RETURN json_build_object(
        'ok', true,
        'id', v_id,
        'secreto', v_secreto,
        'vence_el', v_vence,
        'employee_id', p_employee_id,
        'nombre', v_emp.name
    );
END;
$function$;
