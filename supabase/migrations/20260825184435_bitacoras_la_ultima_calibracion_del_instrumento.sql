SET lock_timeout = '5s';

-- La fecha en que se calibró el instrumento, además de hasta cuándo vale.
--
-- Pedido del usuario al convertir el refrigerador en un interruptor: «al
-- activarlo pregunta la última calibración». Es un dato distinto de
-- `calibrado_hasta` y los dos hacen falta: la SALA sabe cuándo lo calibraron
-- —está en el certificado que tiene en la mano— y lo que el portal necesita
-- para avisar es cuándo VENCE. Con la fecha de calibración el portal puede
-- proponer el vencimiento a un año, que es lo habitual, y dejar que se corrija;
-- pidiendo sólo el vencimiento, quien configura tiene que hacer esa cuenta de
-- cabeza y a veces la hace mal.
--
-- La alarma de «calibración vencida» —ítem CRÍTICO del RTS 5.6.14— sigue
-- mirando `calibrado_hasta`: es la fecha que decide si la lectura vale.
ALTER TABLE public.bitacora_areas
    ADD COLUMN IF NOT EXISTS calibrado_el date;

COMMENT ON COLUMN public.bitacora_areas.calibrado_el IS
    'Cuándo se calibró el instrumento. El vencimiento sigue siendo calibrado_hasta, que es el que decide si la lectura vale.';
