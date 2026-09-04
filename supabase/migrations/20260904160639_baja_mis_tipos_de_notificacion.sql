SET lock_timeout = '5s';

-- Se va `mis_tipos_de_notificacion`, creada hoy mismo.
--
-- Existía para llenar el desplegable de «Tipo» en `/notificaciones`. El usuario
-- mandó quitar la barra de filtros el mismo día («que no haya filter»), así que
-- se queda sin un solo llamador.
--
-- Se BORRA en vez de dejarla: una función viva que nadie llama no falla nunca,
-- así que nada la delata — se acumula, entra en el inventario de la auditoría y
-- el día que alguien la encuentre no va a saber si se usa. Volver a crearla es
-- una migración de nueve líneas si el filtro regresa.
DROP FUNCTION IF EXISTS public.mis_tipos_de_notificacion();
