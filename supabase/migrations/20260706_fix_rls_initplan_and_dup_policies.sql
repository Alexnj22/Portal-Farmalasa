-- Perf advisor: auth_rls_initplan (auth.*() sin envolver → re-evaluado por fila)
-- + multiple_permissive_policies (policies duplicadas/solapadas en el mismo comando).
-- Sin cambio de comportamiento: mismas condiciones efectivas, solo consolidadas.

-- employees: employees_kiosk_select y employees_select son byte-idénticas
-- (mismo USING, mismo rol PUBLIC) — se elimina el duplicado.
DROP POLICY IF EXISTS employees_kiosk_select ON public.employees;

-- ruta_locations: "staff read" (SELECT) es subconjunto redundante de
-- "staff write" (ALL, misma condición) — se elimina el duplicado y se
-- envuelve auth.role() en el que queda.
DROP POLICY IF EXISTS "staff read ruta_locations" ON public.ruta_locations;
DROP POLICY IF EXISTS "staff write ruta_locations" ON public.ruta_locations;
CREATE POLICY "staff write ruta_locations" ON public.ruta_locations
  FOR ALL
  USING ((select auth.role()) = 'authenticated');

-- push_subscriptions: separar el ALL de "own" en escritura (own-only) y
-- consolidar el SELECT (own OR service_role) en una sola policy, ambos con
-- auth.*() envuelto.
DROP POLICY IF EXISTS push_subscriptions_own ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_service ON public.push_subscriptions;

CREATE POLICY push_subscriptions_write ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (
    employee_id = (SELECT e.id FROM public.employees e WHERE e.username = split_part((select auth.email()), '@', 1) LIMIT 1)
  );

CREATE POLICY push_subscriptions_update ON public.push_subscriptions
  FOR UPDATE
  USING (
    employee_id = (SELECT e.id FROM public.employees e WHERE e.username = split_part((select auth.email()), '@', 1) LIMIT 1)
  );

CREATE POLICY push_subscriptions_delete ON public.push_subscriptions
  FOR DELETE
  USING (
    employee_id = (SELECT e.id FROM public.employees e WHERE e.username = split_part((select auth.email()), '@', 1) LIMIT 1)
  );

CREATE POLICY push_subscriptions_select ON public.push_subscriptions
  FOR SELECT
  USING (
    employee_id = (SELECT e.id FROM public.employees e WHERE e.username = split_part((select auth.email()), '@', 1) LIMIT 1)
    OR (select auth.role()) = 'service_role'
  );
