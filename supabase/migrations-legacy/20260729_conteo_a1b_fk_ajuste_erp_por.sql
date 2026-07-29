SET lock_timeout = '5s';

-- created_by, finalizado_por y aprobado_por ya referencian employees. El nuevo
-- ajuste_erp_por es la misma clase de columna y va con la misma integridad.
-- Sin índice a propósito: es columna de puro audit en una tabla que crece del
-- orden de decenas al año (CLAUDE.md, excepción de la regla de FK indexada).
ALTER TABLE public.conteos_inventario
  ADD CONSTRAINT conteos_inventario_ajuste_erp_por_fkey
  FOREIGN KEY (ajuste_erp_por) REFERENCES public.employees(id);
