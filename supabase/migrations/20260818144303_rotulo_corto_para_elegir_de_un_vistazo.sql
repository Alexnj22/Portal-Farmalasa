SET lock_timeout = '5s';

-- Las dos salidas se eligen con un segmentado, no con un desplegable (§15.3 de
-- DESIGN.md: hasta tres opciones, segmentado). El punto del segmentado es
-- COMPARAR las dos de un vistazo, y para eso las etiquetas tienen que caber en
-- una fila: «La sala regresa la unidad en el sistema» en versalitas no entra en
-- media tarjeta, y partirla en dos renglones deja de leerse como un interruptor.
--
-- Así que cada salida lleva dos rótulos y cada uno tiene su trabajo:
--   · `rotulo_corto` — el de la opción. Dice EN QUÉ PLANO se arregla, que es
--     la pregunta que el usuario planteó el 2026-08-18.
--   · `rotulo` — la frase entera. Se muestra debajo, ya elegida: quién hace qué.
ALTER TABLE public.diferencia_opcion
    ADD COLUMN IF NOT EXISTS rotulo_corto text;

COMMENT ON COLUMN public.diferencia_opcion.rotulo_corto IS
'La etiqueta de la opción en el segmentado — cabe en media tarjeta. El `rotulo` '
'entero se muestra debajo, ya elegido.';

UPDATE public.diferencia_opcion SET rotulo_corto = 'En el sistema', orden = 1
 WHERE (error_tipo, valor) IN (('faltante','regresar_traslado'), ('sobrante','sala_se_queda'));

UPDATE public.diferencia_opcion SET rotulo_corto = 'En físico', orden = 2
 WHERE (error_tipo, valor) IN (('faltante','enviar_producto'), ('sobrante','devolver_producto'));

-- El mismo plano va primero en los dos tipos. Si en un renglón «el sistema» está
-- a la izquierda y en el siguiente a la derecha, cada tarjeta obliga a volver a
-- leer — y estas se miran en fila, una tras otra.
UPDATE public.diferencia_opcion SET rotulo_corto = 'Devolver', orden = 1
 WHERE valor = 'devolver_bodega' AND error_tipo IN ('danado','vencido');
UPDATE public.diferencia_opcion SET rotulo_corto = 'Se queda', orden = 2
 WHERE valor = 'queda_en_sala';

UPDATE public.diferencia_opcion SET rotulo_corto = 'Ajustar'  WHERE valor = 'ajuste_sistema';
UPDATE public.diferencia_opcion SET rotulo_corto = 'Aceptar'  WHERE valor = 'aceptar_dif_pres';
UPDATE public.diferencia_opcion SET rotulo_corto = 'Resuelto' WHERE valor = 'resuelto';
UPDATE public.diferencia_opcion SET rotulo_corto = 'Sin solución' WHERE valor = 'no_aplica';

-- Ninguna se queda sin él: la pantalla cae al `rotulo` largo si falta, y ahí
-- vuelve el problema que esta columna resuelve.
ALTER TABLE public.diferencia_opcion
    ALTER COLUMN rotulo_corto SET NOT NULL;
