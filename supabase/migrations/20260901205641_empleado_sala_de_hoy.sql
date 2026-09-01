-- ¿En qué sala trabaja hoy esta persona?
--
-- Existe para el día que los horarios digan la sucursal del día. **Hoy no la
-- dicen**: medido el 2026-09-01, `employee_rosters` está en cero filas y no
-- tiene columna de sucursal — el módulo de horarios nunca contempló que alguien
-- trabaje en otra sala. Así que hoy esta función contesta siempre con la
-- sucursal de la ficha, y el día que un roster traiga la del día, contesta ésa
-- **sin que haya que tocar nada más**.
--
-- ── EL CONTRATO, para quien construya el apoyo en horarios ──────────────────
-- El día de `schedule_data` puede traer la sucursal en cualquiera de estas
-- cuatro claves, y se leen en este orden:
--
--     branchId · branch_id · sucursalId · sucursal_id
--
-- Cuatro y no una porque el módulo ya mezcla las dos convenciones —`shiftId` y
-- `shift_id`, `customStart` y `lunch_start` conviven en el mismo objeto— y
-- elegir una sola garantiza que el día que alguien escriba la otra, esto
-- devuelva la sucursal equivocada **en silencio**.
--
-- ── Sólo cuenta un horario PUBLICADO ────────────────────────────────────────
-- Un borrador es una idea, y mandar un papel a otra sala por una idea es
-- exactamente el error que esta función existe para evitar. Es el mismo
-- criterio de `consolidate-timesheets`, que sólo lee los publicados.
--
-- ── Y la sucursal tiene que EXISTIR ─────────────────────────────────────────
-- Un id que no está en `branches` no es «otra sala», es basura: se ignora y se
-- cae al respaldo. Sin esa comprobación, un dedazo en el editor de horarios
-- mandaría el papel a ninguna parte y nadie sabría por qué.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.empleado_sala_de_hoy(
  p_employee_id uuid DEFAULT NULL,
  p_fecha date DEFAULT current_date
) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp  uuid := coalesce(p_employee_id, (SELECT public.auth_employee_id()));
  v_dia  jsonb;
  v_sala bigint;
BEGIN
  IF v_emp IS NULL THEN RETURN NULL; END IF;

  -- El día dentro de la semana publicada. `extract(dow)` da 0=domingo, igual
  -- que el `getDay()` de JavaScript con el que se escribió la clave.
  SELECT r.schedule_data -> (extract(dow FROM p_fecha)::int::text)
    INTO v_dia
    FROM public.employee_rosters r
   WHERE r.employee_id = v_emp
     AND r.status = 'PUBLISHED'
     AND p_fecha >= r.week_start_date
     AND p_fecha <  r.week_start_date + 7
   ORDER BY r.week_start_date DESC
   LIMIT 1;

  IF v_dia IS NOT NULL AND jsonb_typeof(v_dia) = 'object' THEN
    BEGIN
      v_sala := nullif(coalesce(
        v_dia ->> 'branchId', v_dia ->> 'branch_id',
        v_dia ->> 'sucursalId', v_dia ->> 'sucursal_id'), '')::bigint;
    EXCEPTION WHEN others THEN
      -- Un valor que no es un número no tumba la consulta: se ignora y se cae
      -- al respaldo, que es lo que hace esta función confiable de entrada.
      v_sala := NULL;
    END;
    IF v_sala IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = v_sala) THEN
      RETURN v_sala;
    END IF;
  END IF;

  -- El respaldo: la sucursal de la ficha.
  RETURN (SELECT e.branch_id FROM public.employees e WHERE e.id = v_emp);
END;
$$;

COMMENT ON FUNCTION public.empleado_sala_de_hoy(uuid, date) IS
  'La sala donde alguien trabaja HOY: la del horario publicado del día si la trae, y si no la de su ficha. Hoy los horarios no la traen — existe para que el día que la traigan, no haya que tocar a quien la consulta.';

REVOKE EXECUTE ON FUNCTION public.empleado_sala_de_hoy(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.empleado_sala_de_hoy(uuid, date) TO authenticated, service_role;
