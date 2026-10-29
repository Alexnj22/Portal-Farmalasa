-- Actualizaciones por aire de la app de clientes (2026-10-29).
--
-- Un cambio que es sólo JavaScript llega al teléfono sin pasar por la tienda:
-- la app (expo-updates) pregunta al abrir a la función `app-actualizaciones`,
-- baja el paquete en segundo plano y lo usa la próxima vez que se abre.
-- Servidor propio, no el de Expo (EAS Update): sin costo por usuario, igual
-- que las compilaciones (scripts/subir-ios.mjs).
--
-- Cada fila es un paquete publicado con `npm run app:actualizar` para UNA
-- plataforma y UNA `runtime_version`. La versión de runtime es la huella del
-- código nativo (política `fingerprint`): un paquete sólo llega a binarios con
-- el mismo nativo, así que no puede pedir un módulo que el teléfono no tiene.
-- La app nunca baja a un paquete más viejo que el que trae instalado
-- (compara `created_at`), así que una compilación nueva no se pisa con uno
-- viejo. `activa = false` deja de ofrecerlo (no lo quita de quien ya lo bajó).
--
-- Los archivos (paquete JS e imágenes) viven en el bucket PRIVADO
-- `app-actualizaciones` y se entregan con URL firmada; sin policies: sólo el
-- servidor los lee y los escribe.
SET lock_timeout = '5s';

CREATE TABLE public.app_actualizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app text NOT NULL CHECK (app IN ('clientes')),
  plataforma text NOT NULL CHECK (plataforma IN ('ios', 'android')),
  runtime_version text NOT NULL,
  manifiesto jsonb NOT NULL,
  mensaje text,
  commit_git text,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_actualizaciones_vigente_idx
  ON public.app_actualizaciones (app, plataforma, runtime_version, created_at DESC) WHERE activa;
ALTER TABLE public.app_actualizaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_actualizaciones_select ON public.app_actualizaciones
  FOR SELECT TO authenticated USING (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('app-actualizaciones', 'app-actualizaciones', false, 52428800,
        ARRAY['application/octet-stream', 'application/javascript'])
ON CONFLICT (id) DO NOTHING;
