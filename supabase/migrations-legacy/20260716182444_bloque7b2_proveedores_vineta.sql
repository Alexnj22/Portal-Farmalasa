SET lock_timeout = '5s';
ALTER TABLE public.proveedores ADD COLUMN IF NOT EXISTS vineta numeric;
