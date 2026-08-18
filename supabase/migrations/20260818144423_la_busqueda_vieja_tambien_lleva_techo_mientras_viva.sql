SET lock_timeout = '5s';

-- La v1 no se borra todavía, pero deja de ser un agujero.
--
-- `buscar_inventario_global_v2` reemplazó a esta en el portal (v2.658.3). La v1
-- se dejó viva porque un RPC retirado sigue recibiendo llamadas de pestañas
-- abiertas con el paquete anterior — medido el 2026-08-17 con
-- `get_product_sales_agg`: once horas de llamadas después del despliegue. Si se
-- la borra, esas pestañas no quedan lentas: quedan ROTAS.
--
-- Pero dejarla intacta significaba dejar viva una consulta SIN TECHO: «a»
-- devuelve 16,722 filas y 4.8 MB, y cualquiera que todavía la llame se lleva
-- eso. Así que lleva el mismo techo por producto que la nueva.
--
-- Qué cambia para quien tenga el paquete viejo: arriba de 60 productos ve 60 y
-- no puede saber que hay más —esta función no tiene dónde decirlo, su forma de
-- respuesta es una lista y cambiarla es justo lo que rompería a esa pestaña—.
-- Es peor que la pantalla nueva y mejor que la pestaña trabada, que es la única
-- alternativa que tenía. Se arregla solo: al recargar, entra la nueva.
--
-- ESTA FUNCIÓN SE BORRA cuando no queden llamadas. Se comprueba mirando
-- `calls` de `pg_stat_statements` para `buscar_inventario_global`: si no sube
-- en 48 horas, no la llama nadie y se puede hacer DROP.
CREATE OR REPLACE FUNCTION public.buscar_inventario_global(p_search text)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
  SELECT public.buscar_inventario_global_v2(p_search, 60) -> 'filas';
$function$;

REVOKE ALL ON FUNCTION public.buscar_inventario_global(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_inventario_global(text) TO authenticated, service_role;
