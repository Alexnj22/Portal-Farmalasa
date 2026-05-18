-- ============================================================
-- DB Audit v10 — Security hardening + FK indexes
-- 1. Revoke anon EXECUTE from SECURITY DEFINER functions (no kiosk use)
-- 2. Revoke anon SELECT from inventory_grouped_mv
-- 3. Add missing FK indexes
-- ============================================================

-- ─── 1. Revoke anon EXECUTE on privileged SECURITY DEFINER functions ─────────
REVOKE EXECUTE ON FUNCTION public.auth_employee_branch_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auth_employee_role_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auth_has_module_permission(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventory_grouped(integer, boolean, boolean, text, integer, text, text, text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventory_inversion(integer, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventory_proximos_count(integer, integer, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_cotizacion_numero() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_inventory_grouped_mv() FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_role_headcount(integer, integer) FROM anon;
-- get_kiosk_boot_payload keeps anon — unauthenticated kiosk devices use it.

-- ─── 2. Revoke anon SELECT from inventory_grouped_mv ─────────────────────────
REVOKE SELECT ON TABLE public.inventory_grouped_mv FROM anon;

-- ─── 3. Missing FK indexes ────────────────────────────────────────────────────

-- employees
CREATE INDEX IF NOT EXISTS idx_employees_secondary_role       ON public.employees(secondary_role_id)       WHERE secondary_role_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_shift                ON public.employees(shift_id)                WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_system_role          ON public.employees(system_role)              WHERE system_role IS NOT NULL;

-- payroll_entries
CREATE INDEX IF NOT EXISTS idx_payroll_entries_employee       ON public.payroll_entries(employee_id);

-- products
CREATE INDEX IF NOT EXISTS idx_products_laboratorio           ON public.products(laboratorio_id)            WHERE laboratorio_id IS NOT NULL;

-- product_costs
CREATE INDEX IF NOT EXISTS idx_product_costs_presentacion     ON public.product_costs(presentacion_id);

-- product_precios (column is id_presentacion)
CREATE INDEX IF NOT EXISTS idx_product_precios_presentacion   ON public.product_precios(id_presentacion);

-- product_precios_changelog (column is id_presentacion)
CREATE INDEX IF NOT EXISTS idx_product_precios_changelog_pres ON public.product_precios_changelog(id_presentacion);

-- product_precios_history (column is id_presentacion)
CREATE INDEX IF NOT EXISTS idx_product_precios_history_pres   ON public.product_precios_history(id_presentacion);

-- employee_documents
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee    ON public.employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_event       ON public.employee_documents(event_id)        WHERE event_id IS NOT NULL;

-- announcements
CREATE INDEX IF NOT EXISTS idx_announcements_created_by       ON public.announcements(created_by);

-- cotizacion_items
CREATE INDEX IF NOT EXISTS idx_cotizacion_items_presentacion  ON public.cotizacion_items(presentacion_id);

-- kiosk_devices
CREATE INDEX IF NOT EXISTS idx_kiosk_devices_branch           ON public.kiosk_devices(branch_id);

-- product_locations
CREATE INDEX IF NOT EXISTS idx_product_locations_branch       ON public.product_locations(branch_id);

-- roles
CREATE INDEX IF NOT EXISTS idx_roles_parent                   ON public.roles(parent_role_id)               WHERE parent_role_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_secondary_parent         ON public.roles(secondary_parent_role_id)      WHERE secondary_parent_role_id IS NOT NULL;

-- surveys
CREATE INDEX IF NOT EXISTS idx_survey_preguntas_bloque        ON public.survey_preguntas(bloque_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_updated       ON public.survey_responses(updated_by)        WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surveys_created_by             ON public.surveys(created_by)                 WHERE created_by IS NOT NULL;

-- vacation_plans
CREATE INDEX IF NOT EXISTS idx_vacation_plans_created_by      ON public.vacation_plans(created_by)          WHERE created_by IS NOT NULL;
