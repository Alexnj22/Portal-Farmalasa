SET lock_timeout = '5s';

-- Permiso granular nuevo: `facturas_compra_archivos` — abrir el documento
-- (detalle con el JSON armado como factura + el PDF) y descargarlo. Separa
-- "ver el listado de compras" de "acceder al archivo", que hasta hoy venían
-- juntos en facturas_compra.can_view.
--
-- Backfill: los 5 roles que YA tienen facturas_compra.can_view=true lo reciben
-- en true, así nadie pierde acceso el día del despliegue — se apaga a mano
-- desde Permisos a quien no deba tenerlo. Mismo criterio que el seed de
-- facturas_compra_ver_montos (2026-07-22).
INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT role_id, 'facturas_compra_archivos', true, false, false, 'ALL', now()
FROM role_permissions
WHERE module_key = 'facturas_compra' AND can_view = true
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();

-- El gate server-side. Sin esto el permiso sería decorativo: esconder los
-- botones no impide pedir la URL firmada del objeto desde fuera de la vista.
-- Las llamadas a auth_* van envueltas en (SELECT ...) — initplan, una sola
-- evaluación por query en vez de una por fila (incidente 2026-07-08).
ALTER POLICY purchase_dte_storage_select ON storage.objects
  USING (
    bucket_id = 'purchase-dte'
    AND (SELECT auth_has_module_permission('facturas_compra', 'can_view'))
    AND (SELECT auth_has_module_permission('facturas_compra_archivos', 'can_view'))
  );
