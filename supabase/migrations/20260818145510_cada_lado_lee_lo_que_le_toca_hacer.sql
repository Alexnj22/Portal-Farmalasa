SET lock_timeout = '5s';

-- Pedido del usuario (2026-08-18): que cada opción explique qué significa
-- **para quien la está mirando**.
--
-- Y no es la misma frase con otras palabras: en cada salida hay uno que manda y
-- otro que recibe, así que «la sala regresa la unidad» le dice a la sala lo que
-- tiene que hacer y a bodega lo que le va a llegar. Una sola frase neutra
-- obliga a cada quien a traducirla a su lado, que es justo el trabajo que la
-- pantalla tiene que ahorrar.
ALTER TABLE public.diferencia_opcion
    ADD COLUMN IF NOT EXISTS ayuda_sala   text,
    ADD COLUMN IF NOT EXISTS ayuda_bodega text;

COMMENT ON COLUMN public.diferencia_opcion.ayuda_sala IS
'Qué significa esta salida para la SALA, en segunda persona. `ayuda` queda como '
'la descripción neutra, para quien no es ninguna de las dos partes.';

UPDATE public.diferencia_opcion SET
    ayuda_sala   = 'Le regresas esa cantidad a bodega en el sistema. No mandas nada: el producto nunca salió de allá.',
    ayuda_bodega = 'La sala te regresa esa cantidad en el sistema. El producto ya está aquí; sólo confirmas la entrada.'
WHERE error_tipo = 'faltante' AND valor = 'regresar_traslado';

UPDATE public.diferencia_opcion SET
    ayuda_sala   = 'Bodega te manda el producto en la próxima caja. Confirmas cuando llegue, y hay 3 días de plazo.',
    ayuda_bodega = 'Le mandas el producto a la sala en la próxima caja. Hay 3 días de plazo.'
WHERE error_tipo = 'faltante' AND valor = 'enviar_producto';

UPDATE public.diferencia_opcion SET
    ayuda_sala   = 'Te quedas con lo que llegó de más. Bodega te lo pasa en el sistema y queda a tu nombre.',
    ayuda_bodega = 'Le pasas esa cantidad a la sala en el sistema. El producto ya está allá.'
WHERE error_tipo = 'sobrante' AND valor = 'sala_se_queda';

UPDATE public.diferencia_opcion SET
    ayuda_sala   = 'Devuelves el producto en la próxima caja. No se mueve nada en el sistema: nunca fue tuyo.',
    ayuda_bodega = 'La sala te devuelve el producto en la próxima caja. Confirmas cuando lo tengas.'
WHERE error_tipo = 'sobrante' AND valor = 'devolver_producto';

UPDATE public.diferencia_opcion SET
    ayuda_sala   = 'El producto vuelve a bodega en la próxima caja y sale de tu existencia.',
    ayuda_bodega = 'La sala te devuelve el producto. Entra a la ubicación de trabajo cuando confirmes que lo tienes.'
WHERE valor = 'devolver_bodega' AND error_tipo IN ('danado','vencido');

UPDATE public.diferencia_opcion SET
    ayuda_sala   = 'Te quedas con el producto. No se mueve nada en el sistema.',
    ayuda_bodega = 'El producto se queda en la sala. No se mueve nada en el sistema.'
WHERE valor = 'queda_en_sala';

UPDATE public.diferencia_opcion SET
    ayuda_sala   = 'Se corrige en el sistema para que coincida con lo que tienes.',
    ayuda_bodega = 'Se corrige en el sistema para que coincida con lo que llegó a la sala.'
WHERE valor = 'ajuste_sistema';

UPDATE public.diferencia_opcion SET
    ayuda_sala   = 'Se deja como está y el renglón se cierra.',
    ayuda_bodega = 'Se deja como está y el renglón se cierra.'
WHERE valor IN ('aceptar_dif_pres', 'resuelto', 'no_aplica');
