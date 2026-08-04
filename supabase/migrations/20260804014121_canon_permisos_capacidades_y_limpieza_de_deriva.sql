SET lock_timeout = '5s';

-- ══ Canon de permisos por vista (docs/AUDITORIA-PERMISOS-2026-08-03.md) ══
-- Tres cosas en una transacción: crear las capacidades nuevas, renombrar la que
-- se llamaba `tab` sin serlo, y limpiar la deriva.

-- ── 1. Las 28 claves nuevas, backfill en true ─────────────────────────────
-- Decisión del usuario: arrancan ENCENDIDAS para todo rol que ya ve el módulo
-- padre, así nadie pierde acceso el día del despliegue y apagar es explícito.
INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT rp.role_id, n.hija, true, false, false, 'ALL', now()
FROM role_permissions rp
JOIN (VALUES
  ('staff_list',             'staff_list_descargar'),
  ('time_audit',             'time_audit_descargar'),
  ('payroll',                'payroll_descargar'),
  ('facturacion',            'facturacion_ver_montos'),
  ('cotizaciones',           'cotizaciones_descargar'),
  ('clientes',               'clientes_ver_montos'),
  ('minmax',                 'minmax_descargar'),
  ('ventas_perdidas',        'ventas_perdidas_descargar'),
  ('compras',                'compras_tab_facturas'),
  ('compras',                'compras_tab_productos'),
  ('compras',                'compras_ver_montos'),
  ('conteo_inventario',      'conteo_inventario_descargar'),
  ('conteo_inventario',      'conteo_inventario_ver_montos'),
  ('pedidos',                'pedidos_descargar'),
  ('libros_iva',             'libros_iva_tab_consumidor'),
  ('libros_iva',             'libros_iva_tab_contribuyente'),
  ('libros_iva',             'libros_iva_tab_compras'),
  ('libros_iva',             'libros_iva_tab_anulados'),
  ('libros_iva',             'libros_iva_tab_percepcion'),
  ('libros_iva',             'libros_iva_tab_retencion'),
  ('libros_iva',             'libros_iva_tab_renta'),
  ('libros_iva',             'libros_iva_descargar'),
  ('libros_iva',             'libros_iva_ver_montos'),
  ('corte_z',                'corte_z_descargar'),
  ('corte_z',                'corte_z_ver_montos'),
  ('libro_compras_completo', 'libro_compras_completo_descargar'),
  ('libro_compras_completo', 'libro_compras_completo_ver_montos'),
  ('branches',               'branches_descargar')
) AS n(padre, hija) ON n.padre = rp.module_key
WHERE rp.can_view = true
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();

-- ── 2. `productos_tab_catalogo_costos` → `productos_ver_costos` ───────────
-- No es una pestaña: gatea las columnas de costo dentro del Catálogo. Se
-- renombra la fila (conserva el valor de cada rol) y las DOS policies que la
-- nombran, que es lo que haría falso un rename a medias.
UPDATE role_permissions
   SET module_key = 'productos_ver_costos', updated_at = now()
 WHERE module_key = 'productos_tab_catalogo_costos';

ALTER POLICY purchase_receipts_select ON public.purchase_receipts
  USING (
    ((SELECT auth_has_module_permission('compras', 'can_view'))
      AND ((SELECT auth_module_scope('compras')) = 'ALL'
           OR branch_id = (SELECT auth_employee_branch_id())))
    OR ((SELECT auth_has_module_permission('minmax_ver_costos', 'can_view'))
      AND ((SELECT auth_module_scope('minmax_ver_costos')) = 'ALL'
           OR branch_id = (SELECT auth_employee_branch_id())))
    OR ((SELECT auth_has_module_permission('productos_ver_costos', 'can_view'))
      AND ((SELECT auth_module_scope('productos_ver_costos')) = 'ALL'
           OR branch_id = (SELECT auth_employee_branch_id())))
  );

ALTER POLICY purchase_receipt_items_select ON public.purchase_receipt_items
  USING (
    ((SELECT auth_has_module_permission('compras', 'can_view'))
      AND ((SELECT auth_module_scope('compras')) = 'ALL'
           OR EXISTS (SELECT 1 FROM public.purchase_receipts pr
                       WHERE pr.id = purchase_receipt_items.receipt_id
                         AND pr.branch_id = (SELECT auth_employee_branch_id()))))
    OR (SELECT auth_has_module_permission('minmax_ver_costos', 'can_view'))
    OR (SELECT auth_has_module_permission('productos_ver_costos', 'can_view'))
  );

-- ── 3. El rename fallido de Horarios ──────────────────────────────────────
-- `schedules_tab_catalog` quedó viva en la base junto a la clave que el código
-- realmente lee, `schedules_tab_shifts`.
--
-- CORRECCIÓN medida al aplicar esta migración: la auditoría había dicho que el
-- rename le sacó el Catálogo de Turnos a 2 roles, y NO es cierto — comparó
-- filas totales (6 contra 4) en vez de filas en `true` (3 contra 3). Las filas
-- de más de la clave muerta tenían `can_view=false`, o sea que no cargaban
-- ningún acceso. Este INSERT resultó un no-op verificado (antes 3 en true,
-- después 3), y se conserva igual porque es lo correcto ante un rename: no
-- perder lo que la clave vieja sí concedía. El DELETE de abajo es el cambio real.
INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT role_id, 'schedules_tab_shifts', true, false, false, 'ALL', now()
FROM role_permissions
WHERE module_key = 'schedules_tab_catalog' AND can_view = true
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();

-- ── 4. La deriva ──────────────────────────────────────────────────────────
-- Ninguna de estas la consulta nadie: ni el frontend (expandiendo plantillas,
-- widgets y guards de ruta), ni una función, ni una policy.
--   dash_distribution      → el widget ya no existe en ALL_WIDGET_IDS
--   promociones*           → módulo retirado
--   pedidos_tab_*          → rediseño de las pestañas de Pedidos
--   emp_home / emp_schedule→ huérfanas
--   schedules_tab_catalog  → ya migrada arriba
-- Se conservan `metas`, `bonificaciones` y `entrevistas`: son comingSoon.
DELETE FROM role_permissions WHERE module_key IN (
  'dash_distribution',
  'emp_home', 'emp_schedule',
  'schedules_tab_catalog',
  'promociones', 'promociones_tab_activas', 'promociones_tab_bonificaciones', 'promociones_tab_historial',
  'pedidos_tab_diferencias', 'pedidos_tab_en_curso', 'pedidos_tab_recepcion'
);
