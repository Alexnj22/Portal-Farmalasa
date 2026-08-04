SET lock_timeout = '5s';

-- Vínculo explícito cuenta-de-acceso → empleado.
--
-- Hasta ahora las funciones auth_* resolvían al empleado por tres criterios en OR:
-- auth.uid(), el usuario del correo, y `user_metadata.code`. El tercero lo escribe
-- el propio navegador (`supabase.auth.updateUser({ data })` — el portal mismo lo usa
-- en LoginView.jsx:356), así que era un dato del cliente decidiendo identidad.
-- Esta tabla lo reemplaza: solo service_role escribe en ella, y `auth.uid()` viene
-- del JWT firmado. Las cuentas del portal (correo @farmalasa.app) no necesitan fila:
-- su uid YA es el id del empleado (50 de 50 verificadas). Las del kiosco/carné sí,
-- porque su uid lo generó Auth al crearlas.
CREATE TABLE IF NOT EXISTS public.employee_auth_accounts (
  auth_user_id uuid PRIMARY KEY,
  employee_id  uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_auth_accounts_employee
  ON public.employee_auth_accounts(employee_id);

ALTER TABLE public.employee_auth_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_auth_accounts_select ON public.employee_auth_accounts;
CREATE POLICY employee_auth_accounts_select ON public.employee_auth_accounts
  FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.uid()));

REVOKE ALL ON public.employee_auth_accounts FROM anon;
GRANT SELECT ON public.employee_auth_accounts TO authenticated;

-- Poblado inicial: las cuentas @staff.local cuyo correo es <code|kiosk_pin>@staff.local.
-- Verificado antes de aplicar: 29 de 35 mapean a exactamente un empleado, 0 ambiguas.
-- Las 6 restantes son cuentas huérfanas de pruebas de marzo/mayo 2026 que hoy tampoco
-- resuelven a ningún empleado (su user_metadata.code no existe en employees).
INSERT INTO public.employee_auth_accounts (auth_user_id, employee_id)
SELECT u.id, e.id
FROM auth.users u
JOIN public.employees e
  ON upper(e.code) = upper(split_part(u.email, '@', 1))
  OR upper(coalesce(e.kiosk_pin, '')) = upper(split_part(u.email, '@', 1))
WHERE u.email LIKE '%@staff.local'
ON CONFLICT (auth_user_id) DO NOTHING;
