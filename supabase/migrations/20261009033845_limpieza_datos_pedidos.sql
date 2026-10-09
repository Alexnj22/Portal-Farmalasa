-- 16 · Limpieza de datos de Pedidos (2026-10-09). Con OK del usuario, en las
-- opciones recomendadas. Cada bloque se verificó antes con su SELECT contra
-- producción (filas idénticas a las medidas el 2026-10-08) y cada UPDATE va
-- acotado a esas filas exactas y a su estado actual: si algo ya cambió, no
-- toca nada.
--
-- A. Rutas 7, 8, 9, 13 y 15 «en ruta» desde el 19-20 de agosto, con todas sus
--    salas ya recibidas: se cierran sin marcar `entregado_at` (marcarlo
--    mandaría «el conductor llegó» siete semanas tarde).
-- B. 12 pedidos «completado» del 10-13 de agosto con 3,197 renglones
--    «pendiente» que se recibieron por fuera del portal: los renglones pasan a
--    `anulado`. No se inventan cantidades recibidas.
-- C. La pausa abierta del #111 (Salud 3) desde el 14-ago: se cierra con
--    duración 0, para no contaminar los promedios de tiempo.
-- D. La devolución DEV-P116-PO-H2-I76009 en `error` («ya no tiene existencia»):
--    pasa a `rechazada` con su motivo.
-- E. Los dos renglones `acordada` del #116 (Salud 5) pasan a `confirmada` y la
--    sala se cierra con la función de siempre. Dispara el aviso de decisión
--    (`trg_notificar_decision_diferencia`): correcto, se cierra su caso.
-- F (#176, escalada) NO se toca: la decide supervisión en el portal.
SET lock_timeout = '5s';

-- A
UPDATE public.rutas r
   SET status = 'completada',
       vuelta_base_at = (SELECT max(s.llegada_fisica_at) FROM public.ruta_pedidos rp
                           JOIN public.pedido_sucursal_status s ON s.pedido_id = rp.pedido_id AND s.erp_sucursal_id = rp.erp_sucursal_id
                          WHERE rp.ruta_id = r.id),
       notes = concat_ws(E'\n', nullif(r.notes, ''), '[Cierre a mano 2026-10] Quedó «en ruta»; todas sus salas ya habían recibido.')
 WHERE r.numero IN (7, 8, 9, 13, 15) AND r.status = 'en_ruta';

-- B
UPDATE public.pedido_items i
   SET status = 'anulado'
  FROM public.pedidos p, public.pedido_sucursal_status s
 WHERE p.id = i.pedido_id AND s.pedido_id = i.pedido_id AND s.erp_sucursal_id = i.erp_sucursal_id
   AND p.numero IN (92, 93, 94, 95, 96, 97, 105, 106, 107, 108, 110, 111)
   AND p.status = 'completado'
   AND s.llegada_fisica_at IS NULL AND s.recibido_erp_at IS NULL
   AND i.status = 'pendiente';

-- C
UPDATE public.pedido_pausa_historial SET reanudado_at = pausado_at
 WHERE id = 'bd17eb63-c0ae-49e7-a977-ff24d47435f7' AND reanudado_at IS NULL;
UPDATE public.pedido_sucursal_status s SET reanudado_at = s.pausado_at
  FROM public.pedidos p
 WHERE p.id = s.pedido_id AND p.numero = 111 AND s.erp_sucursal_id = 3 AND s.reanudado_at IS NULL;

-- D
UPDATE public.pedido_devolucion
   SET estado = 'rechazada',
       motivo_rechazo = 'Cerrada a mano (2026-10): la sala ya no tenía existencia; el producto nunca llegó y el sistema ya lo había descontado.',
       updated_at = now()
 WHERE clave = 'DEV-P116-PO-H2-I76009' AND estado = 'error';

-- E
UPDATE public.pedido_items
   SET resolucion_status = 'confirmada', confirmado_suc_at = now()
 WHERE id IN (76009, 76153) AND resolucion_status = 'acordada';
INSERT INTO public.pedido_item_eventos (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota)
SELECT i.id, i.pedido_id, i.erp_sucursal_id, 'resolucion_confirmada', 'Cerrado a mano (2026-10), limpieza de diferencias viejas.'
  FROM public.pedido_items i WHERE i.id IN (76009, 76153) AND i.resolucion_status = 'confirmada';
SELECT public.cerrar_pedido_si_todo_resuelto(i.pedido_id, i.erp_sucursal_id, NULL)
  FROM public.pedido_items i WHERE i.id = 76009;
