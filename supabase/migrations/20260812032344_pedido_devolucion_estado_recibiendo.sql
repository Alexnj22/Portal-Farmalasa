SET lock_timeout = '5s';

-- Falta el estado del candado de la recepción.
--
-- La fila se toma ANTES de tocar el sistema —dos personas de Bodega apretando
-- «ya llegó» a la vez pasan las dos la lectura previa— y esa toma necesita un
-- estado propio: sin él, el UPDATE del candado rebota contra el CHECK y las dos
-- siguen de largo hacia el sistema. Recibir dos veces duplica la existencia y
-- eso no se deshace solo.
--
-- Es el mismo `recibiendo` que ya usa `pedido_traslado_linea` en el despacho.
ALTER TABLE public.pedido_devolucion
    DROP CONSTRAINT IF EXISTS pedido_devolucion_estado_check;

ALTER TABLE public.pedido_devolucion
    ADD CONSTRAINT pedido_devolucion_estado_check
    CHECK (estado IN ('solicitada', 'rechazada', 'aceptada',
                      'enviando', 'enviada', 'recibiendo', 'recibida', 'error'));
