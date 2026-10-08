SET lock_timeout = '5s';
-- Las franjas de la tarjeta de Apple Wallet por material (2026-10-08): las
-- genera scripts/wallet/materiales.mjs con los mismos shaders de la app. Sólo
-- las lee el servidor (service_role) al armar el pase: bucket privado y SIN
-- policies, o sea que nadie con sesión puede listarlo ni leerlo.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wallet-materiales', 'wallet-materiales', false, 1048576, ARRAY['image/png'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 1048576, allowed_mime_types = ARRAY['image/png'];
