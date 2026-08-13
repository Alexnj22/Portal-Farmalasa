-- Dos filas de `roles` traían un espacio al final desde la carga inicial:
--   id  9 · 'Referente de Farmacovigilancia '
--   id 22 · 'Supervisor del Departamento Medico y Enfermería '
--
-- Hoy no rompen nada porque `buscarCargo` (src/utils/roles.js) normaliza antes
-- de comparar, y porque **cero empleados** tienen esos dos cargos. Pero el
-- nombre de un cargo se muestra tal cual en el organigrama y en la pantalla de
-- Permisos, y un rótulo que termina en espacio es un dato sucio esperando a que
-- alguien lo cruce por igualdad exacta — que es justo lo que costó el bug del
-- regente de enfermería (v2.572.1).
--
-- `btrim` y no un UPDATE por id: si mañana entra otro con el mismo defecto,
-- esta migración ya dice qué es lo correcto. El WHERE evita reescribir las 23
-- filas que están bien.
SET lock_timeout = '5s';

UPDATE public.roles
   SET name = btrim(name)
 WHERE name <> btrim(name);
