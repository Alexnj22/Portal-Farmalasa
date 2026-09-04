SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- La nómina tenía policy de lectura y ninguna de escritura
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `payroll_entries` y `payroll_periods` tienen RLS encendido y el GRANT completo
-- a `authenticated`, pero **sólo una policy de SELECT**. Sin INSERT, UPDATE ni
-- DELETE, todo lo que `src/data/payroll.js` intenta falla:
--
--     insertPayrollPeriod          crear la quincena
--     insertPayrollEntries         generarla
--     deletePendingPayrollEntries  rehacerla
--     updatePayrollEntry           corregir un renglón
--
-- O sea que **la nómina no se podía correr desde el portal**, y eso explica las
-- 0 filas de `payroll_entries` mucho mejor que «todavía no cargaron los
-- sueldos». Nadie lo reportó porque nadie llegó a intentarlo.
--
-- ── Y la lectura filtraba sueldos por sala ────────────────────────────────
-- La policy vieja era:
--
--     (payroll.can_view AND scope='ALL')
--     OR EXISTS (… e.branch_id = auth_employee_branch_id())
--
-- El segundo término **no pedía ningún permiso**. El día que existiera la
-- primera quincena, cualquier dependiente habría visto el sueldo ordinario, los
-- descuentos y el líquido a pagar de todos sus compañeros de sala y de su
-- jefatura. Medido en el branch con la policy vieja puesta: una sesión sin
-- `payroll`, en la misma sucursal, veía el renglón; con la nueva ve **cero**.
--
-- Es la misma forma del hallazgo del bucket `documents`: una condición que
-- parece un filtro —«de mi sala»— haciendo de permiso. Acotar POR DÓNDE se mira
-- no es lo mismo que decidir QUIÉN puede mirar.
--
-- ── Lo que a propósito NO se agrega ────────────────────────────────────────
-- Un `OR employee_id = auth_employee_id()` dejaría que cada quien viera su
-- propia boleta, que suena razonable y probablemente lo sea. No se agrega acá
-- porque hoy no hay ninguna pantalla que se la muestre, y una policy que abre
-- un dato para el que no existe consumidor es una decisión tomada sin que nadie
-- la mire.

DROP POLICY IF EXISTS payroll_entries_read ON public.payroll_entries;
CREATE POLICY payroll_entries_read ON public.payroll_entries FOR SELECT TO authenticated
USING (
    (SELECT auth_has_module_permission('payroll', 'can_view'))
    AND ((SELECT auth_module_scope('payroll')) = 'ALL'
         OR EXISTS (SELECT 1 FROM public.employees e
                     WHERE e.id = payroll_entries.employee_id
                       AND e.branch_id = (SELECT auth_employee_branch_id())))
);

CREATE POLICY payroll_entries_insert ON public.payroll_entries FOR INSERT TO authenticated
WITH CHECK ((SELECT auth_can_edit_any(ARRAY['payroll'])));

CREATE POLICY payroll_entries_update ON public.payroll_entries FOR UPDATE TO authenticated
USING ((SELECT auth_can_edit_any(ARRAY['payroll'])))
WITH CHECK ((SELECT auth_can_edit_any(ARRAY['payroll'])));

-- Sí lleva DELETE, al revés que el historial de empleados: generar una quincena
-- BORRA los renglones `PENDING` del período y los reinserta. No es una bitácora,
-- es un borrador que se rehace.
CREATE POLICY payroll_entries_delete ON public.payroll_entries FOR DELETE TO authenticated
USING ((SELECT auth_can_edit_any(ARRAY['payroll'])));

CREATE POLICY payroll_periods_insert ON public.payroll_periods FOR INSERT TO authenticated
WITH CHECK ((SELECT auth_can_edit_any(ARRAY['payroll'])));

CREATE POLICY payroll_periods_update ON public.payroll_periods FOR UPDATE TO authenticated
USING ((SELECT auth_can_edit_any(ARRAY['payroll'])))
WITH CHECK ((SELECT auth_can_edit_any(ARRAY['payroll'])));

CREATE POLICY payroll_periods_delete ON public.payroll_periods FOR DELETE TO authenticated
USING ((SELECT auth_can_edit_any(ARRAY['payroll'])));
