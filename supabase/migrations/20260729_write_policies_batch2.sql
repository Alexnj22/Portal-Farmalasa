-- Escritura abierta a cualquier autenticado — lote 2 (plan F2.2 + F2.3, 2026-07-29)
--
-- Cierra las 18 policies restantes con `true` TO authenticated/public. El módulo
-- de cada tabla sale de dónde escribe el frontend, verificado con grep uno por
-- uno — no supuesto. Donde había duda se usa la UNIÓN de módulos: un gate de más
-- rompe una función; uno de menos deja el agujero abierto, pero de forma visible.
--
-- DOS TRAMPAS QUE ESTA MIGRACIÓN EVITA:
--
-- 1. `product_locations` y `schedule_coverage` tenían UNA sola policy, `ALL` con
--    `true`, y ALL cubre también SELECT. Reemplazarla por una gateada con
--    can_edit habría dejado sin LECTURA a todo el que solo puede ver. Por eso se
--    parten: SELECT permisivo (igual a la lectura efectiva de hoy, o sea sin
--    regresión) + INSERT/UPDATE/DELETE gateados.
--
-- 2. `user_dashboard_prefs` se llama "owner_*" pero sus tres policies eran
--    TO public con `true`: cualquiera podía leer y escribir las preferencias de
--    cualquiera. Acá sí corresponde dueño real (user_id = auth.uid()), no módulo.
--
-- QUEDAN ABIERTAS A PROPÓSITO, y hay que decirlo explícito:
--
--   attendance (INSERT)  El kiosco marca por esta vía: useTimeClockEngine →
--                        registerAttendance → insertAttendancePunch → INSERT
--                        directo. Y marca por OTROS empleados (tablet
--                        compartida), así que no sirve ni un gate por módulo ni
--                        uno por dueño: cualquiera de los dos rompe el marcaje
--                        de toda la cadena. El fix correcto es una RPC SECURITY
--                        DEFINER que valide el device token, como
--                        verify_kiosk_authorization. Es arquitectura, no una
--                        línea de policy.
--   audit_logs (INSERT)  Mismo caso, ya decidido antes: el user_id lo pone el
--                        cliente y el kiosco escribe sin sesión verificable. El
--                        fix es mover el logging al servidor, dentro de las RPC.
--
-- CRÍTICO: toda llamada auth_* va envuelta en (SELECT ...) — sin el initplan,
-- Postgres la evalúa por fila. Es la causa exacta del outage del 2026-07-08.

SET lock_timeout = '5s';

-- ══ F2.2 — RRHH y sucursales ═════════════════════════════════════════════════

-- branch_documents / branch_expenses → data/branches.js
DROP POLICY IF EXISTS branch_documents_insert ON public.branch_documents;
CREATE POLICY branch_documents_insert ON public.branch_documents
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['branches'])));

DROP POLICY IF EXISTS branch_expenses_insert ON public.branch_expenses;
CREATE POLICY branch_expenses_insert ON public.branch_expenses
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['branches'])));

DROP POLICY IF EXISTS branch_expenses_update ON public.branch_expenses;
CREATE POLICY branch_expenses_update ON public.branch_expenses
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['branches'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['branches'])));

-- holidays / shifts → data/system.js (catálogo de horarios)
DROP POLICY IF EXISTS admin_write ON public.holidays;
CREATE POLICY holidays_insert ON public.holidays
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_holidays'])));

DROP POLICY IF EXISTS admin_update ON public.holidays;
CREATE POLICY holidays_update ON public.holidays
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_holidays'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_holidays'])));

DROP POLICY IF EXISTS admin_write ON public.shifts;
CREATE POLICY shifts_insert ON public.shifts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_shifts'])));

DROP POLICY IF EXISTS admin_update ON public.shifts;
CREATE POLICY shifts_update ON public.shifts
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_shifts'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_shifts'])));

