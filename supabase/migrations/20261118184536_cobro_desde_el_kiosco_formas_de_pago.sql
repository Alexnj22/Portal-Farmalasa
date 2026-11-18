SET lock_timeout = '5s';

-- Las formas de pago del cobro desde el kiosco (2026-11-18). El usuario: todas
-- las de la caja deben estar (efectivo, crédito, tarjeta, cheque, bitcoin,
-- transferencia o remesa), aunque algunas no se usen, y mejoradas: en la caja
-- son un texto libre en «datos extra».
--   · `pago`: la forma de pago, con los nombres del portal.
--   · `detalle`: lo que la caja no pide y el corte necesita: el POS y la
--     boleta de una tarjeta, el banco y la referencia de una transferencia, el
--     número de un cheque. A la caja le llega como texto ordenado en
--     `datos_extras`.
ALTER TABLE public.cobro_kiosco_cobros
  ADD COLUMN IF NOT EXISTS pago text NOT NULL DEFAULT 'contado',
  ADD COLUMN IF NOT EXISTS detalle jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cobro_kiosco_cobros_pago_check') THEN
    ALTER TABLE public.cobro_kiosco_cobros ADD CONSTRAINT cobro_kiosco_cobros_pago_check
      CHECK (pago IN ('contado', 'credito', 'tarjeta', 'cheque', 'bitcoin', 'transferencia'));
  END IF;
END $$;

-- Para frenar una boleta de tarjeta cobrada dos veces (misma terminal, mismo
-- número y mismo monto: `docs/reglas/boleta-unica-por-emisor.md`).
CREATE INDEX IF NOT EXISTS idx_cobro_kiosco_cobros_boleta
  ON public.cobro_kiosco_cobros ((detalle->>'terminal'), (detalle->>'boleta'))
  WHERE pago = 'tarjeta';
