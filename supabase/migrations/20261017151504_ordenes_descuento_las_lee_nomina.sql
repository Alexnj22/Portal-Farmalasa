SET lock_timeout = '5s';

-- La planilla aplica sola las órdenes de descuento vigentes (v2.1299.3), así que
-- quien CALCULA la quincena tiene que poder leerlas. Antes sólo las leía la
-- persona dueña y quien ve el expediente (`staff_detail`). Si alguien tenía
-- Nómina sin Personal, RLS devolvía cero filas sin error y la orden salía en
-- $0 en la planilla, en silencio. Hoy no pasa porque los tres cargos con
-- Nómina también ven Personal: estaba protegido por coincidencia.
DROP POLICY IF EXISTS ordenes_descuento_select ON public.ordenes_descuento;
CREATE POLICY ordenes_descuento_select ON public.ordenes_descuento
  FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT auth_employee_id())
    OR (SELECT auth_has_module_permission('staff_detail', 'can_view'))
    OR (SELECT auth_has_module_permission('payroll', 'can_view'))
  );
