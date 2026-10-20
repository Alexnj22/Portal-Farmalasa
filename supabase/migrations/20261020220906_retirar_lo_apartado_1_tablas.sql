SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Retirar lo apartado o encargado: el anticipo se APLICA a la factura
-- (2026-10-20, decisión del usuario). Parte 1 de 3: dónde queda anotado.
--
-- El sistema de la caja factura y no acepta pago parcial. Así que:
--   · TODO en efectivo (el anticipo se cobró en efectivo en la caja y el resto
--     se paga en efectivo) → se factura AL CONTADO por el total y el portal
--     hace solo el VALE de salida por el anticipo: ese efectivo entró el día
--     del anticipo y la factura lo vuelve a contar.
--   · Con tarjeta, transferencia o pago en línea de por medio → se factura AL
--     CRÉDITO y el anticipo se abona a ese crédito con la forma «Recibo» y el
--     código de la reserva: no mueve efectivo (ya entró, o nunca fue
--     efectivo; un abono «Efectivo» lo volvería a sumar al esperado). El resto
--     se cobra como cualquier crédito, con su forma, o queda al crédito.
-- Cada reserva o encargo se aplica UNA vez (`apartado_aplicaciones`).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.apartado_aplicaciones (
  id            bigserial PRIMARY KEY,
  reserva_id    bigint,
  encargo_id    bigint,
  branch_id     integer NOT NULL REFERENCES public.branches(id),
  modo          text NOT NULL CHECK (modo IN ('VALE', 'CREDITO')),
  monto         numeric(12,2) NOT NULL CHECK (monto > 0),
  credito_erp   text,
  movimiento_id bigint,
  creado_por    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((reserva_id IS NULL) <> (encargo_id IS NULL)),
  CHECK (modo <> 'CREDITO' OR credito_erp IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS apartado_aplicaciones_reserva ON public.apartado_aplicaciones (reserva_id) WHERE reserva_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS apartado_aplicaciones_encargo ON public.apartado_aplicaciones (encargo_id) WHERE encargo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS apartado_aplicaciones_branch ON public.apartado_aplicaciones (branch_id);
ALTER TABLE public.apartado_aplicaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS apartado_aplicaciones_select ON public.apartado_aplicaciones;
CREATE POLICY apartado_aplicaciones_select ON public.apartado_aplicaciones FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('cortes_caja', 'can_view'))
         OR (SELECT public.auth_has_module_permission('caja_vales', 'can_view')));
REVOKE ALL ON public.apartado_aplicaciones FROM anon;
GRANT SELECT ON public.apartado_aplicaciones TO authenticated;
GRANT ALL ON public.apartado_aplicaciones TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.apartado_aplicaciones_id_seq TO service_role;

-- El vale que aplica un anticipo en efectivo. No se ofrece a mano: lo hace el
-- retiro.
INSERT INTO public.caja_tipos_movimiento
  (codigo, etiqueta, sentido, pide_boleta, pide_persona, foto, lleva_comprobante, leyenda, orden, activo, identifica_receptor)
VALUES
  ('APLICA_ANTICIPO', 'Aplicación de anticipo', 'SALIDA', false, false, 'NO', false,
   'El anticipo en efectivo de lo apartado, aplicado a su factura al contado. Lo hace el retiro.', 90, false, false)
ON CONFLICT (codigo) DO NOTHING;

-- Un vale de aplicación por reserva o encargo, vivo.
CREATE UNIQUE INDEX IF NOT EXISTS caja_movimientos_portal_aplica_reserva
  ON public.caja_movimientos_portal (reserva_id) WHERE tipo_codigo = 'APLICA_ANTICIPO' AND anulado_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS caja_movimientos_portal_aplica_encargo
  ON public.caja_movimientos_portal (encargo_id) WHERE tipo_codigo = 'APLICA_ANTICIPO' AND anulado_at IS NULL;
