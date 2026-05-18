-- ============================================================
-- DB Audit v12 — Revoke anon EXECUTE from SECURITY DEFINER functions
-- Root cause: functions get EXECUTE on PUBLIC by default in PostgreSQL.
-- REVOKE FROM anon only removes explicit grants — must REVOKE FROM PUBLIC,
-- then GRANT back to authenticated only.
-- get_kiosk_boot_payload keeps anon (kiosk devices are unauthenticated).
-- ============================================================

-- auth_employee_branch_id
REVOKE EXECUTE ON FUNCTION public.auth_employee_branch_id() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_employee_branch_id() TO authenticated;

-- auth_employee_role_id
REVOKE EXECUTE ON FUNCTION public.auth_employee_role_id() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_employee_role_id() TO authenticated;

-- auth_has_module_permission
REVOKE EXECUTE ON FUNCTION public.auth_has_module_permission(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_has_module_permission(text, text) TO authenticated;

-- inventory_grouped
REVOKE EXECUTE ON FUNCTION public.inventory_grouped(integer, boolean, boolean, text, integer, text, text, text, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.inventory_grouped(integer, boolean, boolean, text, integer, text, text, text, integer, integer) TO authenticated;

-- inventory_inversion
REVOKE EXECUTE ON FUNCTION public.inventory_inversion(integer, text, integer, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.inventory_inversion(integer, text, integer, text) TO authenticated;

-- inventory_proximos_count
REVOKE EXECUTE ON FUNCTION public.inventory_proximos_count(integer, integer, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.inventory_proximos_count(integer, integer, text, text) TO authenticated;

-- next_cotizacion_numero
REVOKE EXECUTE ON FUNCTION public.next_cotizacion_numero() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.next_cotizacion_numero() TO authenticated;

-- refresh_inventory_grouped_mv
REVOKE EXECUTE ON FUNCTION public.refresh_inventory_grouped_mv() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.refresh_inventory_grouped_mv() TO authenticated;

-- validate_role_headcount
REVOKE EXECUTE ON FUNCTION public.validate_role_headcount(integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_role_headcount(integer, integer) TO authenticated;

-- get_kiosk_boot_payload: keep anon (intentional — kiosk uses it)
REVOKE EXECUTE ON FUNCTION public.get_kiosk_boot_payload(uuid, uuid, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_kiosk_boot_payload(uuid, uuid, date) TO anon;
GRANT  EXECUTE ON FUNCTION public.get_kiosk_boot_payload(uuid, uuid, date) TO authenticated;
