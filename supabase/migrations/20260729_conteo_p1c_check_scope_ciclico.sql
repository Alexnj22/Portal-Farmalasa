SET lock_timeout = '5s';

-- El alcance CICLICO (v2.194.0) nunca se agregó al CHECK de scope_type, así que
-- CUALQUIER intento de crear un conteo cíclico fallaba al insertar — tanto el
-- programado del día 15 como el que se crea desde la vista. No lo detecté antes
-- porque solo había probado el sorteo de la muestra, no la creación del conteo.
ALTER TABLE public.conteos_inventario
  DROP CONSTRAINT IF EXISTS conteos_inventario_scope_type_check;

ALTER TABLE public.conteos_inventario
  ADD CONSTRAINT conteos_inventario_scope_type_check
  CHECK (scope_type = ANY (ARRAY['TOTAL','LABORATORIO','BAJO_RECETA','MANUAL','CICLICO']));

-- 'APROBADO' no lo escribe nadie: aprobar_conteo_inventario pone 'CERRADO'.
-- Se saca del CHECK para que el conjunto de estados válidos sea el real.
ALTER TABLE public.conteos_inventario
  DROP CONSTRAINT IF EXISTS conteos_inventario_status_check;

ALTER TABLE public.conteos_inventario
  ADD CONSTRAINT conteos_inventario_status_check
  CHECK (status = ANY (ARRAY['BORRADOR','EN_PROGRESO','FINALIZADO','CERRADO']));
