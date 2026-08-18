SET lock_timeout = '5s';

-- El sobrante escribe en la existencia de una SALA, que es el lado que este
-- circuito nunca tocó: todo lo probado hasta hoy entra a Bodega. Va con freno
-- propio para poder pausarlo sin dejar sin brazos a la devolución, que ya
-- funciona.
--
-- El CHECK enumera las acciones a propósito —una llave mal escrita en el código
-- crearía una fila que nadie mira y el freno quedaría siempre abierto—, así que
-- agregar un sentido nuevo pasa por acá.
ALTER TABLE public.traslado_interruptor
    DROP CONSTRAINT IF EXISTS traslado_interruptor_accion_check;
ALTER TABLE public.traslado_interruptor
    ADD CONSTRAINT traslado_interruptor_accion_check CHECK (accion = ANY (ARRAY[
        'enviar', 'recibir',
        'devolver_enviar', 'devolver_recibir',
        'sobrante_enviar', 'sobrante_recibir'
    ]));

INSERT INTO public.traslado_interruptor (accion, pausado, motivo)
VALUES ('sobrante_enviar',  true, 'Sin estrenar'),
       ('sobrante_recibir', true, 'Sin estrenar')
ON CONFLICT (accion) DO NOTHING;
