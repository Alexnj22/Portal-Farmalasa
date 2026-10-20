-- Respuestas automáticas del chat (2026-10-20, «que conteste solo si preguntan
-- precio de un producto, horario, número de teléfono»).
--
-- `app-clientes` (chat_enviar) reconoce la pregunta y contesta con los datos
-- REALES del portal —horario de hoy y teléfonos y direcciones de las
-- sucursales, precio y existencias de un producto del catálogo—. Nunca
-- contesta solo sobre dosis, síntomas, embarazo, niños, interacciones ni
-- recomendaciones: eso queda para el equipo. La respuesta es un mensaje del
-- `sistema` marcado `automatica`: la app y el portal la muestran como
-- «Respuesta automática», con la opción de hablar con una persona.
--
-- Se apaga desde el portal (`app_chat_ajustes.respuestas_automaticas`).
SET lock_timeout = '5s';
ALTER TABLE public.app_chat_mensajes ADD COLUMN IF NOT EXISTS automatica boolean NOT NULL DEFAULT false;
ALTER TABLE public.app_chat_ajustes ADD COLUMN IF NOT EXISTS respuestas_automaticas boolean NOT NULL DEFAULT true;
