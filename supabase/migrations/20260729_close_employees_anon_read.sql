-- 20260729_close_employees_anon_read
--
-- Cierra la lectura de `employees` para el rol `anon`.
--
-- Hallazgo (AUDITORIA-SUPABASE-2026-07-29.md, S1): las policies de employees
-- se crearon sin cláusula TO, lo que en Postgres equivale a TO PUBLIC — o sea
-- que aplican también a `anon`. `employees_select` no tiene ningún gate de
-- autenticación (su USING solo excluye superusuarios), así que cualquiera con
-- la anon key —que viaja en el bundle JS del frontend, es pública por diseño—
-- podía leer la tabla completa:
--
--     GET /rest/v1/employees?select=id&limit=0
--     → HTTP 206 · content-range: */50
--
-- Exponía 50 filas, incluidos 46 `kiosk_pin` (credencial del kiosco de
-- marcaje → suplantación), DUI, teléfonos, direcciones y fechas de nacimiento.
-- `base_salary` / `account_number` están vacías hoy pero eran seleccionables.
--
-- `employees_update` y `employees_delete` tienen el mismo defecto. Hoy fallan
-- cerrado porque `anon` no tiene EXECUTE sobre auth_has_module_permission,
-- pero es una defensa accidental: un GRANT de más las abre. Se corrigen acá
-- porque es el mismo valor y la misma tabla.
--
-- Verificado antes de aplicar: nada lee `employees` antes del login.
--   · LoginView.jsx no hace ninguna llamada a Supabase.
--   · fetchEmployeeSafeByUsername corre DESPUÉS de signInWithPassword
--     (AuthContext.jsx valida data.session primero) → va como authenticated.
--   · El kiosco pre-login usa get_kiosk_boot_payload /
--     get_kiosk_coverage_employees / verify_kiosk_device, SECURITY DEFINER,
--     que no pasan por RLS.
--   · service_role tiene BYPASSRLS → los syncs y edge functions no se afectan.
--
-- `employees_safe` es security_invoker sobre esta misma tabla, así que queda
-- cubierta por el mismo cambio.

SET lock_timeout = '5s';

ALTER POLICY employees_select ON public.employees TO authenticated;
ALTER POLICY employees_update ON public.employees TO authenticated;
ALTER POLICY employees_delete ON public.employees TO authenticated;
