SET lock_timeout = '5s';

-- Capacidad nueva `ventas_ver_cards`: gatea el carril de tarjetas de resumen
-- de las tres pestañas de Ventas (total vendido, ticket promedio, utilidad,
-- margen). La lista factura por factura NO depende de ella.
--
-- Backfill en true para todo rol que ya ve el módulo padre, igual que las 28
-- capacidades del canon (20260804014121): nadie pierde acceso el día del
-- despliegue y apagarla es una decisión explícita en la pantalla de Permisos.
INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT rp.role_id, 'ventas_ver_cards', true, false, false, 'ALL', now()
  FROM role_permissions rp
 WHERE rp.module_key = 'ventas'
   AND rp.can_view = true
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();
