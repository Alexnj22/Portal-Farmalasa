SET lock_timeout = '5s';

-- Corrección del mismo día: `facturas_compra_archivos` juntaba dos cosas que el
-- usuario quiere repartir por separado. Se parte en dos claves:
--   facturas_compra_abrir      → ver el documento en pantalla
--   facturas_compra_descargar  → llevarse el archivo (JSON/PDF/paquete/ZIP)
-- Los roles que tenían la clave vieja en true reciben las dos en true: la clave
-- vieja nació hoy con backfill a los 5 roles que ven el módulo, así que esto
-- deja exactamente el acceso que había antes de todo el cambio.
INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT role_id, k, true, false, false, 'ALL', now()
FROM role_permissions,
     LATERAL (VALUES ('facturas_compra_abrir'), ('facturas_compra_descargar')) AS nueva(k)
WHERE module_key = 'facturas_compra_archivos' AND can_view = true
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();

DELETE FROM role_permissions WHERE module_key = 'facturas_compra_archivos';

-- Storage acepta CUALQUIERA de las dos: abrir el PDF en el visor necesita leer
-- el objeto igual que descargarlo. La separación entre ver y guardar no existe
-- a nivel de URL firmada — vive en la interfaz, y en la edge function del ZIP
-- masivo, que sí exige específicamente `facturas_compra_descargar`.
ALTER POLICY purchase_dte_storage_select ON storage.objects
  USING (
    bucket_id = 'purchase-dte'
    AND (SELECT auth_has_module_permission('facturas_compra', 'can_view'))
    AND (
      (SELECT auth_has_module_permission('facturas_compra_abrir', 'can_view'))
      OR (SELECT auth_has_module_permission('facturas_compra_descargar', 'can_view'))
    )
  );
