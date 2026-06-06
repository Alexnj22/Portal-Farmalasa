-- Revert: el trigger de nombre era incorrecto y podía asignar laboratorios incorrectos.
-- El sync ya maneja el enlace por ID vía changelog detection (laboratorio_id null vs nuevo ID).
DROP TRIGGER IF EXISTS trg_backfill_product_laboratorio ON public.laboratorios;
DROP FUNCTION IF EXISTS public.backfill_product_laboratorio();
