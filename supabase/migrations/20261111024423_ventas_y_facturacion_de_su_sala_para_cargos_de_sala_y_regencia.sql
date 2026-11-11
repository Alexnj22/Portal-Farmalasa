-- 2026-11-10, pedido del usuario: la pestaña Ventas (y sus vistas completas)
-- sólo de la sucursal del empleado, para Dependiente, Regente de Enfermería,
-- Jefe/a y Subjefe/a de Sala, Regente y Referente de Farmacovigilancia.
-- El módulo `ventas` de los cargos de sala ya era BRANCH (y la base ya filtra
-- por sala); esto alinea las pestañas, que decían «toda la red».
SET lock_timeout = '5s';
UPDATE public.role_permissions
   SET scope = 'BRANCH'
 WHERE role_id IN (8, 9, 19, 20, 23, 30)
   AND scope = 'ALL'
   AND (module_key LIKE 'ventas_tab_%' OR module_key LIKE 'facturacion_tab_%'
        OR module_key IN ('facturacion', 'ventas_no_producto',
                          'dash_meta_sala_vista_completa', 'dash_vendedores_vista_completa'));
