-- ============================================================
-- DB Audit v11 — Storage policy hardening + pg_trgm schema
-- 1. Fix storage bucket policies (anon can list/write — critical)
-- 2. Move pg_trgm out of public schema
--    (pg_net does not support SET SCHEMA — left in public)
-- ============================================================

-- ─── 1. Storage policies ─────────────────────────────────────────────────────
-- Public buckets don't need a SELECT policy for URL-based file access.
-- SELECT policies only enable directory LISTING — a privacy risk.
-- INSERT/UPDATE/DELETE policies currently have no role restriction,
-- meaning anon users can mutate files.

-- documents: DROP broad ALL policy (anon write), replace with auth-only
DROP POLICY IF EXISTS "Permitir todo storage documents" ON storage.objects;
CREATE POLICY "documents_authenticated_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
CREATE POLICY "documents_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'documents');
CREATE POLICY "documents_authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'documents');

-- empleados: drop broad SELECT (listing); restrict all ops to authenticated
DROP POLICY IF EXISTS "Permitir todo a usuarios autenticados 17gkcnc_0" ON storage.objects;
DROP POLICY IF EXISTS "Permitir todo a usuarios autenticados 17gkcnc_2" ON storage.objects;
DROP POLICY IF EXISTS "Permitir todo a usuarios autenticados 17gkcnc_3" ON storage.objects;
CREATE POLICY "empleados_authenticated_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'empleados');
CREATE POLICY "empleados_authenticated_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'empleados');
CREATE POLICY "empleados_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'empleados');
CREATE POLICY "empleados_authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'empleados');

-- payment-proofs: drop open SELECT, restrict to authenticated
DROP POLICY IF EXISTS "Public read proofs" ON storage.objects;
CREATE POLICY "payment_proofs_authenticated_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'payment-proofs');

-- photos: drop open SELECT, restrict to authenticated
DROP POLICY IF EXISTS "Permitir ver fotos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir actualizar fotos" ON storage.objects;
CREATE POLICY "photos_authenticated_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'photos');
CREATE POLICY "photos_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'photos');

-- product-photos: drop open SELECT, restrict to authenticated
DROP POLICY IF EXISTS "product_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "product_photos_update" ON storage.objects;
CREATE POLICY "product_photos_authenticated_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'product-photos');
CREATE POLICY "product_photos_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'product-photos');

-- ─── 2. Move pg_trgm to extensions schema ─────────────────────────────────────
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
