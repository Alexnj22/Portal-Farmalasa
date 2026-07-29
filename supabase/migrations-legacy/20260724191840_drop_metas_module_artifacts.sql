SET lock_timeout = '5s';

-- Módulo Metas retirado del frontend (vista eliminada, queda como
-- "Próximamente" en menú/permisos hasta que se rehaga). Limpieza de los
-- artefactos de backend que solo existían para esa vista.

DROP FUNCTION IF EXISTS public.get_branch_monthly_sales(date, date, integer[]);

DELETE FROM public.role_permissions WHERE module_key = 'metas';
