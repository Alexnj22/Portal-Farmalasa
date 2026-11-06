SET lock_timeout = '5s';

-- Deshacer un paso a vencidos: lo que se mandó por error vuelve al estante
-- (`vencidos_a_estante` de `cargar-compra-erp`). La fila no se borra: queda
-- `devuelto` con quién lo devolvió y el traslado de vuelta.
ALTER TABLE public.bodega_a_vencidos
  DROP CONSTRAINT bodega_a_vencidos_estado_check,
  ADD CONSTRAINT bodega_a_vencidos_estado_check
    CHECK (estado IN ('enviando', 'en_vencidos', 'sin_verificar', 'fallido', 'devolviendo', 'devuelto')),
  ADD COLUMN devuelto_at timestamptz,
  ADD COLUMN devuelto_por uuid REFERENCES public.employees(id),
  ADD COLUMN devuelto_traslado_id text;
