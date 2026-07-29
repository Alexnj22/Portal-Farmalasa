SET lock_timeout = '5s';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS nombre_norm  text GENERATED ALWAYS AS (public.norm_search(nombre)) STORED,
  ADD COLUMN IF NOT EXISTS pactivo_norm text GENERATED ALWAYS AS (public.norm_search(principio_activo)) STORED;

-- products_with_lab es un passthrough sobre products — exponer nombre_norm también
-- (columna nueva al final: CREATE OR REPLACE VIEW no permite reordenar columnas existentes).
CREATE OR REPLACE VIEW public.products_with_lab
WITH (security_invoker = true) AS
SELECT p.id,
       p.nombre,
       p.es_antibiotico,
       p.activo,
       p.laboratorio_id,
       l.nombre AS laboratorio_nombre,
       p.nombre_norm
FROM public.products p
LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id;
