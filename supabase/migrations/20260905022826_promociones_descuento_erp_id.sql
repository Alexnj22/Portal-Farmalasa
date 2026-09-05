SET lock_timeout = '5s';

-- El descuento en ventas que nació con esta promoción.
--
-- Es el id que usa el sistema de ventas, no una FK: ese descuento vive allá y
-- lo pueden borrar desde su propia pantalla. Guardarlo como FK obligaría a
-- inventar una tabla espejo que se desincroniza sola; guardarlo como número
-- deja que la pantalla pregunte «¿sigue existiendo?» cada vez, que es la
-- verdad.
--
-- `NULL` significa **esta promoción no descuenta en ventas** — que es un estado
-- legítimo y el más común: una promoción de laboratorio paga una bonificación
-- y no le baja el precio a nadie.
ALTER TABLE public.promociones
  ADD COLUMN IF NOT EXISTS descuento_erp_id integer;

COMMENT ON COLUMN public.promociones.descuento_erp_id IS
  'Id del descuento en el sistema de ventas que nació con esta promoción. NULL = no descuenta.';

-- Índice parcial: la pregunta que se hace siempre es «¿cuál es la promoción de
-- ESTE descuento?», y las filas con NULL —la mayoría— no responden nada.
CREATE INDEX IF NOT EXISTS promociones_descuento_erp_id_idx
  ON public.promociones (descuento_erp_id)
  WHERE descuento_erp_id IS NOT NULL;
