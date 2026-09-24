SET lock_timeout = '5s';

-- La tarjeta de un aviso resuelve la cara de una persona que no está en la
-- lista del navegador —esa lista está acotada por permisos—: el conductor de un
-- pedido para la sala, o un aviso viejo que no traía la foto en el metadata.
-- `foto_de_empleado` devuelve sólo la URL guardada, y el bucket `empleados` ya
-- deja leer a cualquier sesión (policy `empleados_select`), así que abrirla a
-- `authenticated` no expone nada que no se pudiera leer. `anon` sigue sin
-- acceso.
GRANT EXECUTE ON FUNCTION public.foto_de_empleado(uuid) TO authenticated;
