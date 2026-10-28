-- «Otros descuentos» de la planilla deja de ser un monto sin nombre (2026-10-28).
-- FALTANTES-DE-CAJA-Y-DE-INVENTARIO §hueco 3: el campo aceptaba cualquier monto,
-- y por ahí podía entrar un faltante de caja, que el Código de Trabajo no deja
-- descontar del salario. Lista del usuario (2026-10-28): los seis motivos que
-- la ley admite, más «otro» con detalle escrito obligatorio.
-- La planilla tiene 0 filas: el CHECK entra sin tocar datos.
SET lock_timeout = '5s';

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS other_discounts_concepto text,
  ADD COLUMN IF NOT EXISTS other_discounts_detalle  text;

ALTER TABLE public.payroll_entries
  ADD CONSTRAINT payroll_entries_otros_descuentos_con_concepto CHECK (
    (other_discounts_concepto IS NULL OR other_discounts_concepto IN (
       'prestamo_banco','cooperativa','aseguradora','embargo_judicial',
       'pension_alimenticia','cuota_sindical','otro'))
    AND (coalesce(other_discounts, 0) = 0 OR other_discounts_concepto IS NOT NULL)
    AND (other_discounts_concepto IS DISTINCT FROM 'otro'
         OR length(btrim(coalesce(other_discounts_detalle, ''))) >= 3)
  );

COMMENT ON COLUMN public.payroll_entries.other_discounts_concepto IS
  'Motivo de other_discounts: prestamo_banco, cooperativa, aseguradora, embargo_judicial, pension_alimenticia, cuota_sindical u otro. Obligatorio si hay monto.';
COMMENT ON COLUMN public.payroll_entries.other_discounts_detalle IS
  'Detalle escrito del descuento; obligatorio cuando el concepto es «otro».';
