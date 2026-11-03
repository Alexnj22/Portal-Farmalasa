-- ── El horario de la práctica (2026-11-03) ──────────────────────────────────
--
-- Pedido del usuario: «los horarios, que se establezcan de alguna forma fácil.
-- habilítalo en horarios y turnos. debe tomar en cuenta las horas, tiempo, y
-- demás de cada practicante. así dice cuándo finalizan».
--
-- La forma fácil es UN patrón por practicante, no una semana a la vez: qué días
-- viene, a qué hora entra y sale, y si toma pausa. Vive en
-- `practicantes.horario` y de ahí se escriben sus semanas en `employee_rosters`
-- —la MISMA tabla de Horarios y turnos—, publicadas, desde la semana en curso
-- hasta la de `fecha_fin`. Así:
--   · el kiosco sabe su turno (sin horario pedía autorización de supervisor);
--   · Horarios y turnos lo muestra y deja corregir un día como a cualquiera;
--   · la asistencia mide sus tardanzas y faltas contra algo.
--
-- Formato del patrón:
--   { "dias": [1,2,3,4,5],        -- 0 = domingo … 6 = sábado (claveDeDia)
--     "entrada": "08:00", "salida": "12:00",
--     "pausa_inicio": "12:00" | null, "pausa_minutos": 60 | 0 }
--
-- Las semanas pasadas NO se tocan: son lo que ya se trabajó.
SET lock_timeout = '5s';

ALTER TABLE public.practicantes ADD COLUMN IF NOT EXISTS horario jsonb;
COMMENT ON COLUMN public.practicantes.horario IS
  'Patrón semanal de la práctica: {dias:[0-6], entrada, salida, pausa_inicio, pausa_minutos}. '
  'De aquí aplicar_horario_de_practica() escribe sus semanas en employee_rosters.';

-- Publicar la semana de una sala incluye a sus practicantes: si no, una semana
-- que alguien tocó a mano en Horarios quedaba en borrador para siempre.
CREATE OR REPLACE FUNCTION public.publicar_horarios_de_sala(p_week_start date, p_branch_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cuantos integer;
BEGIN
  WITH publicadas AS (
    UPDATE public.employee_rosters r
       SET status = 'PUBLISHED', updated_at = now()
      FROM public.employees e
     WHERE e.id = r.employee_id
       AND r.week_start_date = p_week_start
       AND r.status <> 'PUBLISHED'
       AND e.branch_id = p_branch_id
       AND e.status = 'ACTIVO'
       AND coalesce(e.tipo_ficha, 'empleado') IN ('empleado', 'practicante')
    RETURNING 1
  )
  SELECT count(*) INTO v_cuantos FROM publicadas;
  RETURN v_cuantos;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_horario_de_practica(p_practicante_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_p        public.practicantes%ROWTYPE;
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_lunes    date;
    v_ultimo   date;
    v_dia      date;
    v_semana   jsonb;
    v_dias     int[];
    v_trabaja  jsonb;
    v_escritas int := 0;
    v_borradas int := 0;
    v_n        int;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['staff_list', 'schedules'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO v_p FROM public.practicantes WHERE id = p_practicante_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRACTICANTE_NO_EXISTE'; END IF;
    IF v_p.employee_id IS NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'SIN_FICHA');
    END IF;

    -- Semana en curso en adelante (lunes, como `getLocalMonday`).
    v_lunes  := v_hoy - ((extract(isodow FROM v_hoy)::int) - 1);

    -- Sin patrón, sin fechas o ya no activo: se quitan sus semanas FUTURAS
    -- (las que todavía no empezaron) y no se escribe nada.
    IF v_p.horario IS NULL OR v_p.fecha_inicio IS NULL OR v_p.fecha_fin IS NULL
       OR coalesce(v_p.estado, 'ACTIVO') <> 'ACTIVO'
       OR jsonb_array_length(coalesce(v_p.horario->'dias', '[]'::jsonb)) = 0 THEN
        DELETE FROM public.employee_rosters
         WHERE employee_id = v_p.employee_id AND week_start_date > v_lunes;
        GET DIAGNOSTICS v_borradas = ROW_COUNT;
        RETURN json_build_object('ok', true, 'semanas', 0, 'quitadas', v_borradas);
    END IF;

    v_lunes  := greatest(v_lunes, v_p.fecha_inicio - ((extract(isodow FROM v_p.fecha_inicio)::int) - 1));
    v_ultimo := v_p.fecha_fin - ((extract(isodow FROM v_p.fecha_fin)::int) - 1);
    SELECT array_agg(x::int) INTO v_dias FROM jsonb_array_elements_text(v_p.horario->'dias') x;

    v_trabaja := jsonb_strip_nulls(jsonb_build_object(
        'customStart', v_p.horario->>'entrada',
        'customEnd',   v_p.horario->>'salida',
        'hasLunch',    coalesce((v_p.horario->>'pausa_minutos')::int, 0) > 0
                       AND nullif(v_p.horario->>'pausa_inicio', '') IS NOT NULL,
        'lunchStart',  nullif(v_p.horario->>'pausa_inicio', ''),
        'lunchMinutes', nullif((v_p.horario->>'pausa_minutos')::int, 0),
        'origen',      'practica'));

    WHILE v_lunes <= v_ultimo LOOP
        v_semana := '{}'::jsonb;
        FOR i IN 0..6 LOOP
            v_dia := v_lunes + i;
            v_semana := v_semana || jsonb_build_object(
                extract(dow FROM v_dia)::int::text,
                CASE WHEN extract(dow FROM v_dia)::int = ANY (v_dias)
                          AND v_dia BETWEEN v_p.fecha_inicio AND v_p.fecha_fin
                     THEN v_trabaja
                     ELSE jsonb_build_object('isOff', true, 'origen', 'practica') END);
        END LOOP;

        INSERT INTO public.employee_rosters (employee_id, week_start_date, schedule_data, status)
        VALUES (v_p.employee_id, v_lunes, v_semana, 'PUBLISHED')
        ON CONFLICT (employee_id, week_start_date) DO UPDATE
           SET schedule_data = EXCLUDED.schedule_data, status = 'PUBLISHED', updated_at = now()
         WHERE (public.employee_rosters.schedule_data, public.employee_rosters.status)
               IS DISTINCT FROM (EXCLUDED.schedule_data, EXCLUDED.status);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_escritas := v_escritas + v_n;
        v_lunes := v_lunes + 7;
    END LOOP;

    -- Si la práctica se acortó, las semanas que ya no le tocan se van.
    DELETE FROM public.employee_rosters
     WHERE employee_id = v_p.employee_id
       AND week_start_date > v_ultimo
       AND week_start_date > (v_hoy - ((extract(isodow FROM v_hoy)::int) - 1));
    GET DIAGNOSTICS v_borradas = ROW_COUNT;

    RETURN json_build_object('ok', true, 'semanas', v_escritas, 'quitadas', v_borradas);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aplicar_horario_de_practica(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_horario_de_practica(uuid) TO authenticated, service_role;
