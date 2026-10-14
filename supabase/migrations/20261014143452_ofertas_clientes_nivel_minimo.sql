-- Ofertas exclusivas por NIVEL (2026-10-14, el usuario eligió «ofertas
-- exclusivas por nivel, bien visibles»). Además de `exclusiva` (sólo socios
-- del programa), una oferta puede pedir un nivel mínimo — Plata, Oro o
-- Platino — o ser sólo para Clientes Mayoristas aprobados. NULL = sin
-- requisito de nivel. El servidor de la app la muestra a todos (como
-- invitación), pero sólo deja reservarla a quien cumple.
SET lock_timeout = '5s';
ALTER TABLE public.ofertas_clientes
  ADD COLUMN IF NOT EXISTS nivel_minimo text;
ALTER TABLE public.ofertas_clientes ADD CONSTRAINT ofertas_clientes_nivel_minimo_check
  CHECK (nivel_minimo IS NULL OR nivel_minimo IN ('plata', 'oro', 'platino', 'mayoreo'));
