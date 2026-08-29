-- Corregir un movimiento de caja es una SOLICITUD, no un botón.
--
-- Pedido del usuario (2026-08-29): «debe poder permitir anular / editar pero
-- como solicitud, por algún error».
--
-- Va sobre `approval_requests`, que es donde el portal ya resuelve esto —hay 34
-- anulaciones de factura y 13 cambios de forma de pago con el mismo patrón—, y
-- no en una tabla nueva: quien aprueba ya tiene su bandeja, sus avisos y su
-- bitácora, y una segunda cola sería un lugar más donde algo se queda esperando
-- sin que nadie lo mire.
--
-- El tipo es uno solo, `CAJA_MOVIMIENTO_CHANGE`, con el qué adentro del
-- `metadata`: anular o corregir el monto son la misma pregunta —«esto quedó
-- mal, arréglalo»— y separarlas en dos tipos obligaría a duplicar el enrutador
-- de aprobadores por una diferencia que sólo importa al aplicarla.
--
-- Lo que NO se puede corregir así: un movimiento que un corte YA CONTÓ. Editarlo
-- cambiaría lo que ese corte esperaba después de que alguien lo firmó, y eso es
-- exactamente el hallazgo que la auditoría de v2.838.0 vigila. La guarda vive en
-- la función que aplica, que es la única que sabe si pasó un corte.

SET lock_timeout = '5s';

ALTER TABLE public.approval_requests
    DROP CONSTRAINT IF EXISTS approval_requests_type_check;

-- El CHECK se rehace con el tipo nuevo adentro. Se listan todos y no se agrega
-- «uno más» a ciegas: un CHECK que nadie lee entero termina aceptando valores
-- que ninguna pantalla sabe mostrar.
ALTER TABLE public.approval_requests
    ADD CONSTRAINT approval_requests_type_check CHECK (type IN (
        'PERMISSION','VACATION','SICK_LEAVE','SCHEDULE_CHANGE','OTHER',
        'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST',
        'INVENTORY_TRANSFER_REQUEST','INVENTORY_TRANSFER_PUSH',
        'INVENTORY_DISCARD_REQUEST','INVENTORY_LOAD_REQUEST',
        'CAJA_MOVIMIENTO_CHANGE'
    )) NOT VALID;

-- `NOT VALID` y después `VALIDATE`: así el ALTER no bloquea la tabla mientras
-- revisa las filas viejas, que es la regla de esta base para DDL sobre algo que
-- se escribe seguido.
ALTER TABLE public.approval_requests VALIDATE CONSTRAINT approval_requests_type_check;
