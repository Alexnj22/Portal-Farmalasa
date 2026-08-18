SET lock_timeout = '5s';

-- La descripción se lee pegada al rótulo, así que empezar repitiéndolo gasta la
-- mitad de la frase en algo que la persona acaba de leer:
--
--   «La sala le regresa la cantidad a bodega — Sale un traslado de la sala a
--    bodega. El producto se queda en bodega y las existencias vuelven a coincidir.»
--
-- El rótulo dice QUIÉN hace QUÉ; la ayuda tiene que decir la consecuencia, que
-- es lo que no se deduce. Sólo toca la neutra: las de cada lado ya hablan de lo
-- que le pasa a quien lee, así que no repiten nada.
UPDATE public.diferencia_opcion SET
    ayuda = 'El producto se queda en bodega y las existencias vuelven a coincidir.'
WHERE error_tipo = 'faltante' AND valor = 'regresar_traslado';

UPDATE public.diferencia_opcion SET
    ayuda = 'La cantidad de más pasa a la sala y las existencias vuelven a coincidir.'
WHERE error_tipo = 'sobrante' AND valor = 'sala_se_queda';

UPDATE public.diferencia_opcion SET
    ayuda = 'Vuelve en la próxima caja y sale un traslado de la sala a bodega.'
WHERE valor = 'devolver_bodega' AND error_tipo IN ('danado','vencido');
