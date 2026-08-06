-- Cierre de un hueco de la migración anterior (20260806004007), detectado al
-- leer el camino de escritura en vez de sólo el de lectura.
--
-- `sync-dte-sales` tiene una bandera `forceItems` que **borra y reinserta** las
-- líneas de una factura. Como el trigger es BEFORE INSERT, un re-sync forzado de
-- un mes viejo le estamparía a esas líneas el costo de la lista de HOY, y
-- quedaría guardado con la misma apariencia que un costo capturado de verdad.
-- Un dato inventado que se lee como medido es peor que un NULL.
--
-- El trigger ahora sólo congela el costo si la venta es reciente. Fuera de esa
-- ventana no escribe nada: la línea queda en NULL, que es la verdad.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.sales_invoice_items_congelar_costo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_fecha date;
BEGIN
    IF NEW.costo_unitario IS NOT NULL
       OR NEW.erp_product_id IS NULL
       OR NEW.factor_unidades IS NULL THEN
        RETURN NEW;
    END IF;

    -- "Al momento de la venta" es literal: si la factura no es de los últimos
    -- 15 días, esto no es una captura sino una reconstrucción, y no se hace.
    -- La ventana es generosa a propósito — el sync normal trae el día en curso,
    -- así que 15 días cubre cualquier atraso real sin habilitar un backfill.
    SELECT si.fecha INTO v_fecha
      FROM public.sales_invoices si
     WHERE si.id = NEW.invoice_id;

    IF v_fecha IS NULL OR v_fecha < current_date - 15 THEN
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
    'BEFORE INSERT: congela el costo de lista de la línea vendida, sólo si la factura es de los últimos 15 días. Un re-sync forzado de un mes viejo NO estampa el costo de hoy — deja NULL.';

REVOKE EXECUTE ON FUNCTION public.sales_invoice_items_congelar_costo() FROM PUBLIC, anon;
