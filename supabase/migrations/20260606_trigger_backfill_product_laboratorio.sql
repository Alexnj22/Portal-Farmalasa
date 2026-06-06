-- Trigger: al insertar o actualizar un laboratorio, rellena laboratorio_id
-- en productos huérfanos (laboratorio_id IS NULL) cuyo nombre contiene el lab.
-- Caso de uso: ERP sincroniza producto antes de que exista el laboratorio en BD.

CREATE OR REPLACE FUNCTION public.backfill_product_laboratorio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  UPDATE public.products
  SET    laboratorio_id = NEW.id,
         updated_at     = NOW()
  WHERE  laboratorio_id IS NULL
    AND  nombre ILIKE '%' || NEW.nombre || '%';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_backfill_product_laboratorio ON public.laboratorios;
CREATE TRIGGER trg_backfill_product_laboratorio
AFTER INSERT OR UPDATE ON public.laboratorios
FOR EACH ROW EXECUTE FUNCTION public.backfill_product_laboratorio();
