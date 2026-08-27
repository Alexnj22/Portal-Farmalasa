-- El turno trae su pausa, y el día se resuelve en un solo sitio
--
-- Dos cosas que son la misma:
--
-- 1 · El CATÁLOGO guarda la pausa alimenticia de cada turno. Hasta hoy la pausa
--     se marcaba celda por celda y el editor sólo la aceptaba entre las 11:00 y
--     las 14:30 — una ventana fija escrita en un `.jsx`, sin fuente. El
--     reglamento interno (Art. 18) tiene pausas a las 12:00, 13:00, 18:00 y
--     19:00, todas de una hora: o sea que el editor rechazaba las pausas del
--     propio reglamento. Ahora el turno la declara, el día la hereda, y la
--     única regla es que caiga dentro de la jornada.
--
-- 2 · «¿Qué turno tiene hoy esta persona?» estaba respondida CUATRO veces con
--     cuatro reglas distintas, y dos estaban incompletas:
--
--     | quién leía                          | catálogo | horas propias | `isOff` ausente |
--     |-------------------------------------|----------|---------------|-----------------|
--     | `consolidate-timesheets` (planilla) | sí       | sí            | trabaja         |
--     | las 44 h de la pantalla             | sí       | sí            | trabaja         |
--     | `getTodayScheduleConfig` (kiosco)   | sí       | **NO**        | trabaja         |
--     | `empleados_en_turno()` (avisos)     | **NO**   | sí            | **LIBRE**       |
--
--     El kiosco exigía `shiftId`, así que un día guardado sólo con horas
--     propias —que la pantalla pinta «Manual» y cuenta en las 44 h— era día
--     libre para él: pedía autorización de supervisor para marcar y la
--     asistencia lo daba ausente. Y esta función exigía lo contrario
--     (`customStart` Y `customEnd`), así que un día asignado desde el catálogo
--     no existía para los avisos de sala.
--
--     Encima invertía el valor por defecto:
--     `coalesce((isOff)::boolean, true) = false` da por LIBRE al día que no
--     trae la clave, al revés de JavaScript, que es quien escribió el dato.
--     Es la misma regla que ya costó `get_traslados_por_recibir`.
--
--     Dos rastros lo habían anotado sin cerrarlo. `scripts/planes-genericos.json`
--     decía «DEVUELVE 0 FILAS incluso [en la sala con más gente] — posible
--     defecto aparte, verificar», y la migración del 17-ago,
--     «la cascada NUNCA encontró a nadie en turno, ni una vez».
--
-- El gemelo de JavaScript es `src/utils/turnoDelDia.js`; los dos están anclados
-- sobre los mismos casos en `tests/unit/turnoDelDia.test.js`.

SET lock_timeout = '5s';

-- ── 1 · La pausa del turno ───────────────────────────────────────────────────
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS lunch_start   time,
  ADD COLUMN IF NOT EXISTS lunch_minutes integer NOT NULL DEFAULT 60;

COMMENT ON COLUMN public.shifts.lunch_start IS
  'Hora de la pausa alimenticia de este turno. NULL = el turno no la tiene. El día del horario la hereda al asignarse y puede moverla.';
COMMENT ON COLUMN public.shifts.lunch_minutes IS
  'Cuánto dura la pausa. Todas las del reglamento interno duran una hora; la columna existe para no volver a escribir el 60 en cuatro archivos.';

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_pausa_dentro_de_la_jornada;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_pausa_dentro_de_la_jornada CHECK (
    lunch_start IS NULL
    -- La jornada que cruza la medianoche no se puede acotar con una simple
    -- comparación de `time`, así que sólo se exige el encierro cuando NO cruza.
    OR end_time <= start_time
    OR (lunch_start >= start_time AND lunch_start < end_time)
  );

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_pausa_no_negativa;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_pausa_no_negativa CHECK (lunch_minutes >= 0 AND lunch_minutes <= 240);


