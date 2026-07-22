-- Superado por classify_purchase_dte_review (20260722170000) — el botón
-- suelto en el detalle del documento se reemplazó por la clasificación en
-- Revisión, a pedido del usuario. Sin otros callers.
SET lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.set_purchase_dte_invalidado(bigint, boolean, text);
