SET lock_timeout = '5s';

-- Quién puede ver un archivo del bucket `payment-proofs` (2026-10-02, plan de
-- alcance F3b). Hasta hoy su policy de lectura era `bucket_id = ...` a secas:
-- cualquier empleado con sesión listaba y descargaba los comprobantes de bolsas,
-- cortes y abonos de TODAS las salas. Se escribe como función —y no adentro de
-- la policy— para poder SIMULARLA sobre los archivos reales antes de cambiar la
-- policy: una regla mal escrita deja a una cajera sin ver su propio comprobante
-- en medio del turno.
--
--   · quien lo subió, siempre (`owner`, la cuenta que lo subió);
--   · `invoices/…`: facturación (o su bandeja de solicitudes);
--   · `bolsas/<sala>/…`, `cortes/<sala>/…`, `abonos-credito/<sala>/…`: con
--     cualquiera de los módulos de caja, la sala propia; con alcance de red en
--     alguno de ellos, todas;
--   · cualquier otra carpeta: sólo alcance de red.
--
-- ⚠️ La reemplazó 20261003044838 el mismo día: evaluada por fila agotó el tiempo.
CREATE OR REPLACE FUNCTION public.comprobante_de_caja_visible(p_name text, p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    (p_owner IS NOT NULL AND p_owner = auth.uid())
    OR CASE split_part(p_name, '/', 1)
      WHEN 'invoices' THEN
        public.auth_has_module_permission('facturacion', 'can_view')
        OR public.auth_has_module_permission('requests_facturacion', 'can_view')
      ELSE EXISTS (
        SELECT 1
          FROM unnest(ARRAY['bolsas', 'caja_vales', 'cortes_caja', 'cuentas_por_cobrar',
                            'requests_caja', 'requests_cuentas_por_cobrar']) AS m(modulo)
         WHERE public.auth_has_module_permission(m.modulo, 'can_view')
           AND (public.auth_module_scope(m.modulo) = 'ALL'
                OR (split_part(p_name, '/', 1) IN ('bolsas', 'cortes', 'abonos-credito')
                    AND split_part(p_name, '/', 2) = public.auth_employee_branch_id()::text)))
    END;
$$;

REVOKE EXECUTE ON FUNCTION public.comprobante_de_caja_visible(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comprobante_de_caja_visible(text, uuid) TO authenticated, service_role;
