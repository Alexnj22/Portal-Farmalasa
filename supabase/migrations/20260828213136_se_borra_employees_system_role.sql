SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Se borra `employees.system_role` — último paso de
-- docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- Decisión del usuario: «la verdad system role no tiene sentido, para eso está
-- el rol que es el cargo, al cual se le asignan permisos por vistas y cosas.
-- mejor hagamos más fuertes los roles y eliminemos system role».
--
-- Era un rango escrito POR PERSONA que repetía lo que el organigrama de `roles`
-- ya decía, y que podía contradecirlo: marcaba `SUPERVISOR` a la cima de la
-- empresa y `ADMIN` a un cargo que cuelga de Administrador. Hoy el escalón sale
-- del cargo (`roles.rango`), donde no puede haber dos respuestas para la misma
-- pregunta.
--
-- ── Lo que se comprobó antes de llegar acá ────────────────────────────────
--  · 0 objetos de la base la leen. El cierre se calculó TRANSITIVAMENTE —22
--    funciones y 7 triggers, no las 14 y 0 que daba el barrido por nombre—
--    porque un envoltorio esconde la columna del texto de las policies.
--  · 0 menciones vivas en el código del portal.
--  · Las 17 edge functions que la nombraban en un `select` —13 de ellas a
--    través de su copia compilada de `_shared/security.ts`— están
--    redesplegadas, cada una conservando su candado de sesión.
--  · `employees_safe` ya no la lee: publica un apodo calculado desde el rango,
--    para que los paquetes del portal viejos sigan funcionando.
--
-- ── Por qué es seguro hacerlo en caliente ─────────────────────────────────
-- `employees` tiene 48 filas y no está entre las tablas calientes que los crons
-- escriben cada minuto. Borrar una columna es metadata: no reescribe la tabla.
-- Lo único que puede tardar es CONSEGUIR el lock exclusivo, y para eso está el
-- `lock_timeout`: si no lo consigue en 5 segundos la migración se cancela sola.
-- Nunca deja el portal encolado detrás de un DDL, que es lo que costó el outage
-- del 2026-07-08.
--
-- Si esta migración falla con «canceling statement due to lock timeout», NO
-- pasó nada: se reintenta.

ALTER TABLE public.employees DROP COLUMN IF EXISTS system_role;