-- ── 2 · La verdad de JavaScript, escrita una vez ─────────────────────────────
-- Ausente, `null`, `false`, `0` y la cadena vacía son todos FALSOS. Es la
-- traducción literal de lo que decide el navegador, que es quien escribió el
-- `jsonb`. Escribirlo al revés es lo que hacía invisible al día.
CREATE OR REPLACE FUNCTION public.jsonb_es_verdadero(v jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $fn$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN false
    WHEN jsonb_typeof(v) = 'boolean' THEN (v #>> '{}')::boolean
    WHEN jsonb_typeof(v) = 'number'  THEN (v #>> '{}')::numeric <> 0
    WHEN jsonb_typeof(v) = 'string'  THEN (v #>> '{}') <> ''
    ELSE true
  END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.jsonb_es_verdadero(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.jsonb_es_verdadero(jsonb) TO authenticated, service_role;


-- ── 3 · El resolvedor ────────────────────────────────────────────────────────
-- `p_turno` es la fila de `shifts` ya resuelta por quien llama, como `jsonb`.
-- Devuelve lo mismo que `resolverTurnoDelDia` de JavaScript.
CREATE OR REPLACE FUNCTION public.turno_del_dia(p_dia jsonb, p_turno jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $fn$
  WITH base AS (
    SELECT
      CASE WHEN jsonb_typeof(p_dia)   = 'object' THEN p_dia   END AS dia,
      CASE WHEN jsonb_typeof(p_turno) = 'object' THEN p_turno END AS turno
  ),
  horas AS (
    SELECT
      b.dia,
      b.turno,
      nullif(coalesce(
        b.dia ->> 'customStart',
        left(coalesce(b.turno ->> 'start_time', b.turno ->> 'start'), 5)
      ), '') AS inicio,
      nullif(coalesce(
        b.dia ->> 'customEnd',
        left(coalesce(b.turno ->> 'end_time', b.turno ->> 'end'), 5)
      ), '') AS fin
    FROM base b
    WHERE b.dia IS NOT NULL
      AND NOT public.jsonb_es_verdadero(b.dia -> 'isOff')
      AND NOT public.jsonb_es_verdadero(b.dia -> 'isOffDay')
  ),
  minutos AS (
    SELECT
      h.inicio, h.fin,
      (split_part(h.inicio, ':', 1)::int * 60 + split_part(h.inicio, ':', 2)::int) AS i,
      (split_part(h.fin,    ':', 1)::int * 60 + split_part(h.fin,    ':', 2)::int) AS f0,
      CASE WHEN public.jsonb_es_verdadero(h.dia -> 'hasLunch')
             AND coalesce(h.dia ->> 'lunchStart', left(h.turno ->> 'lunch_start', 5)) IS NOT NULL
           THEN coalesce(
                  (h.dia ->> 'lunchMinutes')::int,
                  (h.turno ->> 'lunch_minutes')::int,
                  60)
           ELSE 0 END AS pausa,
      CASE WHEN public.jsonb_es_verdadero(h.dia -> 'hasLunch')
           THEN nullif(coalesce(h.dia ->> 'lunchStart', left(h.turno ->> 'lunch_start', 5)), '')
           END AS pausa_inicio
    FROM horas h
    WHERE h.inicio ~ '^[0-9]{1,2}:[0-9]{2}$' AND h.fin ~ '^[0-9]{1,2}:[0-9]{2}$'
  )
  SELECT coalesce(
    (SELECT jsonb_build_object(
        'trabaja',         true,
        'inicio',          m.inicio,
        'fin',             m.fin,
        'cruza',           m.f0 < m.i,
        'pausa_inicio',    m.pausa_inicio,
        'minutos_brutos',  (CASE WHEN m.f0 < m.i THEN m.f0 + 1440 ELSE m.f0 END) - m.i,
        'minutos_pagados', (CASE WHEN m.f0 < m.i THEN m.f0 + 1440 ELSE m.f0 END) - m.i - m.pausa
     )
     FROM minutos m
     WHERE m.f0 <> m.i),                         -- entrada = salida no es jornada
    jsonb_build_object('trabaja', false)
  );
$fn$;

COMMENT ON FUNCTION public.turno_del_dia(jsonb, jsonb) IS
  'Resuelve UN día de employee_rosters.schedule_data. Gemelo de resolverTurnoDelDia en src/utils/turnoDelDia.js — los dos están anclados en tests/unit/turnoDelDia.test.js. No escribir una tercera copia.';

REVOKE EXECUTE ON FUNCTION public.turno_del_dia(jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turno_del_dia(jsonb, jsonb) TO authenticated, service_role;


-- ── 4 · Quién está trabajando ahora en una sala ──────────────────────────────
-- Pasa de `LANGUAGE sql` a `plpgsql` y estrena dos cosas que le faltaban:
--   · resuelve el día con `turno_del_dia`, así que ve tanto el turno del
--     catálogo como las horas propias;
--   · mira la COBERTURA. Quien viene de otra sala a cubrir acá está trabajando
--     acá, y quien se fue a cubrir a otra no está. La tabla existe justo para
--     eso y nadie la consultaba.
DROP FUNCTION IF EXISTS public.empleados_en_turno(integer);

CREATE FUNCTION public.empleados_en_turno(p_branch_id integer)
RETURNS TABLE(employee_id uuid)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $fn$
DECLARE
  v_semana  date      := (date_trunc('week', (now() AT TIME ZONE 'America/El_Salvador')))::date;
  v_dia     text      := extract(dow from (now() AT TIME ZONE 'America/El_Salvador'))::integer::text;
  v_hora    text      := to_char((now() AT TIME ZONE 'America/El_Salvador'), 'HH24:MI');
BEGIN
  RETURN QUERY
  WITH turnos AS (
    SELECT s.id, to_jsonb(s) AS j FROM public.shifts s
  ),
  -- Los de la casa, menos los que hoy fueron a cubrir a otra sala.
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
  -- Y los de afuera que hoy cubren acá.
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
        END;
END;
$fn$;

COMMENT ON FUNCTION public.empleados_en_turno(integer) IS
  'Quién está trabajando AHORA en una sala, contando la cobertura de otras salas. La usan avisar_facturas_de_sala, notificar_resolucion_envio y notificar_resolucion_traslado.';

REVOKE EXECUTE ON FUNCTION public.empleados_en_turno(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.empleados_en_turno(integer) TO authenticated, service_role;


-- ── 5 · `estoy_en_turno` se va ───────────────────────────────────────────────
-- SECURITY DEFINER y sin un solo llamador: ni una policy ni una función la
-- referencian en producción. Quedó huérfana el 17-ago, cuando el traslado dejó
-- de decidirse por horario. Una función con privilegios y sin dueño se borra.
DROP FUNCTION IF EXISTS public.estoy_en_turno();
