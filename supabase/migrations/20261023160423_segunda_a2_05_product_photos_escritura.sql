-- segunda-a2-05 · productos: sólo quien edita productos sube fotos (H29)
-- Ahora escribir pide lo mismo que `products_update` (productos | dash_srs_inv).
SET lock_timeout = '5s';

DROP POLICY IF EXISTS product_photos_authenticated_insert ON storage.objects;
CREATE POLICY product_photos_authenticated_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'product-photos'
                AND (SELECT public.auth_can_edit_any(ARRAY['productos', 'dash_srs_inv'])));

DROP POLICY IF EXISTS product_photos_authenticated_update ON storage.objects;
CREATE POLICY product_photos_authenticated_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'product-photos'
           AND (SELECT public.auth_can_edit_any(ARRAY['productos', 'dash_srs_inv'])))
    WITH CHECK (bucket_id = 'product-photos'
                AND (SELECT public.auth_can_edit_any(ARRAY['productos', 'dash_srs_inv'])));
