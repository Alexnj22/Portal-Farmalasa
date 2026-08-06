-- E1 · El costo de venta — capturarlo al momento de la venta.
-- `PLAN-CONTABILIDAD-2026-08-02.md` Parte 3 §5: es lo único irreversible del
-- plan. Sin costo por línea no hay costo de ventas, no hay margen real y no hay
-- Estado de Resultados — y **cada día que pasa es historia que no se recupera**.
--
-- De dónde sale el costo, medido el 2026-08-05 sobre los items de la última
-- semana (8,927 líneas):
--
--   · `sales_invoice_items.id_presentacion` está en NULL en las 584,750 filas
--     de la tabla. Es columna muerta: el cruce evidente contra
--     `product_precios(product_id, id_presentacion)` da CERO coincidencias.
--   · La llave que sí funciona es **(erp_product_id, factor_unidades)** contra
--     `product_precios(product_id, factor)`: resuelve un costo único en el
--     96.8% de las líneas, deja 1.3% con más de un costo distinto y 2.0% sin
--     ninguno.
--
-- Por eso hay DOS columnas y no una. El 1.3% ambiguo se marca en vez de
-- esconderse detrás del desempate: un promedio o un "el primero" haría que el
-- número se lea como exacto cuando no lo es, y quien audite el margen no
-- tendría cómo enterarse.
--
-- Lo que este cambio NO hace, a propósito:
--   · **No rellena el pasado.** El costo de la lista de HOY no es el costo que
--     tenía el producto en junio. Escribirlo hacia atrás inventaría un dato
--     con apariencia de medido. Las 584,750 filas viejas quedan en NULL, que
--     es la verdad: no se capturó.
--   · No toca el precio, ni el libro de IVA, ni ningún reporte. Sólo guarda.
--     Consumirlo (margen, costo de ventas) es trabajo posterior — y ahora es
--     posible, que era el punto.

SET lock_timeout = '5s';

-- Columnas nuevas: nullable y sin default, así que es cambio de catálogo y no
-- reescribe la tabla (importa: `sales_invoice_items` recibe inserts del sync
-- cada minuto).
ALTER TABLE public.sales_invoice_items
    ADD COLUMN IF NOT EXISTS costo_unitario numeric,
    ADD COLUMN IF NOT EXISTS costo_ambiguo  boolean;

COMMENT ON COLUMN public.sales_invoice_items.costo_unitario IS
    'Costo de lista congelado al momento de insertar la línea, por (erp_product_id, factor_unidades). NULL = no se pudo resolver, o la línea es anterior a 2026-08-06 (no se rellena hacia atrás: el costo de hoy no es el de entonces).';
COMMENT ON COLUMN public.sales_invoice_items.costo_ambiguo IS
    'true cuando esa combinación tenía MÁS DE UN costo distinto en product_precios y hubo que desempatar. ~1.3% de las líneas. Sin esta marca el número se leería como exacto.';

-- El lookup del trigger va por (product_id, factor); el índice que existía
-- —idx_pp_factor_lookup— tiene `factor` como columna INCLUDE, o sea que no
-- sirve para buscar POR factor.
CREATE INDEX IF NOT EXISTS idx_pp_product_factor_costo
    ON public.product_precios (product_id, factor)
    WHERE costo > 0;

-- El trigger va en la BASE y no en el sync a propósito: hay cuatro caminos que
-- insertan líneas de venta (`sync-dte-sales`, `backfill-dte-sales`,
-- `heal-dte-sync` y las correcciones manuales). Uno solo que se olvide deja un
-- hueco permanente en el histórico, y el hueco no avisa.
CREATE OR REPLACE FUNCTION public.sales_invoice_items_congelar_costo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Sólo si nadie lo mandó explícito y hay con qué buscarlo.
    IF NEW.costo_unitario IS NOT NULL
       OR NEW.erp_product_id IS NULL
       OR NEW.factor_unidades IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT (array_agg(pp.costo ORDER BY pp.activo DESC, pp.updated_at DESC NULLS LAST, pp.id))[1],
           count(DISTINCT pp.costo) > 1
      INTO NEW.costo_unitario, NEW.costo_ambiguo
      FROM public.product_precios pp
     WHERE pp.product_id = NEW.erp_product_id
       AND pp.factor     = NEW.factor_unidades
       AND pp.costo      > 0;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sales_invoice_items_congelar_costo() IS
    'BEFORE INSERT: congela el costo de lista de la línea vendida. Sólo INSERT — un re-sync no debe pisar el costo que ya se capturó.';

REVOKE EXECUTE ON FUNCTION public.sales_invoice_items_congelar_costo() FROM PUBLIC, anon;

-- BEFORE INSERT y no BEFORE UPDATE: si una factura se re-sincroniza, el costo
-- correcto sigue siendo el del día de la venta, no el de hoy.
DROP TRIGGER IF EXISTS trg_sii_congelar_costo ON public.sales_invoice_items;
CREATE TRIGGER trg_sii_congelar_costo
    BEFORE INSERT ON public.sales_invoice_items
    FOR EACH ROW
    EXECUTE FUNCTION public.sales_invoice_items_congelar_costo();
