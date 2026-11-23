-- La pausa del día, de cualquier duración (2026-11-23).
--
-- La jornada partida («7 a 12 y de 4 a 7») se guarda como una jornada de 7 a 19
-- con una pausa de 240 min (`lunchMinutes`). Tres cosas para que la base la
-- trate como lo dice el horario:
--
--   1. `turno_del_dia` devuelve también `pausa_minutos` (su gemelo de JS ya
--      tenía `pausa.minutos`). Nada más cambia: mismo cuerpo, una clave más.
--   2. `empleados_en_turno` deja fuera a quien está en su pausa: durante esas
--      4 h la persona no está en la sucursal y no le tocan los avisos de sala.
--   3. `timesheets.status` admite 'INCOMPLETE' («marcación incompleta»): quien
--      olvidó la entrada pero tiene otras marcas ya no sale ausente con el día
--      descontado; queda para que Talento Humano lo revise.
--
-- Las dos funciones parten de su definición VIVA (pg_get_functiondef, md5
-- igual en producción y en el branch de pruebas).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.hora_en_pausa(p_hora text, p_turno jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_min int := coalesce((p_turno ->> 'pausa_minutos')::int, 0);
  v_ini time;
  v_fin time;
  v_h   time;
BEGIN
  IF p_turno ->> 'pausa_inicio' IS NULL OR v_min <= 0 OR p_hora IS NULL THEN
    RETURN false;
  END IF;
  IF v_min >= 1440 THEN
    RETURN true;
  END IF;
  v_ini := (p_turno ->> 'pausa_inicio')::time;
  v_fin := v_ini + make_interval(mins => v_min);
  v_h   := p_hora::time;
  IF v_fin > v_ini THEN
    RETURN v_h >= v_ini AND v_h < v_fin;
  END IF;
  RETURN v_h >= v_ini OR v_h < v_fin;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.hora_en_pausa(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_en_pausa(text, jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.turno_del_dia(p_dia jsonb, p_turno jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ini   text;
  v_fin   text;
  v_i     integer;
  v_f     integer;
  v_pausa integer := 0;
  v_ph    text;
BEGIN
  IF p_dia IS NULL OR jsonb_typeof(p_dia) <> 'object' THEN
    RETURN jsonb_build_object('trabaja', false);
  END IF;

  IF public.jsonb_es_verdadero(p_dia -> 'isOff')
     OR public.jsonb_es_verdadero(p_dia -> 'isOffDay') THEN
    RETURN jsonb_build_object('trabaja', false);
  END IF;

  IF upper(coalesce(p_dia ->> 'shiftId', p_dia ->> 'shift_id', '')) = 'LIBRE' THEN
    RETURN jsonb_build_object('trabaja', false);
  END IF;

  v_ini := nullif(coalesce(p_dia ->> 'customStart',
                           left(coalesce(p_turno ->> 'start_time', p_turno ->> 'start'), 5)), '');
  v_fin := nullif(coalesce(p_dia ->> 'customEnd',
                           left(coalesce(p_turno ->> 'end_time',   p_turno ->> 'end'),   5)), '');
  IF v_ini IS NULL OR v_fin IS NULL THEN
    RETURN jsonb_build_object('trabaja', false);
  END IF;
  IF v_ini !~ '^[0-9]{1,2}:[0-9]{2}$' OR v_fin !~ '^[0-9]{1,2}:[0-9]{2}$' THEN
    RETURN jsonb_build_object('trabaja', false);
  END IF;

  v_i := split_part(v_ini, ':', 1)::int * 60 + split_part(v_ini, ':', 2)::int;
  v_f := split_part(v_fin, ':', 1)::int * 60 + split_part(v_fin, ':', 2)::int;
  IF v_f = v_i THEN
    RETURN jsonb_build_object('trabaja', false);
  END IF;

  IF public.jsonb_es_verdadero(p_dia -> 'hasLunch') THEN
    v_ph := nullif(coalesce(p_dia ->> 'lunchStart', left(p_turno ->> 'lunch_start', 5)), '');
    IF v_ph IS NOT NULL THEN
      v_pausa := coalesce((p_dia ->> 'lunchMinutes')::int, (p_turno ->> 'lunch_minutes')::int, 60);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'trabaja',         true,
    'inicio',          v_ini,
    'fin',             v_fin,
    'cruza',           v_f < v_i,
    'pausa_inicio',    v_ph,
    'pausa_minutos',   CASE WHEN v_ph IS NULL THEN NULL ELSE v_pausa END,
    'minutos_brutos',  (CASE WHEN v_f < v_i THEN v_f + 1440 ELSE v_f END) - v_i,
    'minutos_pagados', (CASE WHEN v_f < v_i THEN v_f + 1440 ELSE v_f END) - v_i - v_pausa
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.empleados_en_turno(p_branch_id integer)
 RETURNS TABLE(employee_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_semana  date := (date_trunc('week', (now() AT TIME ZONE 'America/El_Salvador')))::date;
  v_dia     text := extract(dow from (now() AT TIME ZONE 'America/El_Salvador'))::integer::text;
  v_hora    text := to_char((now() AT TIME ZONE 'America/El_Salvador'), 'HH24:MI');
BEGIN
  RETURN QUERY
  WITH turnos AS (
    SELECT s.id, to_jsonb(s) AS j FROM public.shifts s
  ),
  propios AS (
    SELECT e.id AS emp, r.schedule_data -> v_dia AS dia
    FROM public.employees e
    JOIN public.employee_rosters r
      ON r.employee_id = e.id
     AND r.week_start_date = v_semana
     AND r.status = 'PUBLISHED'
    WHERE e.branch_id = p_branch_id
      AND e.status = 'ACTIVO'
      AND NOT EXISTS (
        SELECT 1 FROM public.schedule_coverage c
        WHERE c.employee_id = e.id
          AND c.week_start_date = v_semana
          AND c.day_of_week = v_dia::integer
          AND c.coverage_branch_id <> p_branch_id
      )
  ),
  cobertura AS (
    SELECT c.employee_id AS emp, c.schedule_data AS dia
    FROM public.schedule_coverage c
    JOIN public.employees e ON e.id = c.employee_id AND e.status = 'ACTIVO'
    WHERE c.coverage_branch_id = p_branch_id
      AND c.week_start_date = v_semana
      AND c.day_of_week = v_dia::integer
  ),
  todos AS (
    SELECT * FROM propios UNION ALL SELECT * FROM cobertura
  ),
  resuelto AS (
    SELECT t.emp,
           public.turno_del_dia(
             t.dia,
             (SELECT tu.j FROM turnos tu WHERE tu.id::text = coalesce(t.dia ->> 'shiftId', t.dia ->> 'shift_id'))
           ) AS r
    FROM todos t
  )
  SELECT DISTINCT x.emp
  FROM resuelto x
  WHERE (x.r ->> 'trabaja')::boolean
    AND CASE
          WHEN NOT (x.r ->> 'cruza')::boolean
            THEN v_hora >= (x.r ->> 'inicio') AND v_hora < (x.r ->> 'fin')
          ELSE v_hora >= (x.r ->> 'inicio') OR  v_hora < (x.r ->> 'fin')
        END
    AND NOT public.hora_en_pausa(v_hora, x.r);
END;
$function$;

ALTER TABLE public.timesheets DROP CONSTRAINT timesheets_status_check;
ALTER TABLE public.timesheets ADD CONSTRAINT timesheets_status_check
  CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'DISPUTED'::text,
                             'AUTO_PUNCHED'::text, 'INCOMPLETE'::text]));
