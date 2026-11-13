SET lock_timeout = '5s';
-- Revierte 20261113212538: se descartó la subida a mano de JSON bajados de
-- Hacienda (el usuario prefiere cargar esas compras a mano, renglón por
-- renglón). El único documento que quedó sin cuenta (id 7584) se asignó antes
-- a la cuenta de compras.
ALTER TABLE public.purchase_dte_documents ALTER COLUMN account_id SET NOT NULL;
COMMENT ON COLUMN public.purchase_dte_documents.account_id IS NULL;
