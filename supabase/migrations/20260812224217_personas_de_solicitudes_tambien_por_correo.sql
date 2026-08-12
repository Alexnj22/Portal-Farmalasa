SET lock_timeout = '5s';

-- La misma ventana, para el ajuste de Min/Max.
--
-- Min/Max no guarda un id de empleado en «quién decidió»: guarda el CORREO con
-- el que esa persona entró (`auth.email()`, así lo escribe
-- `approve_minmax_request`), y ese correo se ARMA con el usuario —
-- `${username}@farmalasa.app`. Por eso el portal lo resuelve con
-- `buscadorDePersonas`, que prueba id, correo, usuario y el usuario dentro del
-- correo.
--
-- Ese buscador recorre el maestro de personal, y el maestro esconde a los
-- cargos `is_su`. O sea que el mismo agujero de la migración anterior tiene acá
-- OTRO síntoma, y por eso no se veía como el mismo problema: en vez de quedar
-- en «Sin registro», la ficha muestra la dirección de correo pelada
-- —«edwin.nunez@farmalasa.app»— donde va el nombre, y sin foto. Las 4
-- solicitudes de Min/Max del portal están decididas por ese cargo.
--
-- Se reemplaza la función en vez de agregarle un parámetro con DEFAULT: un
-- overload con default no es deuda inerte, es una segunda firma viva que
-- alguien va a llamar sin querer.
--
-- `clave` devuelve la entrada que hizo juego, para que quien llama pueda
-- guardar la persona bajo la misma llave con la que la buscó —el uuid o el
-- correo— sin tener que recibir `username`/`email` de vuelta. Esa es la razón
-- de que la columna exista: mantener fuera del payload dos campos que son media
-- credencial.
DROP FUNCTION IF EXISTS public.get_personas_de_solicitudes(uuid[]);

CREATE FUNCTION public.get_personas_de_solicitudes(p_ids uuid[], p_claves text[])
RETURNS TABLE (clave text, id uuid, name text, first_names text, last_names text,
               photo_url text, role_id bigint, branch_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH participa AS (
    SELECT e.id, e.name, e.first_names, e.last_names, e.photo_url,
           e.role_id, e.branch_id, e.email, e.username
    FROM public.employees e
    WHERE EXISTS (SELECT 1 FROM public.approval_requests ar
                  WHERE ar.employee_id = e.id OR ar.approver_id = e.id)
       OR EXISTS (SELECT 1 FROM public.minmax_change_requests m
                  WHERE m.requested_by_id = e.id
                     OR lower(m.decided_by) = lower(e.email)
                     OR lower(m.decided_by) = lower(e.username)
                     OR lower(split_part(m.decided_by, '@', 1)) = lower(e.username))
  )
  SELECT p.id::text, p.id, p.name, p.first_names, p.last_names, p.photo_url, p.role_id, p.branch_id
  FROM participa p
  WHERE p.id = ANY(coalesce(p_ids, '{}'::uuid[]))
  UNION
  SELECT c.clave, p.id, p.name, p.first_names, p.last_names, p.photo_url, p.role_id, p.branch_id
  FROM unnest(coalesce(p_claves, '{}'::text[])) AS c(clave)
  JOIN participa p
    ON lower(c.clave) = lower(p.email)
    OR lower(c.clave) = lower(p.username)
    OR lower(split_part(c.clave, '@', 1)) = lower(p.username);
$$;

REVOKE EXECUTE ON FUNCTION public.get_personas_de_solicitudes(uuid[], text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_personas_de_solicitudes(uuid[], text[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_personas_de_solicitudes(uuid[], text[]) IS
  'Datos de PANTALLA (nombre, foto, cargo, sala) de quienes participan de una solicitud —de aprobación o de Min/Max—, buscados por uuid o por el correo/usuario con el que decidieron. Existe porque employees_select esconde a los cargos is_su y eso dejaba la ficha «Aprobó» sin cara ni nombre. No devuelve code/email/system_role a propósito.';
