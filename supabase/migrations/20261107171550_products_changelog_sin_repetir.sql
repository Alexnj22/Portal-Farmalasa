-- El historial de productos no anota dos veces el mismo cambio (2026-11-07).
--
-- `sync-products` corre por el cron (cada 10 min) y también cuando una
-- pantalla pide refrescar el catálogo (`leer-dte-json` modo
-- `refrescar_catalogo`, que sólo mira la última corrida TERMINADA). Si las dos
-- arrancan a la vez, ambas leen el producto antes del cambio y ambas anotan
-- «X TABLETAS → X 30 TABLETAS»: COMBINATER quedó dos veces, a 0.1 s.
--
-- El freno va en la base y no en la función porque las dos corridas son
-- procesos distintos: un candado de transacción ordena las inserciones y la
-- segunda ve la fila de la primera. Un cambio idéntico (mismo producto,
-- campo, antes y después) dentro de 2 minutos se descarta en silencio.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.products_changelog_sin_repetir()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
    -- Una sola llave para toda la tabla: sin riesgo de interbloqueo entre dos
    -- tandas, y la tabla recibe unas pocas filas al día.
    PERFORM pg_advisory_xact_lock(hashtext('products_changelog_sin_repetir'));
    IF EXISTS (
        SELECT 1 FROM public.products_changelog c
         WHERE c.product_id = NEW.product_id
           AND c.campo = NEW.campo
           AND c.valor_anterior IS NOT DISTINCT FROM NEW.valor_anterior
           AND c.valor_nuevo    IS NOT DISTINCT FROM NEW.valor_nuevo
           AND c.detected_at > coalesce(NEW.detected_at, now()) - interval '2 minutes'
    ) THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.products_changelog_sin_repetir() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_changelog_sin_repetir ON public.products_changelog;
CREATE TRIGGER products_changelog_sin_repetir
    BEFORE INSERT ON public.products_changelog
    FOR EACH ROW EXECUTE FUNCTION public.products_changelog_sin_repetir();
