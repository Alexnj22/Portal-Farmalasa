SET lock_timeout = '5s';

-- El rótulo que va DEBAJO del círculo de la historia (2026-10-06): el título
-- completo no cabía y salía cortado. Una o dos palabras, como una categoría
-- («Bebé», «Ofertas», «Salud»). Sin rótulo, la app usa la primera palabra.
ALTER TABLE public.app_historias
    ADD COLUMN rotulo text CHECK (rotulo IS NULL OR length(rotulo) BETWEEN 1 AND 12);
