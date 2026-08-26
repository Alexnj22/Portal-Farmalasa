-- La migración anterior (20260826210244) agregó nueve columnas a
-- `employees_safe` y NO llamó a `regrant_employees_columns()`.
--
-- Consecuencia inmediata y medida: ocho columnas de la vista quedaron sin
-- GRANT por columna sobre `employees`, y como la vista es
-- `security_invoker = true`, **toda** lectura de `employees_safe` empieza a
-- fallar con 403 «permission denied for table employees» — no sólo la de esas
-- ocho. Se lleva puesto el arranque del portal, porque el padrón sale de ahí.
--
-- Es EXACTAMENTE el mismo defecto que 20260826202621 vino a arreglar horas
-- antes, cometido de nuevo por otra sesión el mismo día. Y ésa es la lección
-- que vale anotar: aquella migración eliminó la lista duplicada —la función
-- ahora deriva las columnas de la vista— pero dejó la LLAMADA como paso
-- manual. Un paso manual al final de un archivo largo no es una regla: no
-- falla, no avisa, y el siguiente que agrega una columna no lo lee.
--
-- Se aplica como migración propia y no se esconde dentro de la anterior a
-- propósito: la historia tiene que decir lo que pasó de verdad. El regrant se
-- corrió en vivo apenas se detectó; esto lo deja asentado y hace que un replay
-- del historial termine en el mismo estado.
--
-- **Regla, hasta que exista un trigger que lo haga solo: toda migración que
-- toque `employees_safe` termina con esta línea.**

SET lock_timeout = '5s';

SELECT public.regrant_employees_columns();
