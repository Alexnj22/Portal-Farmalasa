-- Banners de MUESTRA en la Tienda Salud (2026-11-05). Usuario: «agrega algo en
-- el banner, como placeholder, así como en historias». Las muestras de una
-- ficha (`app_cliente_muestras`) ya cubrían ofertas e historias; ahora también
-- `banner`, que lee la acción `banners_mios` de app-clientes.
SET lock_timeout = '5s';
ALTER TABLE public.app_cliente_muestras DROP CONSTRAINT IF EXISTS app_cliente_muestras_tipo_check;
ALTER TABLE public.app_cliente_muestras ADD CONSTRAINT app_cliente_muestras_tipo_check
  CHECK (tipo = ANY (ARRAY['oferta','inyeccion','vencimiento','cumpleanos','historia','factura','modo_prueba','banner']));
