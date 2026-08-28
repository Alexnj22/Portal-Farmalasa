-- Quién hizo que el portal escribiera este vale.
--
-- Un control automático sin rastro no se puede auditar, y éste no es del todo
-- automático: hoy lo dispara una persona a mano. Sin esta columna, el día que
-- un corte cuadre «solo» no habría forma de decir quién lo pidió — y el propio
-- portal es el que insiste en que un movimiento sin autor es un hallazgo.
--
-- NULL significa que lo corrió el sistema (un cron, cuando exista), no que se
-- perdió el dato: son dos cosas distintas y por eso no hay valor por defecto.

SET lock_timeout = '5s';

ALTER TABLE public.caja_vales_portal
    ADD COLUMN IF NOT EXISTS anotado_por uuid REFERENCES public.employees(id);

CREATE INDEX IF NOT EXISTS caja_vales_portal_autor_idx
    ON public.caja_vales_portal (anotado_por);

COMMENT ON COLUMN public.caja_vales_portal.anotado_por IS
    'La ficha de quien disparó la escritura. NULL = lo corrió el sistema, no que falte el dato.';
