-- Min/Max — ruteo de notificación de solicitudes.
-- Devuelve a quién notificar: Supervisor/a de Ventas activos y NO de
-- vacaciones/incapacidad/permiso hoy; si ninguno disponible, su jefe inmediato
-- (rol padre vía roles.parent_role_id).
CREATE OR REPLACE FUNCTION public.get_minmax_approver_ids()
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sup_role    int;
  v_parent_role int;
  v_today       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids         uuid[];
BEGIN
  SELECT id, parent_role_id INTO v_sup_role, v_parent_role
  FROM roles WHERE name ILIKE 'supervisor%ventas%' ORDER BY id LIMIT 1;

  IF v_sup_role IS NOT NULL THEN
    SELECT array_agg(e.id) INTO v_ids
    FROM employees e
    WHERE e.role_id = v_sup_role AND e.status = 'ACTIVO'
      AND NOT EXISTS (
        SELECT 1 FROM employee_events ev
        WHERE ev.employee_id = e.id
          AND ev.type IN ('VACATION','DISABILITY','PERMIT')
          AND ev.date = v_today
      );
  END IF;

  IF (v_ids IS NULL OR array_length(v_ids, 1) IS NULL) AND v_parent_role IS NOT NULL THEN
    SELECT array_agg(e.id) INTO v_ids
    FROM employees e WHERE e.role_id = v_parent_role AND e.status = 'ACTIVO';
  END IF;

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$function$;