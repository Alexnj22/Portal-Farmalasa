SET lock_timeout = '5s';

-- Fase 3.4 / B-4 de la auditoría MinMax 2026-07-17: get_minmax_approver_ids
-- ruteaba por "WHERE name ILIKE 'supervisor%ventas%'" — viola la regla del proyecto
-- "SIEMPRE enrutar por role_id directo, nunca por nombre". Un rename del rol rompía
-- el ruteo en silencio (solicitudes sin notificar a nadie). Fix: role_id=13 fijo,
-- mismo valor que ya usa SALES_SUPERVISOR_ROLE_ID en WidgetAnnulmentRequest.jsx y
-- las migraciones 20260706_set_compras_logistica_minmax_scope_all.sql /
-- 20260716174445_bloque7b3_... (Supervisor/a de Ventas, rol primario de Edwin
-- Nuñez). Fallback a parent_role_id sin cambios.
CREATE OR REPLACE FUNCTION public.get_minmax_approver_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sup_role    CONSTANT int := 13; -- Supervisor/a de Ventas — ver reference_roles_and_approvers
  v_parent_role int;
  v_today       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids         uuid[];
BEGIN
  SELECT parent_role_id INTO v_parent_role FROM roles WHERE id = v_sup_role;

  SELECT array_agg(e.id) INTO v_ids
  FROM employees e
  WHERE e.role_id = v_sup_role AND e.status = 'ACTIVO'
    AND NOT EXISTS (
      SELECT 1 FROM employee_events ev
      WHERE ev.employee_id = e.id
        AND ev.type IN ('VACATION','DISABILITY','PERMIT')
        AND ev.date = v_today
    );

  -- Fallback: jefe inmediato (rol padre) si no hay supervisores disponibles
  IF (v_ids IS NULL OR array_length(v_ids, 1) IS NULL) AND v_parent_role IS NOT NULL THEN
    SELECT array_agg(e.id) INTO v_ids
    FROM employees e WHERE e.role_id = v_parent_role AND e.status = 'ACTIVO';
  END IF;

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$function$;
