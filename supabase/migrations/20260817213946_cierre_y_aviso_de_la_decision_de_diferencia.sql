SET lock_timeout = '5s';

-- ⚠️ La versión VIVA de `confirmar_llegada_diferencia` es la de
-- `20260817214322_supervision_no_es_alcance_todas_las_salas.sql`, que corrige
-- la guarda de quién puede dar por llegado un producto.

-- ── 1 · Confirmar que el producto llegó ────────────────────────────────────
-- Las dos salidas que NO mueven nada en el sistema igual tienen que cerrarse
-- con alguien viendo el producto: «que bodega mande el producto» la cierra la
-- SALA cuando llega, y «devolver el producto» la cierra BODEGA cuando vuelve.
-- Es la misma regla que la entrada de una devolución — nunca se firma sola.
CREATE OR REPLACE FUNCTION public.confirmar_llegada_diferencia(p_item_id integer, p_nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor   uuid := auth_employee_id();
    v_it      record;
    v_op      record;
    v_es_sala boolean;
    v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT pi.* INTO v_it FROM public.pedido_items pi WHERE pi.id = p_item_id FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;
    IF v_it.resolucion_status <> 'acordada' THEN
        RAISE EXCEPTION 'SIN_ACUERDO: todavía no hay una decisión acordada sobre este renglón';
    END IF;

    SELECT * INTO v_op FROM public.diferencia_opcion
     WHERE error_tipo = v_it.error_tipo AND valor = v_it.resolucion_tipo;
    IF v_op.cierra_con NOT IN ('llegada_sala', 'llegada_bodega') THEN
        RAISE EXCEPTION 'NO_SE_CIERRA_ASI: esta decisión no se cierra confirmando una llegada';
    END IF;

    v_es_sala := auth_employee_erp_sucursal_id() IS NOT DISTINCT FROM v_it.erp_sucursal_id;

    IF v_op.cierra_con = 'llegada_sala' AND NOT v_es_sala
       AND NOT auth_can_edit_scope_all(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'LO_CONFIRMA_LA_SALA: el producto llega a la sala, y la sala es quien lo ve';
    END IF;
    IF v_op.cierra_con = 'llegada_bodega' AND v_es_sala
       AND NOT auth_can_edit_scope_all(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'LO_CONFIRMA_BODEGA: el producto vuelve a bodega, y bodega es quien lo ve';
    END IF;

    UPDATE public.pedido_items SET
        resolucion_status   = 'confirmada',
        resolucion_vence_at = NULL,
        resolucion_nota     = coalesce(v_nota, resolucion_nota),
        confirmado_suc_por  = v_actor,
        confirmado_suc_at   = now()
    WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'diferencia_llegada',
            v_it.resolucion_tipo, v_nota, v_actor);

    PERFORM public.cerrar_pedido_si_todo_resuelto(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);

    RETURN jsonb_build_object('estado', 'confirmada');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_llegada_diferencia(integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_llegada_diferencia(integer, text) TO authenticated, service_role;


-- ── 2 · Qué cuenta como resuelto ───────────────────────────────────────────
-- El vocabulario creció: hoy hay «acordada» (hay acuerdo pero el producto
-- todavía no llegó) y «escalada» (la está mirando supervisión). Enumerar los
-- estados abiertos obliga a acordarse de esta función cada vez que aparece uno
-- nuevo — y el que se olvide cierra pedidos que no terminaron. Se invierte:
-- lo único terminado es «confirmada».
CREATE OR REPLACE FUNCTION public.cerrar_pedido_si_todo_resuelto(p_pedido_id uuid, p_suc_id integer, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    -- Todavía se está contando: ni se cierra el pedido ni se firma la
    -- corrección de la sala — pueden aparecer diferencias nuevas en las hojas
    -- que faltan. (Incidente del pedido 116, 2026-08-17.)
    IF EXISTS (
        SELECT 1 FROM public.pedido_items
        WHERE  pedido_id = p_pedido_id AND status = 'pendiente'
    ) THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.pedido_items
        WHERE  pedido_id = p_pedido_id
          AND  status = 'con_diferencia'
          AND  resolucion_status IS DISTINCT FROM 'confirmada'
    ) THEN
        RETURN;
    END IF;

    UPDATE public.pedidos SET status = 'completado' WHERE id = p_pedido_id;
    UPDATE public.pedido_sucursal_status
       SET confirmado_correccion_at  = now(),
           confirmado_correccion_por = p_actor
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_suc_id;
END;
$function$;


-- ── 3 · Que la otra parte se entere ────────────────────────────────────────
-- Sin esto la decisión se ve SÓLO si alguien abre la tarjeta de ese pedido y
-- baja hasta el bloque de diferencias. Medido el 2026-08-17: la primera
-- devolución del portal se resolvió en 6 minutos porque las dos partes estaban
-- trabajando el pedido en vivo; con el pedido de ayer se habría quedado ahí.
--
-- Va en la base y no en la pantalla a propósito: un aviso que escribe el
-- navegador se pierde cuando la computadora de la sala se apaga justo después
-- de apretar, que es cuando más falta hace.
CREATE OR REPLACE FUNCTION public.notificar_decision_diferencia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_prod    text;
    v_num     integer;
    v_sala    text;
    v_sala_b  integer;
    v_bodega  integer;
    v_rotulo  text;
    v_titulo  text;
    v_cuerpo  text;
    v_dest    uuid[];
BEGIN
    SELECT p.numero INTO v_num FROM public.pedidos p WHERE p.id = NEW.pedido_id;
    SELECT pr.nombre INTO v_prod FROM public.products pr WHERE pr.id = NEW.erp_product_id;
    SELECT m.nombre, m.branch_id INTO v_sala, v_sala_b
      FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = NEW.erp_sucursal_id;
    SELECT m.branch_id INTO v_bodega FROM public.erp_sucursal_map m WHERE m.es_bodega;

    SELECT o.rotulo INTO v_rotulo FROM public.diferencia_opcion o
     WHERE o.error_tipo = NEW.error_tipo AND o.valor = NEW.resolucion_tipo;

    v_prod := coalesce(v_prod, 'un producto');

    IF NEW.resolucion_status = 'propuesta' THEN
        v_titulo := 'Te piden una decisión';
        v_cuerpo := coalesce(v_sala, 'Una sala') || ' propone: ' || coalesce(v_rotulo, '—')
                 || ' · ' || v_prod || ' del pedido #' || coalesce(v_num::text, '?');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id = v_bodega AND e.id <> coalesce(NEW.resuelto_por, e.id);

    ELSIF NEW.resolucion_status = 'contrapropuesta' THEN
        v_titulo := 'Bodega propone otra salida';
        v_cuerpo := 'Bodega propone: ' || coalesce(v_rotulo, '—')
                 || ' · ' || v_prod || ' del pedido #' || coalesce(v_num::text, '?');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id = v_sala_b AND e.id <> coalesce(NEW.resuelto_por, e.id);

    ELSIF NEW.resolucion_status = 'escalada' THEN
        v_titulo := 'Una diferencia sin acuerdo';
        v_cuerpo := coalesce(v_sala, 'Una sala') || ' y bodega no coinciden sobre ' || v_prod
                 || ' del pedido #' || coalesce(v_num::text, '?')
                 || coalesce(' — ' || NEW.nota_rechazo, '');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.system_role IN ('SUPERVISOR','ADMIN','SUPERADMIN');

    ELSIF NEW.resolucion_status IN ('acordada', 'confirmada') THEN
        v_titulo := CASE WHEN NEW.resolucion_status = 'confirmada'
                         THEN 'Diferencia cerrada' ELSE 'Quedaron de acuerdo' END;
        v_cuerpo := coalesce(v_rotulo, '—') || ' · ' || v_prod
                 || ' del pedido #' || coalesce(v_num::text, '?');
        -- A las dos partes: el acuerdo le cambia el trabajo a los dos lados.
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id IN (v_sala_b, v_bodega)
           AND e.id <> coalesce(NEW.confirmado_suc_por, NEW.supervisado_por, e.id);
    ELSE
        RETURN NEW;
    END IF;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'PEDIDO_DIFERENCIA', v_titulo, v_cuerpo, '/pedidos',
           jsonb_build_object('pedido_id', NEW.pedido_id, 'pedido_item_id', NEW.id,
                              'erp_sucursal_id', NEW.erp_sucursal_id, 'estado', NEW.resolucion_status),
           v_sala_b, coalesce(NEW.resuelto_por, NEW.confirmado_suc_por)
      FROM unnest(v_dest) d;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notificar_decision_diferencia ON public.pedido_items;

-- El `WHEN` es lo que lo hace seguro sobre una tabla que se escribe de a
-- cientos de renglones: `receive_pedido_sucursal` nunca toca `resolucion_status`,
-- así que en una recepción entera este disparador no corre ni una vez.
CREATE TRIGGER trg_notificar_decision_diferencia
    AFTER UPDATE ON public.pedido_items
    FOR EACH ROW
    WHEN (OLD.resolucion_status IS DISTINCT FROM NEW.resolucion_status)
    EXECUTE FUNCTION public.notificar_decision_diferencia();
