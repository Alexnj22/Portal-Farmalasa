SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- D1 y D4a de docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md
--
-- ── D1 · cotizacion_items aceptaba escrituras de cualquiera ─────────────────
-- Tenía UNA policy `FOR ALL` con `USING ((SELECT auth.role()) = 'authenticated')`
-- y `WITH CHECK` nulo — y en un FOR ALL sin WITH CHECK, Postgres usa el USING
-- también para escribir. O sea que cualquier persona con cuenta podía insertar,
-- modificar o borrar líneas de cualquier cotización, sin permiso del módulo.
-- Era el único agujero de ESCRITURA real de los que se auditaron.
--
-- Ahora el ítem HEREDA la regla de su cotización madre, vía EXISTS. `cotizaciones`
-- ya resuelve módulo + ámbito de sucursal, y un ítem no puede tener una regla
-- propia que se desincronice del documento al que pertenece: si mañana cambia el
-- criterio del padre, el hijo lo sigue solo.
--
-- ── D4a · employee_documents era legible por cualquiera ─────────────────────
-- `USING (true)`: cualquier persona con cuenta leía los documentos de cualquier
-- empleado. Su INSERT ya estaba gateado; el agujero era sólo la lectura.
-- Pasa a «los propios O el módulo» — el OR del autoservicio es necesario porque
-- «Mis Documentos» lee la misma tabla.
--
-- Ensayado en staging con 4 casos en BEGIN…ROLLBACK y `SET LOCAL role
-- authenticated`: sin cambiar de rol, RLS ni se evalúa y la prueba no prueba nada.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS cotizacion_items_authenticated ON public.cotizacion_items;
DROP POLICY IF EXISTS cotizacion_items_select ON public.cotizacion_items;
DROP POLICY IF EXISTS cotizacion_items_write  ON public.cotizacion_items;

CREATE POLICY cotizacion_items_select ON public.cotizacion_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_id));

CREATE POLICY cotizacion_items_write ON public.cotizacion_items
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_id));

DROP POLICY IF EXISTS employee_documents_select ON public.employee_documents;
CREATE POLICY employee_documents_select ON public.employee_documents
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id())
      OR (SELECT public.auth_has_module_permission('staff_detail','can_view'))
      OR (SELECT public.auth_has_module_permission('emp_documents','can_view')));
