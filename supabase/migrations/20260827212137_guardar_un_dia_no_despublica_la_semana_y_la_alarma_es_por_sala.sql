-- Guardar un día no despublica la semana, y la alarma es por sala
--
-- ── 1 · Lo que se rompía al corregir ─────────────────────────────────────────
-- El navegador guardaba cada celda con un upsert que mandaba
-- `status: 'DRAFT'` y el ROSTER ENTERO. Dos consecuencias, y las dos callan:
--
--   · Corregir un día de una semana YA PUBLICADA la devolvía a borrador. Y el
--     botón de publicar quedaba `disabled` en cuanto la semana figuraba
--     publicada, con `onClick: undefined`. Como `consolidate-timesheets` sólo
--     lee los `PUBLISHED`, esas horas NO llegaban a planilla — y la pantalla
--     mientras tanto decía «Publicado».
--   · Mandaba el objeto completo, así que dos personas editando días
--     DISTINTOS de la misma persona se pisaban: ganaba la última en guardar.
--
-- `guardar_dia_de_horario` escribe UN día con `||` sobre el `jsonb` y **no
-- toca `status`**: lo que estaba en borrador sigue en borrador, y lo publicado
-- sigue publicado con el dato corregido. Es INVOKER a propósito: el alcance por
-- sala lo decide el RLS de `employee_rosters`, que ya lo tiene escrito.
--
-- ── 2 · La alarma que no podía sonar ─────────────────────────────────────────
-- `notify_missing_roster` contaba filas de la semana EN TODA LA EMPRESA:
-- un solo horario de una sola sala apagaba el aviso para las seis. Y encima
-- corría a las 15:00 UTC del sábado, después de que la copia automática de las
-- 06:00 ya hubiera insertado filas — así que el contador nunca era cero y el
-- aviso no podía dispararse NUNCA. (El cron duplicado se apaga en la migración
-- siguiente.)
--
-- Ahora cuenta PERSONAS SIN HORARIO por sala, y nombra las salas que faltan.
-- Sólo mira a quien está en planilla: `tipo_ficha` saca a las cuentas del
-- sistema y a los servicios externos, que no tienen turno que cubrir.

SET lock_timeout = '5s';

