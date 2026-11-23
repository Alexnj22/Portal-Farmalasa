SET lock_timeout = '5s';

-- 2026-11-21, decisión del usuario: Administración (sucursal 32) todavía no
-- lleva horario, así que sale de la alerta «Faltan horarios» POR AHORA. Cuando
-- se le carguen horarios, quitar el `b.id <> 32`. Anotado en memoria
-- `project_administracion_fuera_de_alerta_de_horarios`.
CREATE OR REPLACE FUNCTION public.notify_missing_roster()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lunes      date := CURRENT_DATE + 2;
  v_detalle    text;
  v_total      integer;
  v_th_ids     uuid[];
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
    WHERE b.id <> 32  -- Administración: sin horario por ahora (2026-11-21)
    GROUP BY b.id, b.name
    HAVING count(*) FILTER (WHERE r.id IS NULL) > 0
  ) x;

  IF v_total IS NULL OR v_total = 0 THEN RETURN; END IF;

  SELECT ARRAY_AGG(id) INTO v_th_ids
  FROM public.employees
  WHERE role_id = 11 AND status = 'ACTIVO';

  IF v_th_ids IS NULL THEN RETURN; END IF;

  PERFORM public.notify_employees(
    v_th_ids,
    'SYSTEM',
    'Faltan horarios para la semana del ' || to_char(v_lunes, 'DD/MM/YYYY'),
    v_total || ' persona(s) todavía no tienen horario para esa semana:' || E'\n\n' ||
      v_detalle || E'\n\n' ||
      'Si no se cargan antes del lunes, el reloj de la sucursal usa el horario de la semana anterior.',
    '/horarios',
    jsonb_build_object('source', 'cron-roster-check', 'next_week_start', v_lunes::text,
                       'faltan', v_total, 'triggered_at', now()::text),
    true);
END;
$function$;
