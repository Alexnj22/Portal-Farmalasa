-- `validar_solicitud_facturacion` bloqueaba las solicitudes sobre facturas
-- `estado = 'NULA'`. Resultó ser el estado RARO.
--
-- Medido el 2026-08-06, al verificar la primera anulación hecha por el portal:
--
--     FINALIZADA             341,226
--     DTE INVALIDADO EN MH       975   ← el estado real de una anulada
--     NULA                        14
--
-- 'NULA' es el paso intermedio: anulada en el ERP y todavía sin invalidar ante
-- Hacienda. Una vez que el MH la procesa, el sync la trae como
-- 'DTE INVALIDADO EN MH'. O sea que la validación cubría el 1.4% de los casos
-- y dejaba pasar el 98.6%: se podía pedir la anulación de una factura que ya
-- estaba anulada y cerrada ante Hacienda.
--
-- Lo delató la propia factura de la prueba (345641): quedó en
-- 'DTE INVALIDADO EN MH', no en 'NULA'.
--
-- El criterio pasa a ser "no está viva", y se escribe una sola vez acá para que
-- el día que aparezca otro estado terminal se agregue en un lugar.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.factura_esta_anulada(p_estado text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT upper(coalesce(p_estado, '')) IN ('NULA', 'DTE INVALIDADO EN MH');
$$;

REVOKE EXECUTE ON FUNCTION public.factura_esta_anulada(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.factura_esta_anulada(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validar_solicitud_facturacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_estado text;
    v_id     bigint;
BEGIN
    IF NEW.type NOT IN ('ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                        'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST') THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_id := (NEW.metadata->>'invoice_id')::bigint;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'SOLICITUD_SIN_FACTURA: la solicitud no identifica una factura.';
    END;

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'SOLICITUD_SIN_FACTURA: la solicitud no identifica una factura.';
    END IF;

    SELECT estado INTO v_estado FROM public.sales_invoices WHERE id = v_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FACTURA_NO_EXISTE: esa factura ya no está en el portal.';
    END IF;

    -- Una factura anulada no se anula otra vez, y tampoco se le cambia el
    -- cliente, la forma de pago ni el vendedor: ya no es un documento vivo.
    IF public.factura_esta_anulada(v_estado) THEN
        RAISE EXCEPTION 'FACTURA_ANULADA: esa factura ya está anulada.';
    END IF;

    RETURN NEW;
END;
$$;
