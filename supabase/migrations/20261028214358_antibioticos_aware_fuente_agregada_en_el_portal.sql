SET lock_timeout = '5s';
-- `antibiotico_agregar_molecula` (20261028205607) escribe la fuente «Agregada
-- en el portal», y el CHECK de la tabla sólo aceptaba las tres de la siembra:
-- agregar una molécula fallaba siempre. Se vio al agregar sultamicilina y
-- cefepima el mismo día.
ALTER TABLE public.antibioticos_aware DROP CONSTRAINT antibioticos_aware_fuente_check;
ALTER TABLE public.antibioticos_aware ADD CONSTRAINT antibioticos_aware_fuente_check
  CHECK (fuente IN ('LOM 2026', 'OMS AWaRe 2023', 'sin clasificar', 'Agregada en el portal'));
