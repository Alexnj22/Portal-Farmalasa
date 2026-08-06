-- El widget «Solicitar Modificación a Facturación» ofrece cuatro tipos de
-- solicitud, pero el CHECK de `type` solo conocía tres: `CLIENT_CHANGE_REQUEST`
-- nunca se agregó cuando se sumó el formulario de Cambio de Cliente.
--
-- El formulario existe, busca el cliente contra el catálogo completo, valida y
-- arma el payload — y el INSERT rebota con violación de constraint. El error se
-- muestra como «Error al enviar solicitud» y la solicitud no se crea nunca.
-- Ningún camino de lectura lo delataba: una tabla sin filas no falla.
--
-- Los otros tres tipos (ANNULMENT / PAYMENT_CHANGE / VENDOR_CHANGE) ya estaban.
SET lock_timeout = '5s';

ALTER TABLE public.approval_requests
    DROP CONSTRAINT IF EXISTS approval_requests_type_check;

ALTER TABLE public.approval_requests
    ADD CONSTRAINT approval_requests_type_check CHECK (
        type = ANY (ARRAY[
            'PERMIT'::text,
            'VACATION'::text,
            'SHIFT_CHANGE'::text,
            'OVERTIME'::text,
            'ADVANCE'::text,
            'CERTIFICATE'::text,
            'DISABILITY'::text,
            'VACATION_CHANGE'::text,
            'SHIFT_EXCEPTION'::text,
            'ANNULMENT_REQUEST'::text,
            'PAYMENT_CHANGE_REQUEST'::text,
            'VENDOR_CHANGE_REQUEST'::text,
            'CLIENT_CHANGE_REQUEST'::text
        ])
    );
