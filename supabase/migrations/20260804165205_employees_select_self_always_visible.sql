SET lock_timeout = '5s';

-- Un empleado cuyo cargo tiene roles.is_su = true quedaba invisible para SÍ MISMO:
-- la policy escondía a los SU sin exceptuar al propio titular. Consecuencia medida
-- el 2026-08-04 con edwin.nunez (cargo 13 «Supervisor/a de Ventas», is_su = true):
-- loginWithUsername (AuthContext.jsx:620) lee employees_safe — vista security_invoker,
-- o sea con RLS — y recibía 0 filas, así que el portal contestaba
-- «Usuario no encontrado en el sistema.» aunque la contraseña fuera correcta y la
-- sesión ya estuviera creada por signInWithPassword.
--
-- El wrapper (SELECT ...) alrededor de auth_employee_id() es obligatorio: sin él
-- Postgres evalúa la función POR FILA (incidente 2026-07-08).
ALTER POLICY employees_select ON public.employees
  USING (
    NOT COALESCE((SELECT r.is_su FROM public.roles r WHERE r.id = employees.role_id), false)
    OR id = (SELECT public.auth_employee_id())
  );
