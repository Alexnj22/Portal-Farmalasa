-- Escritura abierta a cualquier autenticado — lote 1 (plan F2.1, 2026-07-29)
--
-- El hardening del 2026-07-02 cubrió las LECTURAS con auth_has_module_permission
-- pero dejó INSERT/UPDATE en `true`. Hoy siguen 26 policies así, sobre 18 tablas,
-- todas TO authenticated: cualquier empleado con el rol más bajo del portal puede
-- escribirlas. (Las otras 4 con `true` son TO service_role — esas NO son
-- vulnerabilidad: service_role ya salta RLS, la policy es decorativa.)
--
-- Este lote toma las cuatro de mayor daño:
--
--   products         catálogo maestro de 5,191 productos
--   kiosk_devices    registrar un dispositivo de kiosco propio = marcar por otros
--   timesheets       alterar horas trabajadas, propias o ajenas → planilla
--   employee_events  alterar el expediente laboral
--
-- El módulo de cada una sale de dónde escribe el frontend, verificado uno por uno:
--   products        → data/productos.js, llamado desde TabCatalogo (productos)
--                     y SrsEnriquecerModal (dash_srs_inv). Se permite la UNIÓN
--                     de ambos: gatear solo a 'productos' rompería el
--                     enriquecimiento de principio activo desde SRS.
--   kiosk_devices   → data/branches.js (branches)
--   timesheets      → data/attendanceAudit.js, aprobar horas (time_audit)
--   employee_events → data/system.js + data/employees.js (staff_detail)
--
-- CRÍTICO: toda llamada a auth_* va envuelta en (SELECT ...). Sin el initplan,
-- Postgres la evalúa POR FILA y cada llamada consulta employees+role_permissions
-- — es la causa exacta del outage del 2026-07-08.
--
-- Los syncs no se ven afectados: usan service_role, que salta RLS por completo.

SET lock_timeout = '5s';

-- ── products ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS auth_update_products ON public.products;
CREATE POLICY products_update ON public.products
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['productos','dash_srs_inv'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['productos','dash_srs_inv'])));

-- ── kiosk_devices ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS kiosk_devices_insert ON public.kiosk_devices;
CREATE POLICY kiosk_devices_insert ON public.kiosk_devices
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['branches'])));

DROP POLICY IF EXISTS kiosk_devices_update ON public.kiosk_devices;
CREATE POLICY kiosk_devices_update ON public.kiosk_devices
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['branches'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['branches'])));

-- ── timesheets ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS timesheets_update ON public.timesheets;
CREATE POLICY timesheets_update ON public.timesheets
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['time_audit'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['time_audit'])));

-- ── employee_events ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS employee_events_insert ON public.employee_events;
CREATE POLICY employee_events_insert ON public.employee_events
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_detail'])));

DROP POLICY IF EXISTS employee_events_update ON public.employee_events;
CREATE POLICY employee_events_update ON public.employee_events
  FOR UPDATE TO authenticated
  USING      ((SELECT auth_can_edit_any(ARRAY['staff_detail'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_detail'])));
