-- ============================================================================
-- STORAGE PRIVADO FASES 2 y 3 — 2026-07-03 (v2.2.464)
-- Aplicado vía MCP (private_empleados_bucket_and_limits). Registro en repo.
-- ============================================================================

-- FASE 2: bucket 'empleados' (fotos de perfil) privado.
-- El portal firma en LOTE (createSignedUrls, 12h) en un solo punto por flujo:
--   · fetchBoot / fetchKioskBoot (systemSlice): campo `photo` = URL firmada;
--     `photo_url` queda CRUDO como identificador de BD (nunca guardar firmada)
--   · AuthContext: withSignedPhoto en los 4 puntos de login (7 días) +
--     re-firma al arrancar desde caché (photoRaw)
--   · Vistas con selects directos: signPhotosDeep() tras cada fetch
--     (EncuestaAdmin/EncuestaView, VentasPerdidas, RecepcionModal,
--      TabPedidos ×3, CrearRutaModal, TabMinMax ×2, FacturacionView historial)
--   · Escritores que copian fotos a BD guardan RAW: confirmed_by_photo
--     (Facturación) y current/new_vendor_photo (WidgetAnnulmentRequest)
--   · Renders con photo_url crudo reordenados a `photo || photo_url` (9 sitios)
UPDATE storage.buckets SET public = false WHERE id = 'empleados';

-- FASE 3: límites de tamaño y MIME (documents no tenía ninguno)
UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png','image/webp']
WHERE id = 'documents';

UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif']
WHERE id = 'empleados';

-- Verificado: bucket private en BD; requests nuevas → 400; las copias ya
-- cacheadas en el CDN expiran solas en ≤1h (cacheControl 3600 de subida).
SELECT 1;
