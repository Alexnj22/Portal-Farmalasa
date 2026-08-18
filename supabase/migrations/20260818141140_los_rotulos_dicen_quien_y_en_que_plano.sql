SET lock_timeout = '5s';

-- Los rótulos, dichos como los dijo el usuario (2026-08-18):
--
--   «bodega debe enviar la unidad en sistema, o la sucursal enviar la unidad en
--    físico, esa es la decisión que debe pasar ahí. Si es algún movimiento en
--    sistema, usamos los traslados. Si es algo en físico, sólo la decisión y la
--    trazabilidad de marcar como recibido en físico.»
--
-- O sea que la salida no se nombra por su consecuencia («la sala se queda con
-- lo de más») sino por QUIÉN la hace y EN QUÉ PLANO. Eso es justo lo que la
-- persona necesita para elegir, y es además lo que decide si hay traslado o no.
-- Las columnas `mueve` y `cierra_con` ya lo dicen; los rótulos no lo decían.

UPDATE public.diferencia_opcion SET
    rotulo = 'Bodega manda la unidad en el sistema',
    ayuda  = 'Sale un traslado de bodega a la sala por lo que llegó de más, y la sala se queda con el producto.'
WHERE error_tipo = 'sobrante' AND valor = 'sala_se_queda';

UPDATE public.diferencia_opcion SET
    rotulo = 'La sala devuelve la unidad en físico',
    ayuda  = 'Vuelve en la próxima caja. No se mueve nada en el sistema: nunca se la dio a la sala. Bodega firma cuando la tenga.'
WHERE error_tipo = 'sobrante' AND valor = 'devolver_producto';

UPDATE public.diferencia_opcion SET
    rotulo = 'Bodega manda el producto en físico',
    ayuda  = 'Va en la próxima caja. No se mueve nada en el sistema: ya está a nombre de la sala. La sala firma cuando llegue.'
WHERE error_tipo = 'faltante' AND valor = 'enviar_producto';

UPDATE public.diferencia_opcion SET
    rotulo = 'La sala regresa la unidad en el sistema',
    ayuda  = 'Sale un traslado de la sala a bodega. El producto se queda en bodega y el sistema vuelve a decir lo mismo.'
WHERE error_tipo = 'faltante' AND valor = 'regresar_traslado';

UPDATE public.diferencia_opcion SET
    rotulo = 'La sala lo devuelve — viaja y sale del sistema',
    ayuda  = 'El producto vuelve en la próxima caja y sale del sistema de la sala. Entra a la ubicación de trabajo de bodega.'
WHERE error_tipo IN ('danado', 'vencido') AND valor = 'devolver_bodega';

UPDATE public.diferencia_opcion SET
    ayuda = 'No se mueve nada, ni en el sistema ni de lugar. Queda la decisión anotada.'
WHERE valor = 'queda_en_sala';

-- Y que se lea de un vistazo cuál es cuál.
COMMENT ON COLUMN public.diferencia_opcion.mueve IS
'En qué plano se arregla. «ninguno» = sólo físico: la decisión y la firma de '
'quien lo recibe, sin asiento. «devolucion» = traslado sala → bodega. '
'«traslado_a_sala» = traslado bodega → sala. Regla del usuario 2026-08-18.';
