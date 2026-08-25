-- El producto que llegó de más es un RENGLÓN del pedido, no una fila huérfana.
--
-- Hasta hoy «¿Llegó un producto extra?» escribía en `pedido_recepcion_extras`,
-- una tabla que nadie lee: ni una línea de `src/`, ni una de las 554 funciones
-- de producción. O sea que lo anotado no aparecía en Diferencias, ni en la
-- tarjeta del pedido, ni en ningún lado — y como no falla nada, se leía como
-- «no se guardó».
--
-- Un producto que llegó y no venía en el pedido ES un sobrante: llegó en físico
-- y no llegó en el sistema. La única razón por la que no entraba por el camino
-- de las diferencias es que no tenía `pedido_item_id` contra el cual colgarse,
-- y toda la conversación (`decidir_diferencia_pedido`) entra por ahí. Se le da
-- uno: un renglón con `cantidad_enviada = 0`, y las dos salidas que el catálogo
-- ya tiene para un sobrante quedan disponibles solas.

SET lock_timeout = '5s';

-- ── 1. La marca, explícita y no deducida ──────────────────────────────────
-- Un renglón `no_enviado` también tiene 0 asignada y 0 enviada, así que
-- reconocer al extra por sus ceros lo confundiría con lo que bodega decidió no
-- mandar. Es la diferencia entre «no salió» y «llegó sin haber salido».
ALTER TABLE public.pedido_items
    ADD COLUMN IF NOT EXISTS es_extra boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pedido_items.es_extra IS
    'Llegó en la caja y NO venía en el pedido. Nace con cantidad_asignada = 0, '
    'cantidad_enviada = 0 y error_tipo = ''sobrante''. Explícito y no deducido de '
    'los ceros: un renglón ''no_enviado'' también los tiene.';

-- Los extras de un pedido son un puñado; el índice es para poder listarlos sin
-- barrer los 84 mil renglones cuando la tarjeta los pide.
CREATE INDEX IF NOT EXISTS idx_pedido_items_extra
    ON public.pedido_items (pedido_id, erp_sucursal_id)
    WHERE es_extra;

-- ── 2. Anotarlo ───────────────────────────────────────────────────────────
--
-- Se escribe EN EL MOMENTO en que se agrega, no al confirmar el pedido. Hasta
-- hoy la lista vivía en `useState` dentro de un modal montado como
-- `{modal && <RecepcionModal/>}`: cualquier cierre lo desmontaba y se llevaba
-- lo anotado sin decir nada. Escribir al agregar borra la ventana entera de
-- pérdida en vez de taparla con un borrador.
--
-- La cantidad se guarda en la MISMA unidad que el resto de los renglones: el
-- número que se contó (`cantidad_recibida`) va en paquetes de `factor`, y
-- `factor` es la presentación que eligió quien contó. Así no hay ninguna
-- división: la conversión a unidades es `cantidad × factor`, igual que en un
-- renglón normal. El código viejo dividía por el factor del producto sacado de
-- `rows` —los renglones DEL pedido—, y un extra por definición no está ahí:
-- caía a `?? 1` y un producto que viene en caja de 50 se habría guardado 50×
-- arriba.
CREATE OR REPLACE FUNCTION public.agregar_extra_a_pedido(
    p_pedido_id      uuid,
    p_sucursal_id    integer,
    p_erp_product_id integer,
    p_cantidad       integer,           -- en paquetes de p_factor
    p_factor         integer DEFAULT 1, -- la presentación con la que se contó
    p_tipo           text    DEFAULT NULL,
    p_nota           text    DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

    -- Lo anota la sala que está contando. Con alcance ALL también supervisión,
    -- que es la que destraba cuando la sala no está.
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

    -- Si el producto SÍ venía en el pedido no es un extra, es un sobrante de su
    -- propio renglón: anotarlo aparte lo contaría dos veces y dejaría dos
    -- diferencias del mismo producto conversándose por separado.
    IF EXISTS (SELECT 1 FROM public.pedido_items pi
                WHERE pi.pedido_id      = p_pedido_id
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
        p_factor, p_factor, nullif(btrim(coalesce(p_tipo, '')), ''),
        'con_diferencia', 'sobrante', true,
        now(), v_actor, v_nota
    ) RETURNING id INTO v_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
    VALUES (v_id, p_pedido_id, p_sucursal_id, 'extra_anotado', v_nota, v_actor);

    RETURN v_id;
END;
$function$;

-- ── 3. Quitarlo ───────────────────────────────────────────────────────────
-- Se equivocó de producto, o lo encontró y sí venía. Sólo mientras nadie haya
-- empezado a resolverlo: una vez que hay una propuesta en curso, el renglón ya
-- es una conversación de dos y quitarlo se la lleva.
--
-- Se ANULA, no se borra, y no es un escrúpulo: `pedido_item_eventos` apunta al
-- renglón con `ON DELETE CASCADE`, así que un DELETE se lleva por delante el
-- evento que lo explica — incluido el que se acabara de escribir para dejar
-- rastro del borrado. Anular deja las dos cosas: el renglón sale de la lista
-- de diferencias (que filtra por `con_diferencia`) y la historia queda.
CREATE OR REPLACE FUNCTION public.quitar_extra_de_pedido(p_item_id integer)
RETURNS void
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
        RAISE EXCEPTION 'NO_ES_EXTRA: ese renglón venía en el pedido y no se puede quitar';
    END IF;
    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo quita la sala que lo anotó';
    END IF;
    IF v_it.resolucion_status IS NOT NULL THEN
        RAISE EXCEPTION 'YA_EN_CURSO: esta diferencia ya se está resolviendo; '
                        'no se puede quitar sin dejar rastro';
    END IF;
    IF v_it.status = 'anulado' THEN
        RETURN;   -- ya estaba quitado: dos clics no son dos eventos
    END IF;

    UPDATE public.pedido_items
       SET status     = 'anulado',
           error_tipo = NULL
     WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'extra_quitado', NULL, v_actor);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.agregar_extra_a_pedido(uuid, integer, integer, integer, integer, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.quitar_extra_de_pedido(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agregar_extra_a_pedido(uuid, integer, integer, integer, integer, text, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.quitar_extra_de_pedido(integer) TO authenticated, service_role;
