SET lock_timeout = '5s';

-- La migracion anterior creo `set_proveedor_retiene_renta`, un setter propio
-- para ese campo. Esta mal: la ficha del proveedor ya tiene UN camino de
-- escritura, `update_proveedor_manual`, que es por donde van contacto, notas,
-- alias, activo y el override de percepcion. Dos formas de escribir el mismo
-- registro se separan el dia que una gane un chequeo y la otra no — y el
-- override de percepcion (`percibe_1_override` + `percibe_1`) muestra que ahi
-- hay logica que no se puede duplicar a mano.
--
-- `retiene_renta` entra por el mismo camino y el setter suelto se elimina.
--
-- El campo es una DECISION DEL CONTADOR, no un dato observado: a diferencia de
-- `percibe_1`, que se enciende solo al verlo en un DTE, aca no hay nada en el
-- documento que diga "esto es un servicio de una persona natural". Por eso no
-- lleva override ni valor automatico — se marca a mano y punto.
CREATE OR REPLACE FUNCTION public.update_proveedor_manual(
  p_id bigint, p_contacto_nombre text, p_telefono2 text, p_nombre_cheques text,
  p_notas text, p_activo boolean, p_alias text DEFAULT NULL::text,
  p_percibe_1_override boolean DEFAULT NULL::boolean,
  p_retiene_renta boolean DEFAULT NULL::boolean
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.proveedores_maestro SET
    contacto_nombre    = p_contacto_nombre,
    telefono2          = p_telefono2,
    nombre_cheques     = p_nombre_cheques,
    notas              = p_notas,
    activo             = p_activo,
    alias              = p_alias,
    percibe_1_override = p_percibe_1_override,
    percibe_1          = coalesce(p_percibe_1_override, percibe_1),
    -- NULL significa "el formulario no lo mando", no "ponelo en false": un
    -- cliente viejo que no conozca el parametro no debe desmarcar a nadie.
    retiene_renta      = coalesce(p_retiene_renta, retiene_renta),
    updated_at         = now()
  WHERE id = p_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.set_proveedor_retiene_renta(bigint, boolean);
