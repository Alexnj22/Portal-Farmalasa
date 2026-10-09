SET lock_timeout = '5s';
-- «Borrar» un aviso en la app lo OCULTA en todos los teléfonos (2026-10-09).
-- La fila no se borra: es la bitácora anti-duplicado (UNIQUE customer_id, tipo, ref).
ALTER TABLE public.app_cliente_avisos
  ADD COLUMN IF NOT EXISTS oculto_at timestamptz;
COMMENT ON COLUMN public.app_cliente_avisos.oculto_at IS
  'Cuándo la persona lo borró de su bandeja en la app. La fila se conserva: es la bitácora que evita mandar dos veces el mismo aviso.';
