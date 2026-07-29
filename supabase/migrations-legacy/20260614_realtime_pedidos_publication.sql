-- Habilita Realtime para la tabla pedidos.
-- Permite que TabRecepcion reciba notificaciones push cuando Bodega genera un pedido.
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
