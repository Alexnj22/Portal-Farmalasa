-- `anon` conservaba INSERT/UPDATE/DELETE/TRUNCATE sobre `branches`.
--
-- Hoy no puede escribir, y no por estos permisos: RLS está encendido y la tabla
-- no tiene NINGUNA policy de escritura para `anon` —ni de DELETE para nadie—,
-- así que un comando de escritura sin sesión alcanza cero filas. Verificado:
-- el UPDATE devuelve 42501 y el DELETE toca 0 filas, con las 8 sucursales
-- intactas.
--
-- Se revocan igual porque son la SEGUNDA cerradura. Son los GRANT por defecto
-- que Supabase le pone a `anon` en toda tabla del esquema público: mientras
-- estén puestos, el día que alguien agregue una policy de más —o la escriba con
-- el rol equivocado— no hay nada detrás. Sin el GRANT, esa equivocación falla
-- igual.
--
-- Sólo `branches`, que es la tabla que este trabajo auditó. Las otras 180 tienen
-- el mismo default y son una revisión aparte, no un cambio para hacer de paso.
SET lock_timeout = '5s';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.branches FROM anon;
