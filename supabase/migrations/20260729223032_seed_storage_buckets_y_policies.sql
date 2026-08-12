SET lock_timeout = '5s';

-- ── Semilla de Storage: buckets y policies que ninguna migración crea ───────
--
-- PROBLEMA QUE RESUELVE. El baseline (20260101000000) se generó del catálogo de
-- prod pero SOLO del esquema `public`. Los buckets y las policies sobre
-- `storage.objects` se crearon en su día desde el panel, así que no están en
-- ninguna migración: un branch nuevo nace sin ellos. La primera migración que
-- lo nota es `20260804002749_facturas_compra_permiso_abrir_documento`, que hace
-- `ALTER POLICY purchase_dte_storage_select ON storage.objects` — y ALTER sobre
-- algo que no existe corta el replay. Medido el 2026-08-12: sin esta semilla el
-- branch se queda en 94 de 283 migraciones.
--
-- ALCANCE. Solo lo que NINGUNA migración crea. Quedan fuera a propósito, porque
-- sus migraciones sí los crean y sembrarlos acá los duplicaría:
--   buckets  : sales-dte (20260804010102), inventario-evidencia (20260807044947)
--   policies : sales_dte_storage_select, inventario_evidencia_{insert,select},
--              purchase_dte_storage_select_sala
--
-- ES NO-OP EN PRODUCCIÓN. Los buckets van con ON CONFLICT DO NOTHING y cada
-- policy se crea solo si falta. Prod ya las tiene todas, así que no se toca ni
-- una definición vigente — importa, porque varias de estas policies son el
-- control de acceso real a los archivos.

-- ── buckets ────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('backups',        'backups',        false, 104857600, ARRAY['application/json','application/gzip','application/zip','text/csv','application/octet-stream']),
  ('documents',      'documents',      false,  10485760, ARRAY['application/pdf','image/jpeg','image/png','image/webp']),
  ('empleados',      'empleados',      false,  10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('payment-proofs', 'payment-proofs', false,  10485760, ARRAY['image/jpeg','image/png','image/webp','application/pdf']),
  ('photos',         'photos',         true,   10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('product-photos', 'product-photos', true,   10485760, ARRAY['image/jpeg','image/png','image/webp']),
  ('purchase-dte',   'purchase-dte',   false,  10485760, ARRAY['application/json','application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- ── policies ───────────────────────────────────────────────────────────────
-- Las simples («este bucket, cualquiera autenticado») salen de una lista: son
-- 17 y escribirlas una por una solo agrega superficie donde equivocarse. La de
-- purchase-dte va aparte porque tiene condición propia.
--
-- `purchase_dte_storage_select` se siembra con la definición VIGENTE de prod, no
-- con la que tenía en julio. Da igual: las dos migraciones posteriores que la
-- ALTERan la dejan exactamente así, y sembrar la vieja solo agregaría un estado
-- intermedio que nadie va a ver.
DO $$
DECLARE
  p record;
  existe boolean;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      ('documents_authenticated_select',           'SELECT', 'documents'),
      ('documents_authenticated_write',            'INSERT', 'documents'),
      ('documents_authenticated_update',           'UPDATE', 'documents'),
      ('documents_authenticated_delete',           'DELETE', 'documents'),
      ('empleados_authenticated_select',           'SELECT', 'empleados'),
      ('Permitir todo a usuarios autenticados 17gkcnc_1', 'INSERT', 'empleados'),
      ('empleados_authenticated_update',           'UPDATE', 'empleados'),
      ('empleados_authenticated_delete',           'DELETE', 'empleados'),
      -- Sí, `empleados` tiene DOS policies de INSERT: ésta y la de nombre
      -- generado por el panel. Prod las tiene a las dos y la huella de policies
      -- no cuadra si falta una.
      ('empleados_authenticated_write',            'INSERT', 'empleados'),
      ('photos_authenticated_select',              'SELECT', 'photos'),
      ('photos_authenticated_insert',              'INSERT', 'photos'),
      ('photos_authenticated_update',              'UPDATE', 'photos'),
      ('product_photos_authenticated_select',      'SELECT', 'product-photos'),
      ('product_photos_authenticated_insert',      'INSERT', 'product-photos'),
      ('product_photos_authenticated_update',      'UPDATE', 'product-photos'),
      ('payment_proofs_authenticated_select',      'SELECT', 'payment-proofs'),
      ('Authenticated upload proofs',              'INSERT', 'payment-proofs')
    ) AS v(nombre, cmd, bucket)
  LOOP
    SELECT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname='storage' AND tablename='objects' AND policyname = p.nombre)
      INTO existe;
    IF NOT existe THEN
      EXECUTE format(
        'CREATE POLICY %I ON storage.objects FOR %s TO authenticated %s (bucket_id = %L)',
        p.nombre, p.cmd,
        CASE WHEN p.cmd = 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END,
        p.bucket);
    END IF;
  END LOOP;

  SELECT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='storage' AND tablename='objects'
                   AND policyname = 'purchase_dte_storage_select')
    INTO existe;
  IF NOT existe THEN
    CREATE POLICY purchase_dte_storage_select ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'purchase-dte'
        AND (SELECT auth_has_module_permission('facturas_compra', 'can_view'))
        AND ((SELECT auth_has_module_permission('facturas_compra_abrir', 'can_view'))
          OR (SELECT auth_has_module_permission('facturas_compra_descargar', 'can_view')))
      );
  END IF;
END $$;
