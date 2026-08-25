-- Corregir lo anotado sin perderlo.
--
-- El extra se escribe apenas se agrega —ésa es la mitad que evita que se pierda
-- al cerrar la pantalla—, pero quien cuenta después ajusta la cantidad, cambia
-- la presentación o escribe la nota. Sin esta función habría que elegir entre
-- las dos cosas: o se guarda al final (y se pierde), o no se puede corregir.
--
-- Sólo mientras nadie haya empezado a resolverlo. Cambiarle la cantidad a una
-- diferencia que ya tiene una propuesta en curso movería el piso de una
-- conversación de dos: la otra parte aceptó OTRO número.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.actualizar_extra_de_pedido(
    p_item_id  integer,
    p_cantidad integer,
    p_factor   integer,
    p_tipo     text DEFAULT NULL,
    p_nota     text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := auth_employee_id();
    v_it    record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT * INTO v_it FROM public.pedido_items WHERE id = p_item_id FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;
    IF NOT v_it.es_extra THEN
        RAISE EXCEPTION 'NO_ES_EXTRA: ese renglón venía en el pedido';
    END IF;
    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo corrige la sala que lo anotó';
    END IF;
    IF v_it.resolucion_status IS NOT NULL THEN
        RAISE EXCEPTION 'YA_EN_CURSO: esta diferencia ya se está resolviendo; '
                        'la cantidad es la que aceptó la otra parte';
    END IF;
    IF coalesce(p_cantidad, 0) <= 0 THEN
        RAISE EXCEPTION 'CANTIDAD_EN_CERO: escribe cuántos llegaron';
    END IF;
    IF coalesce(p_factor, 0) <= 0 THEN
        RAISE EXCEPTION 'SIN_PRESENTACION: la presentación no trae su factor';
    END IF;

    UPDATE public.pedido_items SET
        cantidad_recibida = p_cantidad,
        factor            = p_factor,
        dispatch_factor   = p_factor,
        dispatch_tipo     = coalesce(nullif(btrim(coalesce(p_tipo, '')), ''), dispatch_tipo),
        nota_diferencia   = nullif(btrim(coalesce(p_nota, '')), ''),
        -- Vuelve a quedar en pie por si se anuló y se está reponiendo.
        status            = 'con_diferencia',
        error_tipo        = 'sobrante'
    WHERE id = p_item_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.actualizar_extra_de_pedido(integer, integer, integer, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.actualizar_extra_de_pedido(integer, integer, integer, text, text) TO authenticated, service_role;
