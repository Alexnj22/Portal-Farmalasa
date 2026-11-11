-- La pantalla distinguía al practicante comparando el NOMBRE del cargo; un
-- rótulo no es una clave. La base devuelve la marca por id (41 = Practicante).
SET lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.cumplimiento_dependientes(p_branch_id bigint)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('cumplimiento_tab_dependientes', 'can_view') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF public.auth_module_scope('cumplimiento') <> 'ALL' AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Esa sucursal no es la tuya.';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object('id', e.id, 'nombre', e.name, 'cargo', ro.name, 'foto', e.photo_url,
                                      'practicante', e.role_id = 41,
                                      'acreditado', coalesce(e.tiene_acreditacion_dependiente, false),
                                      'carne', e.carne_dependiente_url IS NOT NULL)
                    ORDER BY coalesce(e.tiene_acreditacion_dependiente, false), e.name)
      FROM public.employees e JOIN public.roles ro ON ro.id = e.role_id
     WHERE e.branch_id = p_branch_id AND e.status ILIKE 'activ%'
       AND e.role_id IN (30, 19, 20, 41)), '[]'::json);  -- Dependiente, Jefe/a, Subjefe/a, Practicante
END;
$function$;
