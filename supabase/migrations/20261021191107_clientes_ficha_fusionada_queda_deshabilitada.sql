-- Fusionar ya no borra la ficha duplicada (decisión del dueño 2026-10-21:
-- «debe quedar en la cuenta principal, la otra debe quedar deshabilitada»).
-- La duplicada queda con `fusionada_en_id` → la principal y `deshabilitada_at`.
SET lock_timeout = '5s';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS fusionada_en_id bigint
    REFERENCES public.customers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS deshabilitada_at timestamptz;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_fusionada_coherente CHECK (
    (fusionada_en_id IS NULL) = (deshabilitada_at IS NULL)
    AND fusionada_en_id IS DISTINCT FROM id);

COMMENT ON COLUMN public.customers.fusionada_en_id IS
  'Ficha principal en la que se fusionó ésta. Si no es NULL la ficha está deshabilitada: no se busca, no entra a la app ni a las corridas, y una factura que llegue a su nombre se liga a la principal (cliente_vigente).';
COMMENT ON COLUMN public.customers.deshabilitada_at IS
  'Cuándo se deshabilitó por fusión. Va junto con fusionada_en_id (CHECK).';

CREATE INDEX IF NOT EXISTS idx_customers_fusionada_en
  ON public.customers (fusionada_en_id) WHERE fusionada_en_id IS NOT NULL;
