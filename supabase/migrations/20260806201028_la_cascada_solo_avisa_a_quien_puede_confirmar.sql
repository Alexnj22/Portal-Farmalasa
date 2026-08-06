-- La cascada solo le avisa a quien puede confirmar.
--
-- Lo destapó la prueba del RLS, no la lectura: en Salud 3 hay cinco personas en
-- turno ahora mismo y una de ellas es de Atención de Canales Digitales. Recibía
-- el aviso «te piden un traslado», abría el enlace y no veía nada — la política
-- le niega la fila porque su rol no tiene el permiso. Un aviso que lleva a una
-- pantalla vacía es peor que no avisar: quien lo recibe cree que otro lo tomó.
--
-- `puede_confirmar_traslado` replica EXACTAMENTE lo que decide
-- `auth_has_module_permission`: SUPERADMIN pasa siempre, y si no, vale el rol
-- principal **o el secundario**. Si las dos lógicas se separan vuelve el mismo
-- bug con otra cara — por eso una es copia literal de la otra y no una versión
-- «parecida».
--
-- Efecto de borde deseable: una sala donde nadie en turno tiene el permiso ya
-- no se queda esperando; cae sola al escalón de la jefatura.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puede_confirmar_traslado(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = p_employee_id
          AND (
              coalesce(e.system_role, '') = 'SUPERADMIN'
              OR EXISTS (SELECT 1 FROM public.role_permissions rp
                          WHERE rp.role_id = e.role_id
                            AND rp.module_key = 'traslados' AND rp.can_approve)
              OR EXISTS (SELECT 1 FROM public.role_permissions rp
                          WHERE rp.role_id = e.secondary_role_id
                            AND rp.module_key = 'traslados' AND rp.can_approve)
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.puede_confirmar_traslado(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puede_confirmar_traslado(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolver_destinatarios_traslado(p_branch_id integer)
RETURNS TABLE (destinatarios uuid[], escalon text)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE v uuid[];
BEGIN
    -- 1 · quien está en turno en esa sala Y puede confirmar
    SELECT array_agg(t.employee_id ORDER BY t.employee_id)
      INTO v FROM public.empleados_en_turno(p_branch_id) t
     WHERE public.puede_confirmar_traslado(t.employee_id);
    IF coalesce(array_length(v, 1), 0) > 0 THEN
        RETURN QUERY SELECT v, 'TURNO'::text;
        RETURN;
    END IF;

    -- 2 · la jefatura de la sala
    SELECT array_agg(e.id ORDER BY e.name)
      INTO v FROM public.employees e
     WHERE e.branch_id = p_branch_id AND e.status = 'ACTIVO'
       AND e.system_role IN ('JEFE', 'SUBJEFE')
       AND public.puede_confirmar_traslado(e.id);
    IF coalesce(array_length(v, 1), 0) > 0 THEN
        RETURN QUERY SELECT v, 'JEFATURA'::text;
        RETURN;
    END IF;

    -- 3 · Supervisión, que es el último respaldo
    SELECT array_agg(e.id ORDER BY e.name)
      INTO v FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.system_role IN ('SUPERVISOR', 'ADMIN', 'SUPERADMIN')
       AND public.puede_confirmar_traslado(e.id);
    RETURN QUERY SELECT v, CASE WHEN coalesce(array_length(v, 1), 0) > 0
                                THEN 'SUPERVISION' ELSE 'NADIE' END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolver_destinatarios_traslado(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_destinatarios_traslado(integer) TO authenticated, service_role;
