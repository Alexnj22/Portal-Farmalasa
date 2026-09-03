-- `puntos_cliente_por_documento` no es para el navegador.
--
-- La llama UNA edge function con service_role. Supabase le concede EXECUTE a
-- `authenticated` por defecto, así que revocarle sólo a PUBLIC y a `anon` la
-- dejaba adentro: cualquiera de las cuarenta y pico de personas con sesión podía
-- pedirle la ficha —y desde hoy también el DUI— de un cliente a partir de un
-- código de acceso, saltándose el freno por IP que protege la puerta pública.
--
-- Lo levantó `npm run gate:migrations`. La declaración anterior tenía el mismo
-- hueco; se cierra acá para las dos.
SET lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.puntos_cliente_por_documento(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_cliente_por_documento(text, text) TO service_role;

-- La vieja, que quedó sin usar cuando el documento pasó a ser más que un DUI,
-- tenía el mismo hueco y sigue existiendo por si hay que volver atrás.
REVOKE EXECUTE ON FUNCTION public.puntos_cliente_por_dui_y_telefono(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_cliente_por_dui_y_telefono(text, text) TO service_role;
