SET lock_timeout = '5s';
-- Funciones de trigger: nadie las llama desde el navegador.
REVOKE EXECUTE ON FUNCTION public.compra_cerrar_pedidos_al_resolver() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compra_cerrar_pedidos_de_vence() FROM PUBLIC, anon, authenticated;
