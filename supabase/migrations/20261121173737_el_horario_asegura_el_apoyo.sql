SET lock_timeout = '5s';

-- El apoyo se escribía dos veces y quedaba a medias (auditoría 2026-11-21).
--   · Personal → `employee_events` SUPPORT: le da a la persona la sucursal (y,
--     si se elige, el cargo) al entrar al portal (`sala_de_apoyo_vigente`,
--     `cargo_de_apoyo_vigente`).
--   · Horarios → `schedule_coverage`: dónde y a qué hora trabaja ese día
--     (`empleados_en_turno`, kiosco).
-- Daniela quedó de apoyo en Salud 3 en el horario y, sin el evento, entraba al
-- portal como Salud 1 y no podía usar la caja de Salud 3.
--
-- Ahora el horario asegura el apoyo: por persona, sucursal y semana hay a lo
-- sumo UN evento automático (`metadata.origen = 'horario'`) con los días de
-- cobertura que no cubre ya un apoyo puesto a mano en Personal. El de Personal
-- manda (puede traer cargo); el automático conserva el cargo propio. Quitar la
-- cobertura quita el día del automático, nunca toca uno puesto a mano.

CREATE OR REPLACE FUNCTION public.sincronizar_apoyo_del_horario(p_employee_id uuid, p_branch_id bigint, p_semana date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_dias   date[];
  v_nombre text;
BEGIN
  -- Los días de cobertura de esa semana que NO cubre ya un apoyo puesto a mano
  -- hacia la misma sucursal.
  SELECT array_agg(d ORDER BY d) INTO v_dias
    FROM (
      SELECT (sc.week_start_date + ((sc.day_of_week + 6) % 7))::date AS d
        FROM public.schedule_coverage sc
       WHERE sc.employee_id = p_employee_id
         AND sc.coverage_branch_id = p_branch_id
         AND sc.week_start_date = p_semana
    ) c
   WHERE NOT EXISTS (
      SELECT 1
        FROM public.employee_events ev,
             jsonb_array_elements(CASE WHEN jsonb_typeof(ev.metadata->'supportRanges') = 'array'
                                       THEN ev.metadata->'supportRanges' ELSE '[]'::jsonb END) r
       WHERE ev.employee_id = p_employee_id
         AND ev.type = 'SUPPORT'
         AND coalesce(ev.metadata->>'origen', '') <> 'horario'
         AND coalesce(ev.metadata->>'status', '') NOT IN ('CANCELLED', 'SUPERSEDED')
         AND ev.metadata->>'targetBranchId' = p_branch_id::text
         AND coalesce(r->>'start', '') ~ '^\d{4}-\d{2}-\d{2}$'
         AND coalesce(r->>'end',   '') ~ '^\d{4}-\d{2}-\d{2}$'
         AND c.d BETWEEN (r->>'start')::date AND (r->>'end')::date
   );

  DELETE FROM public.employee_events ev
   WHERE ev.employee_id = p_employee_id
     AND ev.type = 'SUPPORT'
     AND ev.metadata->>'origen' = 'horario'
     AND ev.metadata->>'semana' = p_semana::text
     AND ev.metadata->>'targetBranchId' = p_branch_id::text;

  IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT b.name INTO v_nombre FROM public.branches b WHERE b.id = p_branch_id;

  INSERT INTO public.employee_events (employee_id, type, date, note, metadata)
  VALUES (
    p_employee_id, 'SUPPORT', v_dias[1], 'Apoyo del horario.',
    jsonb_build_object(
      'type', 'SUPPORT', 'origen', 'horario', 'semana', p_semana::text,
      'date', v_dias[1]::text, 'endDate', v_dias[array_length(v_dias, 1)]::text,
      'employeeId', p_employee_id::text, 'note', 'Apoyo del horario.',
      'targetBranchId', p_branch_id::text, 'targetBranchName', v_nombre,
      'hasConflict', false, 'permissionDates', NULL,
      'supportRanges', (SELECT jsonb_agg(jsonb_build_object('start', d::text, 'end', d::text) ORDER BY d)
                          FROM unnest(v_dias) d)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sincronizar_apoyo_del_horario(uuid, bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_apoyo_del_horario(uuid, bigint, date) TO service_role;

CREATE OR REPLACE FUNCTION public.cobertura_asegura_apoyo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.sincronizar_apoyo_del_horario(OLD.employee_id, OLD.coverage_branch_id, OLD.week_start_date);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.sincronizar_apoyo_del_horario(NEW.employee_id, NEW.coverage_branch_id, NEW.week_start_date);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cobertura_asegura_apoyo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cobertura_asegura_apoyo ON public.schedule_coverage;
CREATE TRIGGER trg_cobertura_asegura_apoyo
  AFTER INSERT OR UPDATE OR DELETE ON public.schedule_coverage
  FOR EACH ROW EXECUTE FUNCTION public.cobertura_asegura_apoyo();

-- Lo que ya hay: una pasada por cada persona, sucursal y semana con cobertura.
SELECT public.sincronizar_apoyo_del_horario(x.employee_id, x.coverage_branch_id, x.week_start_date)
  FROM (SELECT DISTINCT employee_id, coverage_branch_id, week_start_date FROM public.schedule_coverage) x;
