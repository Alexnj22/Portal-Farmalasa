SET lock_timeout = '5s';

-- La recepción en sala pasa a contarse POR HOJA (la del papel de despacho), no
-- por caja: quien recibe tiene la hoja en la mano y va tachando renglones, y
-- una hoja puede venir repartida entre varias cajas —en el pedido #114 de La
-- Popular, la hoja 1 viaja en las cajas 1, 2 y 3—.
--
-- Columna nueva y no reutilizar `cajas_recibidas`: ahí se anota qué CAJAS
-- llegaron completas y en buen estado, que sigue siendo su propia pregunta
-- (la del paso de llegada). Guardar hojas bajo un nombre que dice «cajas» es
-- exactamente el enredo que este cambio viene a deshacer.
ALTER TABLE public.pedido_sucursal_status
  ADD COLUMN IF NOT EXISTS hojas_recibidas jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.pedido_sucursal_status.hojas_recibidas IS
  'Números de hoja del despacho ya contados en sala. Las hojas salen de pagina_items; cajas_recibidas es otra cosa (qué cajas llegaron bien).';
