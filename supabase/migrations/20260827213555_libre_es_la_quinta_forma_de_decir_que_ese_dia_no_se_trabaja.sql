-- «LIBRE» es la quinta forma de decir que ese día no se trabaja
--
-- Tres sitios escriben `{"shiftId": "LIBRE", "note": "…"}` en el horario:
-- marcar una incapacidad, marcar vacaciones, y el regreso anticipado de
-- vacaciones. La convención sólo estaba escrita en un sitio más
-- —`consolidate-timesheets`, con un `dayData.shiftId !== 'LIBRE'` a mano— y en
-- ningún otro.
--
-- Funcionaba de casualidad: ningún turno del catálogo tiene ese id, la búsqueda
-- no encuentra nada, el día se queda sin horas y sale como libre. Pero de
-- casualidad no es lo mismo que a propósito, y con seis nombres para lo mismo
-- («isOff», «isOffDay», el turno ausente, las horas ausentes, «LIBRE» y la
-- clave del día que falta) el próximo que lea esto no tiene cómo saberlo.
--
-- Queda dicho en el resolvedor, del mismo lado que su gemelo de JavaScript.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.turno_del_dia(p_dia jsonb, p_turno jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions
AS $fn$
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

  -- La verdad de JavaScript: ausente, null, false, 0 y "" son todos falsos.
  IF public.jsonb_es_verdadero(p_dia -> 'isOff')
     OR public.jsonb_es_verdadero(p_dia -> 'isOffDay') THEN
    RETURN jsonb_build_object('trabaja', false);
  END IF;

  -- La quinta forma. Ver el encabezado.
  IF upper(coalesce(p_dia ->> 'shiftId', p_dia ->> 'shift_id', '')) = 'LIBRE' THEN
    RETURN jsonb_build_object('trabaja', false);
  END IF;

  -- Las horas propias del día mandan sobre las del catálogo.
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
  IF v_f = v_i THEN                       -- entrada = salida no es una jornada
    RETURN jsonb_build_object('trabaja', false);
  END IF;

  -- La pausa: manda `hasLunch` del día; la hora y la duración salen del día y,
  -- si no las trae, del turno del catálogo.
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
    'minutos_brutos',  (CASE WHEN v_f < v_i THEN v_f + 1440 ELSE v_f END) - v_i,
    'minutos_pagados', (CASE WHEN v_f < v_i THEN v_f + 1440 ELSE v_f END) - v_i - v_pausa
  );
END;
$fn$;
