SET lock_timeout = '5s';

-- El cierre de 20260817025337: ahí se creó `get_productos_por_confirmar(text,
-- integer)` y se dejó viva a propósito la firma vieja `(boolean, integer)`
-- para no romperle la pantalla a quien la tuviera abierta durante el
-- despliegue. El despliegue de v2.643.2 está READY y aliaseado a
-- portal.farmasalud.lat (verificado en Vercel), así que ya nadie la llama.
--
-- Se borra porque dos firmas que hacen casi lo mismo es justo la deriva que
-- después nadie sabe cuál es la buena — y la vieja además tiene el defecto que
-- motivó el cambio: recortaba DESPUÉS del LIMIT, así que su «Todos» no podía
-- mostrar un apartado ni un confirmado.

DROP FUNCTION IF EXISTS public.get_productos_por_confirmar(boolean, integer);
