-- URGENTE: la migración 20260826215803 dejó el portal sin login.
--
-- `employees_safe` es `security_invoker = true`, o sea que la lee con los
-- privilegios de QUIEN llama. Y desde `20260826202621` el permiso de
-- `employees` es POR COLUMNA: `authenticated` tenía SELECT sobre 88 de las 101,
-- no sobre la tabla entera.
--
-- Agregarle `tipo_ficha` a la vista sin agregar su GRANT hizo que TODA lectura
-- de `employees_safe` respondiera `permission denied for column tipo_ficha` —
-- no la columna nueva: la vista completa. Con eso el arranque de sesión no
-- terminaba y el portal se quedaba en la pantalla de ingreso. Ventana medida:
-- 2026-08-26 21:58:03 → 22:07 UTC (~9 min). Ninguna cuenta de portal
-- (`@farmalasa.app`) inició sesión dentro de la ventana; las sesiones ya
-- abiertas sí pudieron ver errores en cualquier pantalla que lea el padrón.
--
-- La lección, y es la SEGUNDA vez en el mismo día (ver
-- `el_regrant_que_le_falto_a_la_migracion_anterior`): con permiso por columna,
-- **una columna nueva nace sin permiso**. Añadirla a una vista `security_invoker`
-- no es aditivo — rompe la vista entera para todo el que no la tenga. El GRANT
-- va en la MISMA migración que la columna.
SET lock_timeout = '5s';

GRANT SELECT (tipo_ficha) ON public.employees TO authenticated;