-- schedule_coverage → data/schedules.js. TRAMPA 1: era ALL, hay que partirla.
DROP POLICY IF EXISTS "Authenticated users can manage coverage" ON public.schedule_coverage;
CREATE POLICY schedule_coverage_select ON public.schedule_coverage
  FOR SELECT TO authenticated USING (true);
CREATE POLICY schedule_coverage_write ON public.schedule_coverage
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_calendar'])));
CREATE POLICY schedule_coverage_update ON public.schedule_coverage
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_calendar'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_calendar'])));
CREATE POLICY schedule_coverage_delete ON public.schedule_coverage
  FOR DELETE TO authenticated
  USING ((SELECT auth_can_edit_any(ARRAY['schedules','schedules_tab_calendar'])));

-- employee_documents → systemSlice (expediente). Se incluye emp_documents en la
-- unión porque "Mis Documentos" del empleado usa el mismo camino de datos.
DROP POLICY IF EXISTS employee_documents_insert ON public.employee_documents;
CREATE POLICY employee_documents_insert ON public.employee_documents
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_detail','emp_documents'])));

DROP POLICY IF EXISTS education_catalog_entries_insert ON public.education_catalog_entries;
CREATE POLICY education_catalog_entries_insert ON public.education_catalog_entries
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_detail'])));

DROP POLICY IF EXISTS vph_insert ON public.vacation_plan_headers;
CREATE POLICY vph_insert ON public.vacation_plan_headers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['vacation_plan'])));

DROP POLICY IF EXISTS vph_update ON public.vacation_plan_headers;
CREATE POLICY vph_update ON public.vacation_plan_headers
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['vacation_plan'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['vacation_plan'])));

-- ══ F2.3 — Operación ═════════════════════════════════════════════════════════

-- product_locations → data/productos.js (TabCatalogo). TRAMPA 1 otra vez.
DROP POLICY IF EXISTS auth_all ON public.product_locations;
CREATE POLICY product_locations_select ON public.product_locations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY product_locations_insert ON public.product_locations
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['productos'])));
CREATE POLICY product_locations_update ON public.product_locations
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['productos'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['productos'])));
CREATE POLICY product_locations_delete ON public.product_locations
  FOR DELETE TO authenticated
  USING ((SELECT auth_can_edit_any(ARRAY['productos'])));

DROP POLICY IF EXISTS "staff insert" ON public.ventas_perdidas;
CREATE POLICY ventas_perdidas_insert ON public.ventas_perdidas
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['ventas_perdidas'])));

DROP POLICY IF EXISTS "staff update" ON public.ventas_perdidas;
CREATE POLICY ventas_perdidas_update ON public.ventas_perdidas
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['ventas_perdidas'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['ventas_perdidas'])));

-- survey_responses → data/encuestas.js, solo desde EncuestaAdminView
DROP POLICY IF EXISTS survey_responses_insert ON public.survey_responses;
CREATE POLICY survey_responses_insert ON public.survey_responses
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['encuesta_admin','encuesta'])));

DROP POLICY IF EXISTS survey_responses_update ON public.survey_responses;
CREATE POLICY survey_responses_update ON public.survey_responses
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['encuesta_admin','encuesta'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['encuesta_admin','encuesta'])));

DROP POLICY IF EXISTS spc_insert ON public.sales_payment_confirmations;
CREATE POLICY spc_insert ON public.sales_payment_confirmations
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['facturacion'])));

-- user_dashboard_prefs → TRAMPA 2: se llamaban "owner_*" pero eran TO public
-- con `true`. Acá el dueño real es la única regla que tiene sentido.
DROP POLICY IF EXISTS owner_select ON public.user_dashboard_prefs;
DROP POLICY IF EXISTS owner_upsert ON public.user_dashboard_prefs;
DROP POLICY IF EXISTS owner_update ON public.user_dashboard_prefs;

CREATE POLICY owner_select ON public.user_dashboard_prefs
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY owner_insert ON public.user_dashboard_prefs
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY owner_update ON public.user_dashboard_prefs
  FOR UPDATE TO authenticated
  USING      (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
