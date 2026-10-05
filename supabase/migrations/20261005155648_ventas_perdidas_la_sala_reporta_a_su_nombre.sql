SET lock_timeout = '5s';
-- La sala no podía reportar: el INSERT exigía can_edit del módulo, que sólo
-- tienen cargos de red. Ahora cualquiera reporta A SU NOMBRE y como pendiente;
-- atenderlo (UPDATE) sigue exigiendo can_edit.
ALTER POLICY ventas_perdidas_insert ON public.ventas_perdidas WITH CHECK (
  (SELECT auth_can_edit_any(ARRAY['ventas_perdidas'::text]))
  OR (reportado_por = (SELECT auth_employee_id()) AND status = 'pendiente')
);
