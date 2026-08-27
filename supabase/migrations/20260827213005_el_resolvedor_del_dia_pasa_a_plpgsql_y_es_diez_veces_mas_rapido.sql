-- El resolvedor del día pasa a plpgsql, y es diez veces más rápido
--
-- `turno_del_dia` nació `LANGUAGE sql` con tres CTE y `SET search_path`. Esa
-- combinación la vuelve OPACA —no se inlinea— y además **replanifica su cuerpo
-- en cada llamada**, porque `LANGUAGE sql` no entra al caché de planes.
--
-- Medido sobre 1.000 llamadas con argumentos distintos (para que el
-- planificador no la pliegue por ser IMMUTABLE), descontando los 2,9 ms que
-- cuesta armar los `jsonb` de entrada:
--
--   | cuerpo             | 1.000 llamadas | por llamada |
--   |--------------------|---------------:|------------:|
--   | `LANGUAGE sql`     |       439 ms   |   0,44 ms   |
--   | `plpgsql`          |        45 ms   |   0,042 ms  |
--
-- Es la otra cara de la trampa 4 de CLAUDE.md: allá `LANGUAGE sql` + `SET` era
-- caro por nacer con plan genérico; acá es caro por replanificar. En los dos
-- casos la corrección es la misma —pasarla a `plpgsql`, que sí entra al
-- caché— y el cuerpo no cambia de significado.
--
-- Se enfrentaron las dos implementaciones sobre los 16 casos de
-- `tests/unit/turnoDelDia.test.js`: **iguales, 0 distintas.**
--
-- Y de paso sale del manifiesto `scripts/planes-genericos.json`: ya no es
-- `LANGUAGE sql`, así que la sección E del gate de velocidad deja de mirarla.

SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.turno_del_dia(jsonb, jsonb);

CREATE FUNCTION public.turno_del_dia(p_dia jsonb, p_turno jsonb DEFAULT NULL)
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

COMMENT ON FUNCTION public.turno_del_dia(jsonb, jsonb) IS
  'Resuelve UN día de employee_rosters.schedule_data. Gemelo de resolverTurnoDelDia en src/utils/turnoDelDia.js — los dos están anclados en tests/unit/turnoDelDia.test.js. No escribir una tercera copia.';

REVOKE EXECUTE ON FUNCTION public.turno_del_dia(jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turno_del_dia(jsonb, jsonb) TO authenticated, service_role;

-- El banco de pruebas de la medición se va.
DROP FUNCTION IF EXISTS public.zz_bench_plpgsql(jsonb, jsonb);
