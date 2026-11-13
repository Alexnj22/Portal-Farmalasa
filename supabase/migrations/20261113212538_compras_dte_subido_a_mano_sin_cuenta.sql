SET lock_timeout = '5s';
-- Un documento de compra subido a mano (bajado de «Consultar DTE Recibidos» en
-- el portal de Hacienda) no llegó por ninguna cuenta de correo: account_id NULL.
-- Quién lo subió queda en source_message_id = 'subido-a-mano:<empleado>'.
-- REVERTIDA el mismo día por 20261113222245 (la función se descartó).
ALTER TABLE public.purchase_dte_documents ALTER COLUMN account_id DROP NOT NULL;
COMMENT ON COLUMN public.purchase_dte_documents.account_id IS
  'Cuenta de correo por la que llegó. NULL = subido a mano desde el portal (JSON bajado de Hacienda); ver source_message_id.';
