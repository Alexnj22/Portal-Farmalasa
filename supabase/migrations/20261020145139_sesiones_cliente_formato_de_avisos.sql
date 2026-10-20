SET lock_timeout = '5s';
-- Formato de avisos que entiende la app de ESTE teléfono (2026-10-20).
-- 1: el de siempre (en Android el cuerpo llega sin el producto).
-- 2: Android con el canal `ocultos` (no sale en la pantalla bloqueada), así
--    que el aviso puede llevar el texto entero. Lo manda la app al registrar
--    su token; una versión vieja no lo manda y se queda en 1.
ALTER TABLE public.app_cliente_sesiones
  ADD COLUMN IF NOT EXISTS avisos_formato smallint NOT NULL DEFAULT 1;
