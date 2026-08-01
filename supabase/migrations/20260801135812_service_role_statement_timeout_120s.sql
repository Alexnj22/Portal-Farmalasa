SET lock_timeout = '5s';

-- El camino del cron (edge function -> PostgREST como service_role) tenia MENOS
-- techo que un usuario logueado del portal: service_role no traia
-- statement_timeout propio, asi que regia el de `authenticator` (8s), contra
-- los 120s de `authenticated`. Un trabajo de fondo con menos margen que una
-- pantalla es al reves de lo que corresponde, y es la mitad de por que el
-- recalculo mensual de MIN/MAX murio en La Popular el 2026-08-01 mientras el
-- recalculo manual de la misma sucursal paso sin problema.
--
-- OJO: colgarle `SET statement_timeout` a la FUNCION no sirve — probado. El
-- temporizador se arma al inicio de la sentencia con el valor del que llama y
-- la funcion no lo re-arma, asi que una funcion con SET '60s' llamada bajo un
-- timeout de 2s igual muere a los 2s. El unico lugar que funciona es el rol.
ALTER ROLE service_role SET statement_timeout = '120s';

-- PostgREST cachea los settings por rol; sin esto sigue aplicando los viejos.
NOTIFY pgrst, 'reload config';
