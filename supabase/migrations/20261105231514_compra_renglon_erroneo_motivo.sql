SET lock_timeout = '5s';
-- «A vencidos» (2026-11-05): un producto BUENO de la compra que se manda al
-- área de vencidos al cargar, con su motivo (devolución, corto vencimiento,
-- dañado, otro). Null = producto erróneo del proveedor, como hasta ahora.
ALTER TABLE public.compra_renglon_erroneo ADD COLUMN IF NOT EXISTS motivo text;
COMMENT ON COLUMN public.compra_renglon_erroneo.motivo IS
  'Motivo de «A vencidos» (producto bueno apartado al cargar). NULL = producto erróneo del proveedor.';
