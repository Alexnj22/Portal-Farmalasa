-- Habilitar realtime para product_stock_params.
-- Sin esto, la suscripción postgres_changes en la vista bodega nunca recibe eventos.
-- El trigger sync_bodega_draft_from_branch actualiza filas de erp_sucursal_id=6
-- cuando una sucursal edita sus MIN/MAX. La vista bodega ahora detecta esos cambios
-- y recarga automáticamente sin necesidad de F5.
ALTER PUBLICATION supabase_realtime ADD TABLE product_stock_params;
