-- Add dashboard widget permissions for Comercial tab:
-- dash_cotizaciones, dash_facturacion, dash_top_productos
--
-- Seeded for roles that already have BOTH dash_kpi AND the corresponding
-- module permission (cotizaciones / facturacion / ventas).
-- This means: Administrador, Gerente General, Jefe/a de Talento Humano,
-- Supervisor/a de Ventas.

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve)
SELECT
    r.id,
    new_perm.module_key,
    true,
    false,
    false
FROM public.roles r
-- Only roles that already have dashboard access AND the matching module perm
JOIN public.role_permissions dash ON dash.role_id = r.id AND dash.module_key = 'dash_kpi'
JOIN public.role_permissions mod  ON mod.role_id  = r.id AND mod.module_key  = new_perm.source_module
CROSS JOIN (
    VALUES
        ('dash_cotizaciones',  'cotizaciones'),
        ('dash_facturacion',   'facturacion'),
        ('dash_top_productos', 'ventas')
) AS new_perm (module_key, source_module)
-- Skip if already exists
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions ep
    WHERE ep.role_id = r.id AND ep.module_key = new_perm.module_key
);
