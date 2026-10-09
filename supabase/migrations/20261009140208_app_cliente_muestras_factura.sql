SET lock_timeout = '5s';
-- Muestras de «Mis facturas» para la cuenta de prueba (2026-10-09): anulada y
-- nota de crédito agrupada con su factura.
ALTER TABLE public.app_cliente_muestras DROP CONSTRAINT app_cliente_muestras_tipo_check;
ALTER TABLE public.app_cliente_muestras ADD CONSTRAINT app_cliente_muestras_tipo_check
  CHECK (tipo = ANY (ARRAY['oferta','inyeccion','vencimiento','cumpleanos','historia','factura']));
