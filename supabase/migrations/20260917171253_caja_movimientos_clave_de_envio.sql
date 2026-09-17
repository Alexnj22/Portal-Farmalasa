SET lock_timeout = '5s';

-- ── Un envío repetido no escribe dos movimientos ───────────────────────────
--
-- Medido el 2026-09-17: entre el 4 y el 16 de septiembre se registraron 13
-- movimientos de más, en 10 grupos, por $377.61. Los pares están separados por
-- 34 a 73 milisegundos y uno tiene TRES filas en un solo segundo, con los
-- `erp_movimiento_id` devueltos en orden INVERTIDO respecto al de inserción:
-- o sea peticiones en paralelo, no un reintento.
--
-- La causa vive en la pantalla (el botón seguía activo mientras subía la foto
-- del comprobante, y `ocupado` recién se encendía después), y ahí se corrigió.
-- Pero un cerrojo del navegador no cubre dos pestañas, un reintento de red ni
-- dos personas: la garantía tiene que estar acá.
--
-- `clave_envio` la genera la pantalla UNA vez por formulario y viaja igual en
-- cada reintento de ESE envío. El índice es parcial porque las filas viejas
-- —y cualquier escritura que no venga del diálogo— la tienen en NULL, y en un
-- índice único los NULL no chocan entre sí.
ALTER TABLE public.caja_movimientos_portal
    ADD COLUMN IF NOT EXISTS clave_envio text;

CREATE UNIQUE INDEX IF NOT EXISTS caja_mov_portal_clave_envio_unica
    ON public.caja_movimientos_portal (clave_envio)
    WHERE clave_envio IS NOT NULL;

COMMENT ON COLUMN public.caja_movimientos_portal.clave_envio IS
    'Identifica UN envío del formulario, no un movimiento: viaja igual en cada reintento del mismo. `operar-caja` contesta con la fila que ya existe en vez de escribir otra. Ver la migración que la creó.';
