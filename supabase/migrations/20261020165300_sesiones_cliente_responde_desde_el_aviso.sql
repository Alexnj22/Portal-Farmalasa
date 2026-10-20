-- Responder el chat desde el aviso (2026-10-20, «como las apps de mensajería»).
-- La app nueva registra la categoría `chat` con el botón «Responder» y lo
-- declara al guardar su token (`avisos_responde`). Sólo a esas sesiones se les
-- manda el aviso del chat con esa categoría: una app vieja no la conoce y en
-- iPhone perdería el «Toca para ver el detalle» de la pantalla bloqueada.
SET lock_timeout = '5s';
ALTER TABLE public.app_cliente_sesiones ADD COLUMN IF NOT EXISTS avisos_responde boolean NOT NULL DEFAULT false;
