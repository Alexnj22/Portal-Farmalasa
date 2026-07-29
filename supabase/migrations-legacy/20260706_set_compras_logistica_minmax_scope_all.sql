-- A pedido directo del usuario: "Jefe/a de Compras y Logistica" SÍ necesita
-- ver/decidir solicitudes de MinMax de TODAS las sucursales (compras y
-- logística es una función cross-branch) — no un bug, se restaura el
-- alcance company-wide para este rol+módulo específico. Con el fix de
-- 20260706_scope_aware_all_module_bypass_policies.sql, este toggle ahora
-- sí tiene efecto real en la RLS (antes daba igual lo que dijera scope).
UPDATE public.role_permissions
SET scope = 'ALL'
WHERE role_id = 12 AND module_key = 'minmax';
