-- Una venta ya emitida NO se pasa a crédito.
--
-- Lo confirmó el usuario el 2026-08-26: el crédito no es una forma de pago que
-- se pueda corregir sobre un documento vivo — para eso hay que anular la venta
-- y volver a facturarla. Y lo dice también la medición: la única solicitud de
-- ese tipo que llegó a aplicarse (0000056702_COF, Salud 3, 25-ago) quedó en
-- crédito durante CINCO MINUTOS y después volvió sola a tarjeta. El portal la
-- dio por aplicada porque releyó la venta justo dentro de esa ventana.
--
-- La regla va en la BD y no sólo en la pantalla por lo mismo que las otras
-- cuatro de esta función: la pantalla es una de las formas de crear una
-- solicitud, no la única, y una regla que sólo vive en el navegador se saltea
-- sin querer el día que alguien agrega otro camino.
SET lock_timeout = '5s';

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

    -- Antes de mirar la factura: no depende de ella y el motivo es distinto.
    IF NEW.type = 'PAYMENT_CHANGE_REQUEST'
       AND lower(coalesce(NEW.metadata->>'new_pago', '')) = 'credito' THEN
        RAISE EXCEPTION 'PAGO_A_CREDITO_NO: una venta emitida no se puede pasar a crédito; hay que anularla y volver a facturarla.';
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
    IF v_estado = 'NULA' THEN
        RAISE EXCEPTION 'FACTURA_ANULADA: esa factura ya está anulada.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validar_solicitud_facturacion() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.validar_solicitud_facturacion() TO authenticated, service_role;
