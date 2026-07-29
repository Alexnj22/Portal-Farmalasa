SET lock_timeout = '5s';

-- Hallazgo del /code-review de cierre de la auditoría MinMax 2026-07-17
-- (angle de convenciones CLAUDE.md): approve_minmax_requests_bulk (función
-- nueva de esta sesión) quedó con EXECUTE otorgado a anon por default de
-- Postgres al crear la función — se me olvidó el REVOKE/GRANT que sí puse en
-- get_network_summary_json. De paso: approve_minmax_request y
-- get_pedido_preview (pre-existentes, solo tocadas con CREATE OR REPLACE en
-- esta sesión, que preserva los grants viejos) también tenían anon desde
-- antes. Riesgo práctico bajo (SECURITY INVOKER + las policies de RLS de
-- minmax_change_requests/product_stock_params solo aplican a "authenticated",
-- así que anon obtiene 0 filas por default-deny), pero viola la regla
-- explícita del proyecto (CLAUDE.md #4: REVOKE EXECUTE ... FROM PUBLIC, anon
-- en toda función nueva).
REVOKE ALL ON FUNCTION public.approve_minmax_requests_bulk(bigint[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_minmax_request(bigint, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pedido_preview(integer[], integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_minmax_requests_bulk(bigint[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_minmax_request(bigint, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pedido_preview(integer[], integer[]) TO authenticated, service_role;
