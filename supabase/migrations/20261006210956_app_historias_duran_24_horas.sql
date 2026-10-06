SET lock_timeout = '5s';

-- Las historias duran 24 HORAS desde que se publican, como un estado
-- (decisión del usuario, 2026-10-06). `publicada_at` lo pone la base al pasar
-- a publicada —no el navegador, para que la hora no dependa del reloj de
-- nadie—; volver a publicarla la renueva otras 24 horas. `inicio`/`fin` quedan
-- como estaban (NOT NULL) y el portal los llena solo.
ALTER TABLE public.app_historias ADD COLUMN publicada_at timestamptz;
UPDATE public.app_historias SET publicada_at = updated_at WHERE publicada;

CREATE FUNCTION public.app_historias_sellar_publicacion()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
BEGIN
  IF NEW.publicada AND (TG_OP = 'INSERT' OR NOT OLD.publicada) THEN
    NEW.publicada_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.app_historias_sellar_publicacion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER app_historias_sellar_publicacion
  BEFORE INSERT OR UPDATE OF publicada ON public.app_historias
  FOR EACH ROW EXECUTE FUNCTION public.app_historias_sellar_publicacion();

CREATE INDEX app_historias_publicada_at_idx ON public.app_historias (publicada_at) WHERE publicada;
