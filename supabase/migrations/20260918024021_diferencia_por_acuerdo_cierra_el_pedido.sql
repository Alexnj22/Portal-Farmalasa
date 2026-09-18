SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Una diferencia que se cierra por ACUERDO también cierra el pedido.
--
-- `decidir_diferencia_pedido` confirma la diferencia en el acto cuando la salida
-- acordada tiene `cierra_con = 'acuerdo'` (la opción `resuelto`): no hay nada que
-- mover ni que esperar. Pero no llamaba a `cerrar_pedido_si_todo_resuelto`, que
-- los otros tres caminos de cierre sí llaman (`confirmar_llegada_diferencia`,
-- `cerrar_item_por_devolucion`, `resolve_pedido_item`). Así que un pedido cuya
-- ÚLTIMA diferencia se resolvía por acuerdo se quedaba en «parcial» para siempre.
--
-- Medido el 2026-09-17: #121, #133, #174 y #180, los cuatro con todo contado y
-- todas sus diferencias `confirmada`, las cuatro con `resolucion_tipo =
-- 'resuelto'`. Y como la tarjeta leía el estado del PEDIDO, en el #174 salía
-- «Diferencias — te toca resolver (0)» en las salas que no tenían ninguna.
--
-- Se parchea la definición VIVA con `replace()` sobre un ancla que se exige
-- única, igual que 20260831172824: reescribir el cuerpo a mano arriesga pisar lo
-- que otra migración le cambió después.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_def    text := pg_get_functiondef('public.decidir_diferencia_pedido(integer,text,text,text,jsonb)'::regprocedure);
    v_ancla  text := E'    RETURN jsonb_build_object(\n        ''estado'', v_nuevo, ''opcion'', p_tipo';
    v_nuevo  text := E'    -- Cerrada en el acto (salida que cierra por acuerdo): si era la última\n'
                  || E'    -- cosa abierta del pedido, el pedido se cierra acá. Sin esto quedaba\n'
                  || E'    -- «parcial» para siempre — ver 20260918 cerrar_por_acuerdo.\n'
                  || E'    IF v_nuevo = ''confirmada'' THEN\n'
                  || E'        PERFORM public.cerrar_pedido_si_todo_resuelto(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);\n'
                  || E'    END IF;\n\n';
    v_veces  integer;
BEGIN
    v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
    IF v_veces <> 1 THEN
        RAISE EXCEPTION 'ANCLA: se esperaba 1 aparición y hay %', v_veces;
    END IF;
    IF position('cerrar_pedido_si_todo_resuelto' IN v_def) > 0 THEN
        RAISE EXCEPTION 'YA_APLICADA: la función ya cierra el pedido';
    END IF;
    EXECUTE replace(v_def, v_ancla, v_nuevo || v_ancla);
END $$;
