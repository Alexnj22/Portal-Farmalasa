SET lock_timeout = '5s';

-- Permiso de la pestaña "Observaciones" de Facturación.
--
-- Va acá y no a mano porque una pestaña sin fila en `role_permissions` no la ve
-- NADIE: `allowedTabs` filtra por `hasPermission('facturacion_tab_*')`, así que
-- la funcionalidad quedaría escrita y muerta. Es el mismo defecto que ya mordió
-- al aterrizaje de módulos.
--
-- Espeja los roles que hoy ven `facturacion_tab_anuladas` (mismo can_view, mismo
-- scope). `can_edit` va en false a propósito: la pestaña es de solo lectura — no
-- tiene acción de solventar, porque una observación se corrige arreglando el
-- dato de origen, no marcándola como vista.
--
-- WHERE NOT EXISTS en vez de ON CONFLICT: es idempotente igual y no paga el
-- costo por fila del arbitraje de conflicto.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'facturacion_tab_observaciones', rp.can_view, false, false, rp.scope
FROM public.role_permissions rp
WHERE rp.module_key = 'facturacion_tab_anuladas'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions x
      WHERE x.role_id = rp.role_id
        AND x.module_key = 'facturacion_tab_observaciones'
  );
