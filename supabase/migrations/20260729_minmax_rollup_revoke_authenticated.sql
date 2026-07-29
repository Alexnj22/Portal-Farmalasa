-- F3.1 (correccion) — refresh_product_sales_rollup no debe ser ejecutable por
-- usuarios.
--
-- Lo detecto el advisor de seguridad de Supabase despues de aplicar F3.1:
--   WARN authenticated_security_definer_function_executable
--   "Function public.refresh_product_sales_rollup() can be executed by the
--    `authenticated` role as a SECURITY DEFINER function via /rest/v1/rpc/..."
--
-- La migracion original hizo `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO
-- service_role`, pero el proyecto tiene un GRANT por defecto de EXECUTE a
-- `authenticated` sobre las funciones de public, y revocarle a PUBLIC no le quita
-- el grant propio. El ACL quedo con `authenticated=X`, a diferencia de sus dos
-- hermanas (refresh_product_sales_monthly_agg y refresh_sales_daily_stats), que
-- solo tienen service_role.
--
-- No es una fuga de datos — no devuelve nada — pero cualquier usuario logueado
-- podia disparar a voluntad un recalculo completo (escaneo de 180 dias de
-- sales_invoice_items) tantas veces como quisiera. Solo la llama el cron.

SET lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.refresh_product_sales_rollup() FROM authenticated;
