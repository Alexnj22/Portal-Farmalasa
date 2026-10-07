SET lock_timeout = '5s';
-- Quien oculta lo pone la base (la ficha del empleado, no la cuenta): el
-- navegador sólo manda el producto.
ALTER TABLE public.app_catalogo_ocultos ALTER COLUMN ocultado_por SET DEFAULT public.auth_employee_id();
