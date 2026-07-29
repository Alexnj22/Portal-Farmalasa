-- Fase 4 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): búsqueda por contenido
-- del ítem del DTE (ej. "el CCF que trae Claro" sin importar el emisor).
-- Mismo patrón que proveedores_maestro.nombre_norm (20260718100000).
SET lock_timeout = '5s';

ALTER TABLE public.purchase_dte_documents
  ADD COLUMN IF NOT EXISTS items_text text;

ALTER TABLE public.purchase_dte_documents
  ADD COLUMN IF NOT EXISTS items_norm text
  GENERATED ALWAYS AS (public.norm_search(items_text)) STORED;
