-- La presentación viaja por SIGNIFICADO, no por id.
--
-- La validación de la migración anterior exigía `id_presentacion` resuelto, con
-- el argumento correcto —no elegir por posición— pero el id equivocado: el del
-- portal. Son DOS numeraciones. Para el producto 2, `product_precios` tiene
-- 1/102/230 y el ERP ofrece 8421/7213/3; para el 9, el portal dice CAJA(8) y el
-- ERP la llama 6619. Mandar la del portal apuntaría a otra presentación
-- existente y el ERP la aceptaría sin protestar — exactamente el error del id
-- de factura que casi se comete en la sesión anterior.
--
-- Tampoco sirve la posición: medido el 2026-08-06, el producto 105 pone UNIDAD
-- al final de su <select> y los productos 6, 9 y 56 la ponen primera.
--
-- Lo único estable entre los dos sistemas es la ETIQUETA, «TIPO (FACTOR)»:
-- coincide exactamente con `presentaciones.tipo` + `product_precios.factor`.
-- Así que la solicitud guarda el significado y la Edge Function resuelve el id
-- del ERP contra lo que el ERP ofrece en el momento de aplicar.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.validar_solicitud_movimiento_inventario()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m          jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_items    jsonb := m->'items';
    it         jsonb;
    v_sub      text  := nullif(btrim(coalesce(m->>'subtipo', '')), '');
    v_suc      integer;
    v_ubic     integer;
    -- Los cuatro exactos del <select> del ERP. Cualquier otro valor lo rechaza
    -- el ERP con un 200 y un typeinfo Error, que es justo lo que no queremos
    -- descubrir después de aprobar.
    v_subtipos text[] := ARRAY['VENCIMIENTO','DESCARTE','PRODUCTO DAÑADO','CONSUMO INTERNO'];
BEGIN
    IF NEW.type NOT IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST') THEN
        RETURN NEW;
    END IF;

    -- La causa: es lo que va al `concepto` del ERP y queda en el kardex.
    IF nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La solicitud necesita una causa: es lo que queda escrito en el movimiento.';
    END IF;

    IF NEW.type = 'INVENTORY_DISCARD_REQUEST' THEN
        IF v_sub IS NULL THEN
            RAISE EXCEPTION 'Un descarte necesita su tipo (%).', array_to_string(v_subtipos, ', ');
        END IF;
        IF NOT (v_sub = ANY (v_subtipos)) THEN
            RAISE EXCEPTION 'Tipo de descarte no válido: "%". Los aceptados son %.',
                v_sub, array_to_string(v_subtipos, ', ');
        END IF;
    ELSIF v_sub IS NOT NULL THEN
        RAISE EXCEPTION 'Una carga no lleva tipo de descarte.';
    END IF;

    -- Sucursal y ubicación: los ids del ERP, no los del portal. Son
    -- numeraciones distintas y el ERP acepta la equivocada sin protestar.
    v_suc  := nullif(m->>'erp_sucursal_id', '')::integer;
    v_ubic := nullif(m->>'erp_ubicacion_id', '')::integer;

    IF v_suc IS NULL OR v_ubic IS NULL THEN
        RAISE EXCEPTION 'Falta la sucursal o la ubicación del ERP en la solicitud.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_suc) THEN
        RAISE EXCEPTION 'La sucursal % no existe en el mapa del ERP.', v_suc;
    END IF;

    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'La solicitud no tiene ni un producto.';
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        IF coalesce(nullif(it->>'erp_product_id','')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'Hay una línea sin producto.';
        END IF;

        -- El significado de la presentación, no su id: «UNIDAD» + factor 1.
        -- Con eso la Edge Function encuentra la opción del ERP por etiqueta.
        IF nullif(btrim(coalesce(it->>'presentacion_tipo','')), '') IS NULL THEN
            RAISE EXCEPTION 'La línea del producto % no dice qué presentación es.',
                it->>'erp_product_id';
        END IF;
        IF coalesce(nullif(it->>'factor','')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'La presentación del producto % no trae su factor.',
                it->>'erp_product_id';
        END IF;

        IF coalesce(nullif(it->>'cantidad','')::numeric, 0) <= 0 THEN
            RAISE EXCEPTION 'La línea del producto % no tiene cantidad.',
                it->>'erp_product_id';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.validar_solicitud_movimiento_inventario() FROM PUBLIC, anon;
