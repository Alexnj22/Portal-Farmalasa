-- Devuelve a quién notificar para temas de logística / nuevos productos:
-- Jefe/a de Compras y Logistica activos y NO de vacaciones/incapacidad/permiso hoy.
-- Si ninguno disponible → fallback al jefe inmediato (Administrador, parent_role_id).
CREATE OR REPLACE FUNCTION public.get_logistics_chief_ids()
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_chief_role  int;
  v_parent_role int;
  v_today       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids         uuid[];
BEGIN
  SELECT id, parent_role_id INTO v_chief_role, v_parent_role
  FROM roles WHERE name ILIKE '%compras%logistica%' ORDER BY id LIMIT 1;

  IF v_chief_role IS NOT NULL THEN
    SELECT array_agg(e.id) INTO v_ids
    FROM employees e
    WHERE e.role_id = v_chief_role AND e.status = 'ACTIVO'
      AND NOT EXISTS (
        SELECT 1 FROM employee_events ev
        WHERE ev.employee_id = e.id
          AND ev.type IN ('VACATION','DISABILITY','PERMIT')
          AND ev.date = v_today
      );
  END IF;

  -- Fallback: jefe inmediato (Administrador)
  IF (v_ids IS NULL OR array_length(v_ids, 1) IS NULL) AND v_parent_role IS NOT NULL THEN
    SELECT array_agg(e.id) INTO v_ids
    FROM employees e WHERE e.role_id = v_parent_role AND e.status = 'ACTIVO';
  END IF;

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_logistics_chief_ids() TO authenticated, service_role;
