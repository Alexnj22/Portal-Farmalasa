SET lock_timeout = '5s';

-- Hallazgo B-3 de la auditoría MinMax 2026-07-17: get_stock_analysis reotorgaba EXECUTE a
-- anon (INVOKER, protegida por RLS igual, pero rompe el estándar "anon no ve nada" del
-- proyecto). El frontend usa get_stock_analysis_jsonb (Patrón C) desde v2.9.28; esta queda
-- solo para compatibilidad interna.
REVOKE EXECUTE ON FUNCTION public.get_stock_analysis(integer) FROM anon;
