-- «Hay una versión nueva» en la app de clientes (2026-10-29).
--
-- La última compilación que se subió de cada app, por plataforma. La escriben
-- scripts/subir-ios.mjs (cuando Apple termina de procesarla) y
-- scripts/subir-android.mjs (al lanzarla en la pista), y la lee la acción
-- pública `version_publicada` de app-clientes. La app la compara con la suya y
-- AVISA; no obliga (decisión del usuario: «que avise mas no sea restrictivo»).
-- El `build` sólo sube: una subida vieja repetida no hace retroceder el aviso.
-- `enlace` adónde lleva «Actualizar»: hoy TestFlight y la pista interna de
-- Play; al salir a la tienda pública se cambia acá, sin compilar.
SET lock_timeout = '5s';

CREATE TABLE public.app_version_publicada (
  app text NOT NULL CHECK (app IN ('clientes')),
  plataforma text NOT NULL CHECK (plataforma IN ('ios', 'android')),
  version text NOT NULL,
  build integer NOT NULL CHECK (build > 0),
  enlace text NOT NULL,
  publicada_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app, plataforma)
);
ALTER TABLE public.app_version_publicada ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_version_publicada_select ON public.app_version_publicada
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.app_version_publicada (app, plataforma, version, build, enlace) VALUES
  ('clientes', 'ios', '1.0.0', 78, 'itms-beta://beta.itunes.apple.com/v1/app/6819444826'),
  ('clientes', 'android', '1.0.0', 38, 'https://play.google.com/store/apps/details?id=com.wnapp.id1750888957164');
