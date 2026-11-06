SET lock_timeout = '5s';
-- La marca del destrabe (`_shared/erp-destrabe.ts`): lo que una recepción le
-- quitó a una ficha se anota acá ANTES de quitarlo, para que lo devuelva la
-- siguiente llamada si ésta muere en el medio.
ALTER TABLE public.compra_reparto ADD COLUMN IF NOT EXISTS detalle jsonb;
COMMENT ON COLUMN public.compra_reparto.detalle IS
  'Marca del destrabe de ficha durante la recepción (destrabe: {lote, pres, at}). Ver supabase/functions/_shared/erp-destrabe.ts.';
