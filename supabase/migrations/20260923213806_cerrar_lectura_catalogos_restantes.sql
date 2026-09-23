-- Fase 2, regla 6 (docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md): los tres
-- catálogos que quedaban abiertos a cualquier sesión se leen con su módulo.
-- «Cada uno debe tener acceso solo a lo suyo, sin nada más» (usuario).
--
--   education_catalog_entries  formulario de empleado (Personal, Expediente)
--                              → staff_detail | staff_list
--   proveedores                Laboratorios › Política de vencimiento, y el
--                              panel de vencimiento de MIN·MAX
--                              (`get_product_vencimiento_policy`, INVOKER, lo
--                              une con JOIN: sin la fila el panel queda vacío)
--                              → laboratorios | minmax
--   suppliers                  Laboratorios, Compras, Proveedores, Facturas de
--                              compra (`get_purchase_dte_documents`,
--                              `find_…_by_codigo`, `get_proveedores_maestro`,
--                              INVOKER con JOIN) y Promociones (quién paga el bono)
--                              → laboratorios | compras | proveedores |
--                                facturas_compra | promociones
--
-- Medido como usuario, un cargo por fila, en una transacción deshecha
-- (2026-09-23): Administración, Gerencia, Talento Humano, Supervisión y QA
-- idénticos; Compras conserva proveedores y suppliers; Contador Externo
-- conserva suppliers. Quedan en 0 sólo cargos sin ninguna de esas pantallas.
-- Las escrituras no cambian. `sync-erp-purchases` usa service_role.

SET lock_timeout = '5s';

DROP POLICY education_catalog_entries_select ON public.education_catalog_entries;
CREATE POLICY education_catalog_entries_select ON public.education_catalog_entries
  FOR SELECT TO authenticated
  USING ((SELECT EXISTS (SELECT 1 FROM unnest(ARRAY['staff_detail','staff_list']) m
                          WHERE public.auth_has_module_permission(m, 'can_view'))));

DROP POLICY proveedores_select ON public.proveedores;
CREATE POLICY proveedores_select ON public.proveedores
  FOR SELECT TO authenticated
  USING ((SELECT EXISTS (SELECT 1 FROM unnest(ARRAY['laboratorios','minmax']) m
                          WHERE public.auth_has_module_permission(m, 'can_view'))));

DROP POLICY "authenticated read suppliers" ON public.suppliers;
CREATE POLICY suppliers_select ON public.suppliers
  FOR SELECT TO authenticated
  USING ((SELECT EXISTS (SELECT 1 FROM unnest(ARRAY['laboratorios','compras','proveedores','facturas_compra','promociones']) m
                          WHERE public.auth_has_module_permission(m, 'can_view'))));
