SET lock_timeout = '5s';
-- Cupón del mes: cuándo lo raspó el cliente (2026-10-09). Antes vivía sólo en
-- el teléfono: en otro teléfono o al reinstalar aparecía sin raspar.
ALTER TABLE public.puntos_lote ADD COLUMN IF NOT EXISTS raspado_el timestamptz;