-- ── Guardar un día ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardar_dia_de_horario(
  p_employee_id uuid,
  p_week_start  date,
  p_dia         text,
  p_datos       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_estado text;
BEGIN
  IF p_dia !~ '^[0-6]$' THEN
    RAISE EXCEPTION 'El día tiene que ser "0".."6" (domingo es 0), y llegó %', p_dia
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.employee_rosters (employee_id, week_start_date, schedule_data, status)
  VALUES (p_employee_id, p_week_start, jsonb_build_object(p_dia, p_datos), 'DRAFT')
  ON CONFLICT (employee_id, week_start_date) DO UPDATE
     SET schedule_data = public.employee_rosters.schedule_data || jsonb_build_object(p_dia, p_datos),
         updated_at    = now()
     -- `status` NO se toca a propósito. Ver el encabezado.
  RETURNING status INTO v_estado;

  RETURN jsonb_build_object('estado', v_estado);
END;
$fn$;

COMMENT ON FUNCTION public.guardar_dia_de_horario(uuid, date, text, jsonb) IS
  'Escribe UN día del horario semanal sin tocar el estado de publicación ni pisar los otros días. INVOKER: el alcance por sala lo decide el RLS.';

REVOKE EXECUTE ON FUNCTION public.guardar_dia_de_horario(uuid, date, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardar_dia_de_horario(uuid, date, text, jsonb) TO authenticated, service_role;


-- ── Publicar una sala ────────────────────────────────────────────────────────
-- Antes el navegador bajaba los identificadores de la sala y mandaba un
-- `.in(...)`. Acá el filtro se escribe donde está el dato, así que no depende
-- de cuántas personas quepan en una URL, y devuelve CUÁNTAS publicó — que es lo
-- que la pantalla necesita para dejar de mentir con un booleano.
CREATE OR REPLACE FUNCTION public.publicar_horarios_de_sala(
  p_week_start date,
  p_branch_id  bigint
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
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
       AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
    RETURNING 1
  )
  SELECT count(*) INTO v_cuantos FROM publicadas;
  RETURN v_cuantos;
END;
$fn$;

COMMENT ON FUNCTION public.publicar_horarios_de_sala(date, bigint) IS
  'Publica los horarios en borrador de una sala y devuelve cuántos. Repetible: lo ya publicado no se toca.';

REVOKE EXECUTE ON FUNCTION public.publicar_horarios_de_sala(date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.publicar_horarios_de_sala(date, bigint) TO authenticated, service_role;


-- ── Leer la semana de UNA sala ───────────────────────────────────────────────
-- `select('*').eq('week_start_date', …)` bajaba los horarios de las OCHO salas
-- para pintar una, con el `jsonb` completo de cada persona. Y el efecto que la
-- llamaba tenía la sala en sus dependencias, así que cambiar de sala volvía a
-- bajar exactamente lo mismo.
CREATE OR REPLACE FUNCTION public.horarios_de_la_semana(
  p_week_start date,
  p_branch_id  bigint
)
RETURNS json
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $fn$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT r.employee_id, r.schedule_data, r.status, r.updated_at
    FROM public.employee_rosters r
    JOIN public.employees e ON e.id = r.employee_id
    WHERE r.week_start_date = p_week_start
      AND e.branch_id = p_branch_id
  ) t;
$fn$;

COMMENT ON FUNCTION public.horarios_de_la_semana(date, bigint) IS
  'Los horarios de UNA sala en UNA semana. INVOKER: el RLS de employee_rosters sigue decidiendo qué se ve.';

REVOKE EXECUTE ON FUNCTION public.horarios_de_la_semana(date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.horarios_de_la_semana(date, bigint) TO authenticated, service_role;


-- ── La alarma del sábado, por sala ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_missing_roster()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_lunes      date := CURRENT_DATE + 2;
  v_detalle    text;
  v_total      integer;
  v_th_ids     text[];
  v_tipo       text;
  v_valor      jsonb;
BEGIN
  -- Personas EN PLANILLA sin horario para la semana entrante, agrupadas por
  -- sala. Antes esto era un `count(*)` sobre toda la empresa, así que un solo
  -- horario cargado en cualquier sala apagaba el aviso para todas.
  SELECT string_agg(x.linea, E'\n' ORDER BY x.sala),
         sum(x.faltan)
    INTO v_detalle, v_total
  FROM (
    SELECT b.name AS sala,
           count(*) FILTER (WHERE r.id IS NULL) AS faltan,
           '• ' || b.name || ': ' || count(*) FILTER (WHERE r.id IS NULL) ||
             ' de ' || count(*) || ' sin horario' AS linea
    FROM public.branches b
    JOIN public.employees e
      ON e.branch_id = b.id
     AND e.status = 'ACTIVO'
     AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
    LEFT JOIN public.employee_rosters r
      ON r.employee_id = e.id
     AND r.week_start_date = v_lunes
    GROUP BY b.id, b.name
    HAVING count(*) FILTER (WHERE r.id IS NULL) > 0
  ) x;

  IF v_total IS NULL OR v_total = 0 THEN RETURN; END IF;

  SELECT ARRAY_AGG(id::text) INTO v_th_ids
  FROM public.employees
  WHERE role_id = 11 AND status = 'ACTIVO';

  IF v_th_ids IS NOT NULL AND array_length(v_th_ids, 1) > 0 THEN
    v_tipo  := 'EMPLOYEE';
    v_valor := to_jsonb(v_th_ids);
  ELSE
    v_tipo  := 'ALL';
    v_valor := NULL;
  END IF;

  INSERT INTO public.announcements
    (title, message, target_type, target_value, read_by, is_archived, priority, metadata)
  VALUES (
    'Faltan horarios para la semana del ' || to_char(v_lunes, 'DD/MM/YYYY'),
    v_total || ' persona(s) todavía no tienen horario para esa semana:' || E'\n\n' ||
      v_detalle || E'\n\n' ||
      'Si no se cargan antes del lunes, el reloj de la sala usa el horario de la semana anterior.',
    v_tipo, v_valor, '[]'::jsonb, false, 'HIGH',
    jsonb_build_object(
      'source',          'cron-roster-check',
      'next_week_start', v_lunes::text,
      'faltan',          v_total,
      'triggered_at',    now()::text
    )
  );
END;
$fn$;

COMMENT ON FUNCTION public.notify_missing_roster() IS
  'Aviso del sábado: cuenta PERSONAS sin horario por sala y las nombra. Antes contaba filas de toda la empresa, así que un solo horario apagaba el aviso para las seis salas.';

REVOKE EXECUTE ON FUNCTION public.notify_missing_roster() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.notify_missing_roster() TO service_role;
