-- Las dos columnas de la migración anterior no se veían desde el portal.
--
-- `impresion_dispositivos` no tiene un GRANT de tabla: tiene grants POR COLUMNA
-- —11 de 13—, porque `token` y `codigo_vinculacion` son credenciales y no
-- pueden viajar al navegador. Y un `ADD COLUMN` **no hereda** ese grant: la
-- columna nueva nace sin permiso para `authenticated`.
--
-- El síntoma no fue un error a la vista: el select entero fue rechazado, la
-- capa de datos devolvió una lista vacía y la pantalla dijo «Ninguna sala
-- imprime todavía» — un estado legítimo, con cinco cajas registradas y
-- latiendo. Un permiso que falta se ve igual que un dato que no existe.
SET lock_timeout = '5s';

GRANT SELECT (agente_version, agente_canal)
    ON public.impresion_dispositivos TO authenticated;

NOTIFY pgrst, 'reload schema';
