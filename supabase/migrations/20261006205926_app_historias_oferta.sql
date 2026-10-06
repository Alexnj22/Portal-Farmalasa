SET lock_timeout = '5s';

-- Una historia puede llevar a una oferta: en la app aparece «Reservar», que abre
-- esa oferta para reservarla (2026-10-06). Además, toda historia tiene «Más
-- información» por WhatsApp al número de la empresa; eso no se guarda acá.
ALTER TABLE public.app_historias
    ADD COLUMN oferta_id uuid REFERENCES public.ofertas_clientes(id) ON DELETE SET NULL;
CREATE INDEX app_historias_oferta_idx ON public.app_historias (oferta_id);
