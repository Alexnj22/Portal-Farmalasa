-- 2026-11-10, pedido del usuario: el historial de Pedidos, sólo de su sucursal
-- para los cargos de sala; Bodega (12, 15) y la administración siguen viendo todo.
SET lock_timeout = '5s';
UPDATE public.role_permissions
   SET scope = 'BRANCH'
 WHERE role_id IN (19, 20, 23, 30)
   AND module_key = 'pedidos_tab_historial'
   AND scope = 'ALL';
