SET lock_timeout = '5s';

-- Quien confirma o descarta un corte tiene que verse: nombre, foto y hora.
--
-- No sale de `employees_safe` porque la policy de SELECT de `employees`
-- ESCONDE a los superusuarios de todo el mundo menos de si mismos, y quien
-- resuelve un corte suele ser justamente un supervisor con ese rol: la tarjeta
-- decia "Sin registrar quien" sobre una decision que SI tiene autor. Un estado
-- sin autor no se puede reclamar.
--
-- Es DEFINER y por eso el alcance esta acotado dos veces: solo devuelve
-- empleados que aparecen como `resuelto_por` de algun corte, y solo a quien
-- puede ver el modulo. No abre la tabla de personal: expone la firma de una
-- decision, que es lo que una bitacora tiene que mostrar.
CREATE OR REPLACE FUNCTION public.get_cortes_resolutores(p_ids uuid[])
RETURNS TABLE (id uuid, name text, photo_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT e.id, e.name, e.photo_url
  FROM public.employees e
  WHERE (SELECT public.auth_has_module_permission('cortes_caja', 'can_view'))
    AND e.id = ANY(p_ids)
    AND EXISTS (SELECT 1 FROM public.cortes_caja c WHERE c.resuelto_por = e.id);
$$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_resolutores(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cortes_resolutores(uuid[]) TO authenticated, service_role;
