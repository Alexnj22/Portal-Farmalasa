-- El traslado NO entra en «avisar a todos los que pueden aprobar».
--
-- Medido justo después de aplicar la migración anterior: `traslados.can_approve`
-- lo tienen **44 de los 46 empleados activos**. No es un error de configuración
-- —lo confirmó el usuario—: ahí «aprobar» significa «confirmar el envío que me
-- piden», y como son envíos ENTRE SALAS, la facultad es de la sala que tiene el
-- producto, acotada por su alcance. Es correcto que sea amplia.
--
-- Pero eso mismo la hace un pésimo criterio para avisar. Un traslado ya notifica
-- a algo más preciso: su lista de `destinatarios`, que es la gente de la sala
-- involucrada. Como esa lista se toma primero, en el camino normal no se nota
-- nada. El problema es el día que una solicitud llegue sin ella: el aviso —y el
-- push— saldrían a toda la plantilla.
--
-- Devolviendo NULL, `puede_aprobar_modulo` da falso para todos, la lista se
-- queda con el aprobador designado y el comportamiento vuelve a ser el de
-- antes. El caso raro degrada a lo conocido en vez de a un envío masivo.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.modulo_de_notificacion(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN p_type = 'INVENTORY_TRANSFER_REQUEST' THEN NULL
    ELSE coalesce(public.modulo_de_aprobacion(p_type), 'requests_personales')
  END;
$$;

COMMENT ON FUNCTION public.modulo_de_notificacion(text) IS
  'A quienes avisar de una solicitud nueva, por modulo. NULL para traslados: los avisa su propia lista de destinatarios, y su can_approve lo tiene casi toda la plantilla.';
