-- Registro de cada DTE que la sala le entrega a un cliente (2026-10-19).
--
-- Pedido del usuario: un cliente puede pedir su documento electrónico aunque
-- sea un COF de después de las 6:00 p. m. (que no se envía a Hacienda por
-- regla). Desde «Modificar facturación» el dependiente lo pide: si no tiene
-- sello se manda a Hacienda en ese momento, y después se descarga o se envía
-- por correo el PDF y el JSON. No se le niega a nadie un documento que es suyo
-- por ley.
--
-- La edge function `dte-para-cliente` escribe aquí con la llave del servidor;
-- la anotación va ANTES del correo, como en `app_cliente_correo_envios`.
-- Sin policy de escritura: nadie la escribe desde el navegador. Append-only.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dte_entregas_cliente (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id    bigint NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  employee_id   uuid   NOT NULL REFERENCES public.employees(id),
  accion        text   NOT NULL CHECK (accion IN ('descarga', 'correo')),
  correo        text,
  -- Si esta entrega fue la que mandó el documento a Hacienda (estaba sin sello).
  se_envio_a_hacienda boolean NOT NULL DEFAULT false,
  enviado       boolean,
  proveedor_id  text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dte_entregas_cliente_invoice_idx ON public.dte_entregas_cliente (invoice_id);
CREATE INDEX IF NOT EXISTS dte_entregas_cliente_employee_idx ON public.dte_entregas_cliente (employee_id, created_at);

ALTER TABLE public.dte_entregas_cliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dte_entregas_cliente_read ON public.dte_entregas_cliente;
CREATE POLICY dte_entregas_cliente_read ON public.dte_entregas_cliente
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));
