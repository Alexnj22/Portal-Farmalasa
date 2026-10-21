SET lock_timeout = '5s';

-- El nombre de la presentación de un extra lo decide la BASE, desde el
-- catálogo, y no lo que mande la pantalla (2026-10-21).
--
-- La recepción guardaba el rótulo de pantalla («UNIDAD 1x1») y mover el
-- sobrante buscaba esa cadena entre presentaciones llamadas «UNIDAD»: falló el
-- LUBRIDERM de Bodega. El portal ya manda el tipo real, pero una app instalada
-- vieja sigue mandando el rótulo, y al cambiar la presentación sin nombre
-- `actualizar_extra_de_pedido` conservaba el nombre VIEJO con el factor nuevo.
--
-- Orden: exacto → el catálogo cuyo nombre es la primera palabra del rótulo →
-- cualquiera del catálogo con ese factor (el menor alfabético, determinista) →
-- lo que mandó la pantalla si el catálogo no tiene ese factor.
CREATE OR REPLACE FUNCTION public.tipo_de_presentacion_de_extra(
    p_product_id integer, p_factor integer, p_tipo text
) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
BEGIN
    RETURN (
    WITH pedido AS (SELECT upper(regexp_replace(btrim(coalesce(p_tipo, '')), '\s+', ' ', 'g')) AS t),
    cat AS (
        SELECT DISTINCT upper(btrim(pr.tipo)) AS tipo
          FROM public.product_precios pp
          JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
         WHERE pp.product_id = p_product_id
           AND pp.factor = p_factor
           AND pp.activo
           AND btrim(coalesce(pr.tipo, '')) <> ''
    )
    SELECT coalesce(
        (SELECT c.tipo FROM cat c, pedido p WHERE c.tipo = p.t LIMIT 1),
        (SELECT c.tipo FROM cat c, pedido p WHERE p.t LIKE c.tipo || ' %' ORDER BY length(c.tipo) DESC LIMIT 1),
        (SELECT min(c.tipo) FROM cat c),
        (SELECT nullif(p.t, '') FROM pedido p)
    ));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tipo_de_presentacion_de_extra(integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tipo_de_presentacion_de_extra(integer, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.agregar_extra_a_pedido(p_pedido_id uuid, p_sucursal_id integer, p_erp_product_id integer, p_cantidad integer, p_factor integer DEFAULT 1, p_tipo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := auth_employee_id();
    v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
    v_id    integer;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM p_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo que llegó de más lo anota la sala que recibe el pedido';
    END IF;

    IF coalesce(p_cantidad, 0) <= 0 THEN
        RAISE EXCEPTION 'CANTIDAD_EN_CERO: escribe cuántos llegaron';
    END IF;
    IF coalesce(p_factor, 0) <= 0 THEN
        RAISE EXCEPTION 'SIN_PRESENTACION: la presentación no trae su factor';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pedidos WHERE id = p_pedido_id) THEN
        RAISE EXCEPTION 'PEDIDO_NO_EXISTE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_erp_product_id) THEN
        RAISE EXCEPTION 'PRODUCTO_NO_EXISTE';
    END IF;

    IF NOT public.recepcion_corregible(p_pedido_id, p_sucursal_id) THEN
        RAISE EXCEPTION 'PLAZO_VENCIDO: un error de la recepción se reporta hasta 2 días después '
                        'de cerrarla. Pasado ese plazo lo levanta supervisión';
    END IF;

    IF EXISTS (SELECT 1 FROM public.pedido_items pi
                WHERE pi.pedido_id       = p_pedido_id
                  AND pi.erp_sucursal_id = p_sucursal_id
                  AND pi.erp_product_id  = p_erp_product_id
                  AND NOT pi.es_extra) THEN
        RAISE EXCEPTION 'YA_VENIA_EN_EL_PEDIDO: ese producto tiene su propio renglón; '
                        'escribí ahí la cantidad que contaste';
    END IF;
    IF EXISTS (SELECT 1 FROM public.pedido_items pi
                WHERE pi.pedido_id       = p_pedido_id
                  AND pi.erp_sucursal_id = p_sucursal_id
                  AND pi.erp_product_id  = p_erp_product_id
                  AND pi.es_extra
                  AND pi.status <> 'anulado') THEN
        RAISE EXCEPTION 'YA_ANOTADO: ese producto ya está anotado como llegado de más';
    END IF;

    INSERT INTO public.pedido_items (
        pedido_id, erp_sucursal_id, erp_product_id,
        cantidad_asignada, cantidad_enviada, cantidad_recibida,
        factor, dispatch_factor, dispatch_tipo,
        status, error_tipo, es_extra,
        received_at, received_by, nota_diferencia
    ) VALUES (
        p_pedido_id, p_sucursal_id, p_erp_product_id,
        0, 0, p_cantidad,
        p_factor, p_factor, public.tipo_de_presentacion_de_extra(p_erp_product_id, p_factor, p_tipo),
        'con_diferencia', 'sobrante', true,
        now(), v_actor, v_nota
    ) RETURNING id INTO v_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
    VALUES (v_id, p_pedido_id, p_sucursal_id, 'extra_anotado', v_nota, v_actor);

    PERFORM public.reabrir_diferencias_de_sala(p_pedido_id, p_sucursal_id, v_actor);

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_extra_de_pedido(p_item_id integer, p_cantidad integer, p_factor integer, p_tipo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := auth_employee_id();
    v_it    record;
    v_tipo  text;
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

    -- El nombre viejo sólo vale si el factor no cambió: conservarlo con un
    -- factor nuevo guardaba «CAJA X 10» de 1, y el movimiento no lo encuentra.
    v_tipo := public.tipo_de_presentacion_de_extra(
        v_it.erp_product_id, p_factor,
        coalesce(nullif(btrim(coalesce(p_tipo, '')), ''),
                 CASE WHEN p_factor = v_it.factor THEN v_it.dispatch_tipo END));
    IF v_tipo IS NULL THEN
        RAISE EXCEPTION 'SIN_PRESENTACION: esa presentación no está en el catálogo del producto';
    END IF;

    UPDATE public.pedido_items SET
        cantidad_recibida = p_cantidad,
        factor            = p_factor,
        dispatch_factor   = p_factor,
        dispatch_tipo     = v_tipo,
        nota_diferencia   = nullif(btrim(coalesce(p_nota, '')), ''),
        -- Vuelve a quedar en pie por si se anuló y se está reponiendo.
        status            = 'con_diferencia',
        error_tipo        = 'sobrante'
    WHERE id = p_item_id;
END;
$function$;
