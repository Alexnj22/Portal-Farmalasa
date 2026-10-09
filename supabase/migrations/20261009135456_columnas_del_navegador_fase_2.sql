-- Fase 2 de `columnas_que_el_navegador_puede_escribir` (2026-10-09, con OK del
-- usuario: «las apps son de prueba»). La fase 1 dejaba escribir directo las
-- columnas de la llegada, el reenvío, programar y las hojas para no romper
-- builds viejos de la app; ya no hace falta. Todos esos pasos van por sus
-- funciones SECURITY DEFINER (confirmar_llegada_pedido, confirmar_llegada_
-- reenvio, pedir_reenvio_sala, programar_entrega_sala, marcar_hojas_recibidas,
-- finalizar_sala_con_cajas), y el código quita en el mismo día el respaldo
-- de pasos sueltos.
--
-- Queda directo sólo `pedido_sucursal_status.paginas` (armado de páginas al
-- generar/finalizar). `pedido_items`: nada. `rutas` y `ruta_pedidos` siguen
-- como en la fase 1. REVOKE UPDATE de tabla también revoca los privilegios de
-- columna de esa tabla, por eso se revoca y se vuelve a dar la lista corta.
SET lock_timeout = '5s';

REVOKE UPDATE ON public.pedido_sucursal_status FROM authenticated;
GRANT  UPDATE (paginas) ON public.pedido_sucursal_status TO authenticated;

REVOKE UPDATE ON public.pedido_items FROM authenticated;
