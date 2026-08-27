-- ── La cuenta de pruebas no vive en ninguna sala ──────────────────────────
--
-- Pedido del usuario el 2026-08-27, mirando `/personal`: «el de QA que no esté
-- en Salud 1, por defecto que esté sin sucursal; cuando se hagan pruebas que se
-- le asigne una sucursal y al finalizar se le quite».
--
-- `QA Testing` (code 99999, `tipo_ficha = 'tecnica'`) estaba en Salud 1, así que
-- Salud 1 mostraba «1 persona» que no es una persona y el equipo de esa sala
-- cargaba con una cuenta del sistema. Es el mismo error que arregló
-- 20260826215803 —una cuenta técnica anotada como personal permanente— visto
-- desde la sala en vez de desde la planilla.
--
-- Sin sede es el estado POR DEFECTO, no un pendiente: es lo que ya tiene el
-- `Administrador del Sistema`. La sala se le presta mientras se prueba algo que
-- necesita una, y se le quita al terminar.
SET lock_timeout = '5s';

UPDATE public.employees
   SET branch_id = NULL
 WHERE code = '99999'
   AND tipo_ficha = 'tecnica';
