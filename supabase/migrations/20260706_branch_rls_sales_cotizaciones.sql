-- A pedido directo del usuario: "necesito que el sistema sea seguro... que
-- si un usuario no tiene permiso ni acceso a algo, no pueda verlo." Estas
-- tablas tenían SELECT/ALL literalmente `USING (true)` para cualquier
-- autenticado — sin revisar ni siquiera el permiso can_view del módulo, no
-- solo el scope. Confirmado: sales_invoices y cotizaciones solo se leen
-- desde vistas admin (DashboardView/FacturacionView/VentasView/
-- WidgetAnnulmentRequest y CotizacionesView) — ningún flujo self-service
-- las toca directo, así que no necesitan cláusula de "propio registro".

DROP POLICY IF EXISTS "Authed can read sales_invoices" ON public.sales_invoices;
CREATE POLICY sales_invoices_select ON public.sales_invoices
  FOR SELECT
  USING (
    auth_has_module_permission('ventas', 'can_view')
    AND (auth_module_scope('ventas') = 'ALL' OR branch_id = auth_employee_branch_id())
  );

DROP POLICY IF EXISTS cotizaciones_authenticated ON public.cotizaciones;

CREATE POLICY cotizaciones_select ON public.cotizaciones
  FOR SELECT
  USING (
    auth_has_module_permission('cotizaciones', 'can_view')
    AND (auth_module_scope('cotizaciones') = 'ALL' OR branch_id = auth_employee_branch_id())
  );

CREATE POLICY cotizaciones_insert ON public.cotizaciones
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('cotizaciones', 'can_edit')
    AND (auth_module_scope('cotizaciones') = 'ALL' OR branch_id = auth_employee_branch_id())
  );

CREATE POLICY cotizaciones_update ON public.cotizaciones
  FOR UPDATE
  USING (
    auth_has_module_permission('cotizaciones', 'can_edit')
    AND (auth_module_scope('cotizaciones') = 'ALL' OR branch_id = auth_employee_branch_id())
  );

CREATE POLICY cotizaciones_delete ON public.cotizaciones
  FOR DELETE
  USING (
    auth_has_module_permission('cotizaciones', 'can_edit')
    AND (auth_module_scope('cotizaciones') = 'ALL' OR branch_id = auth_employee_branch_id())
  );
