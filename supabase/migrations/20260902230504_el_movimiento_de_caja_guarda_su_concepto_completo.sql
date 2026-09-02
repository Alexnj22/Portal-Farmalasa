SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El movimiento de caja guarda su concepto COMPLETO, además del recortado.
--
-- El campo de concepto del sistema de la caja mide **50 caracteres**. No es una
-- suposición: medido sobre los 2,418 movimientos que ese sistema devuelve, el
-- más largo tiene exactamente 50 y ninguno lo pasa (32 llegan al tope).
--
-- El portal recorta a 50 antes de mandar —si no lo hiciera, recortaría el otro
-- por la derecha igual, que es donde está lo que dice qué fue— y hasta hoy
-- guardaba ESE MISMO texto recortado. O sea que la cola se perdía en los dos
-- lados. Reportado sobre la remesa de $50 de Salud 4:
--
--     Remesa entregada a un cliente · MONEYGRAM · PAGO D
--     └────────────── 50 caracteres exactos ───────────┘
--
-- `detalle` guarda el texto entero. Al sistema de la caja se le sigue mandando
-- el de 50 —es lo que le cabe— y la pantalla muestra el de acá. Son dos campos
-- y no uno porque son dos verdades distintas: lo que se escribió, y lo que se
-- pudo mandar. Perder la primera para que quepa la segunda es lo que costó
-- este reporte.
--
-- Nullable a propósito: las 17 filas anteriores no tienen cómo recuperar lo que
-- se recortó, y llenarlas con el texto de 50 sería decir que ése era el
-- completo. `NULL` significa «no se guardó», y la pantalla cae al recortado.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.caja_movimientos_portal
  ADD COLUMN IF NOT EXISTS detalle text;

COMMENT ON COLUMN public.caja_movimientos_portal.detalle IS
  'El concepto COMPLETO, sin el recorte a 50 que exige el campo del sistema de '
  'la caja. `concepto` guarda lo que se mandó allá; esto, lo que se escribió. '
  'NULL en las filas anteriores al 2026-09-02: no hay de dónde recuperarlo.';
