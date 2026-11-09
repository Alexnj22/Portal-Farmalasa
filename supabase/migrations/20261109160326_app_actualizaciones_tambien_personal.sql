SET lock_timeout = '5s';

-- La app del personal también se actualiza por aire (2026-11-09).
ALTER TABLE public.app_actualizaciones DROP CONSTRAINT app_actualizaciones_app_check;
ALTER TABLE public.app_actualizaciones ADD CONSTRAINT app_actualizaciones_app_check CHECK (app IN ('clientes', 'personal'));
