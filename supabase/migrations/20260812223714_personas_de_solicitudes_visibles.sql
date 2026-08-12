SET lock_timeout = '5s';

-- Quién aprobó una solicitud dejó de verse el 2026-08-04.
--
-- `employees_select` esconde a los cargos con `roles.is_su` de todo el mundo
-- salvo del titular (ver la memoria de esa policy: se escribió para que un
-- superusuario no figure en el directorio de personal, y lleva
-- `OR id = auth_employee_id()` porque si no, el login del propio titular caía).
-- Esa mitad sigue siendo correcta. El efecto que nadie midió es el otro: el
-- aprobador REAL del portal —«Supervisor/a de Ventas», rol 13, `is_su = true`—
-- resuelve 12 de las 14 solicitudes, y `fetchRequests` hidrata al aprobador
-- leyendo `employees`. Con la fila escondida el join daba null y la ficha
-- «Aprobó» pintaba «Sin registro», sin cara y sin nombre. Medido con la sesión
-- de Idalia Serrano: 8 de 8 solicitudes resueltas, sin aprobador a la vista.
--
-- No se toca la policy: esconder al superusuario del directorio es lo que se
-- quiso. Lo que se abre es UNA ventana del tamaño exacto del agujero — quien
-- participa de una solicitud se puede nombrar y mostrar dentro de esa
-- solicitud.
--
-- Devuelve SÓLO lo que hace falta para pintar la ficha. En particular NO
-- devuelve `code`: ese código es hoy la contraseña del carné
-- (docs/ del 2026-08-12, hallazgo abierto) y una función DEFINER que se saltea
-- el RLS no es lugar para ensancharlo. Tampoco `email` ni `system_role`, que
-- ninguna de las tres pantallas de solicitudes usa del aprobador.
--
-- El `EXISTS` es el freno: no alcanza con ser empleado, hay que participar de
-- alguna solicitud. Y hay que conocer el uuid de antemano — el que viene en la
-- fila de la solicitud que quien llama ya podía leer.
CREATE OR REPLACE FUNCTION public.get_personas_de_solicitudes(p_ids uuid[])
RETURNS TABLE (id uuid, name text, first_names text, last_names text,
               photo_url text, role_id bigint, branch_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT e.id, e.name, e.first_names, e.last_names, e.photo_url, e.role_id, e.branch_id
  FROM public.employees e
  WHERE e.id = ANY(p_ids)
    AND EXISTS (SELECT 1 FROM public.approval_requests ar
                WHERE ar.employee_id = e.id OR ar.approver_id = e.id);
$$;

REVOKE EXECUTE ON FUNCTION public.get_personas_de_solicitudes(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_personas_de_solicitudes(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_personas_de_solicitudes(uuid[]) IS
  'Datos de PANTALLA (nombre, foto, cargo, sala) de quienes participan de una solicitud. Existe porque employees_select esconde a los cargos is_su y eso dejaba la ficha «Aprobó» sin cara ni nombre. No devuelve code/email/system_role a propósito.';
