-- Una sola solicitud pendiente por producto y par de salas.
--
-- Sin esto, dos personas de la misma sala pueden pedirle el mismo producto a la
-- misma sala de origen sin enterarse — el RLS le muestra a cada una solo sus
-- propias solicitudes, así que ni siquiera podrían mirarlo antes de pedir. La
-- sala de origen recibiría dos avisos idénticos y despacharía dos veces.
--
-- **Índice y no trigger**, igual que en las solicitudes de facturación: un
-- índice único no pierde una carrera entre dos inserts simultáneos y un
-- `SELECT` previo sí. La pregunta es justamente qué pasa cuando llegan al mismo
-- tiempo, y un chequeo leído-y-después-escrito no la contesta.
--
-- Mira el PRIMER producto de la solicitud a propósito: el punto de entrada es
-- la lista de faltantes, que arma una solicitud por producto. Si algún día se
-- pueden pedir varios de una, esto deja de cubrir el segundo en adelante — y es
-- preferible cubrir bien el caso real que cubrir a medias todos.

SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_un_traslado_pendiente
    ON public.approval_requests (
        (metadata->>'erp_sucursal_id'),
        (metadata->>'origen_erp_sucursal_id'),
        (metadata->'items'->0->>'erp_product_id')
    )
    WHERE type = 'INVENTORY_TRANSFER_REQUEST' AND status = 'PENDING';
