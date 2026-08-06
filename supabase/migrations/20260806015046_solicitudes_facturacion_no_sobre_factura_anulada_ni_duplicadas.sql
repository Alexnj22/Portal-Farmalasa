-- Dos errores que hoy nada impide cometer desde el widget de Facturación:
--
--   1. Pedir la anulación de una factura QUE YA ESTÁ ANULADA. El portal lo
--      sabe (`sales_invoices.estado = 'NULA'`) y no lo miraba nadie.
--   2. Mandar una segunda solicitud sobre la misma factura mientras la
--      primera sigue pendiente.
--
-- Van en la BD y no solo en la pantalla porque el RLS de `approval_requests`
-- deja ver a cada quien SOLO sus propias solicitudes: un empleado no puede
-- comprobar desde el navegador si otro ya pidió lo mismo. Una validación que
-- no puede ver el dato no es una validación.
--
-- Una sola solicitud pendiente por factura, sin importar el tipo: las cuatro
-- modifican el mismo documento y las decide la misma persona. Dos decisiones
-- abiertas sobre una factura es justo por donde se cuelan los errores.
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

DROP TRIGGER IF EXISTS trg_validar_solicitud_facturacion ON public.approval_requests;
CREATE TRIGGER trg_validar_solicitud_facturacion
    BEFORE INSERT ON public.approval_requests
    FOR EACH ROW EXECUTE FUNCTION public.validar_solicitud_facturacion();

-- Una sola pendiente por factura. Índice y no trigger: el índice no se puede
-- ganar una carrera entre dos inserts simultáneos, un SELECT previo sí.
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_una_pendiente_por_factura
    ON public.approval_requests ((metadata->>'invoice_id'))
    WHERE status = 'PENDING'
      AND type IN ('ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                   'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST');
