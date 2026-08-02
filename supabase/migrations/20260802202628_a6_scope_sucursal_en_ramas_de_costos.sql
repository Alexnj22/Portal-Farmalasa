SET lock_timeout = '5s';

-- ── A6 (H9) · Dos ramas del RLS que se saltean el scope de sucursal ─────────
--
-- Las policies de lectura de `purchase_receipts` y `sales_invoices` tienen la
-- forma correcta en su rama principal:
--
--     permiso('compras','can_view') AND (scope = 'ALL' OR branch_id = la mia)
--
-- pero las ramas que existen para que otros módulos puedan ver COSTOS estaban
-- sueltas, sin la segunda mitad:
--
--     OR permiso('minmax_ver_costos','can_view')             <-- toda sucursal
--     OR permiso('productos_tab_catalogo_costos','can_view')  <-- toda sucursal
--
-- O sea: alguien con scope de UNA sucursal en Compras, pero con permiso de ver
-- costos, lee las compras de las SIETE. El permiso de costos es sobre el dato
-- "costo", no sobre el alcance geográfico — no debería ampliar el scope.
--
-- `sales_invoices` ya tenía la forma buena en su rama de `dash_top_productos`;
-- la de `minmax_ver_costos` es la única que faltaba. Sirvió de plantilla.
--
-- HOY NO LE QUITA ACCESO A NADIE: las 6 roles que tienen alguno de estos
-- permisos lo tienen con scope = 'ALL' (verificado antes de aplicar), incluido
-- `Jefe/a de Compras y Logistica`, que llega a purchase_receipts justamente por
-- la rama de costos y no por la de compras. Es candado, no restricción.
--
-- Se usa ALTER POLICY y no DROP+CREATE a propósito: DROP+CREATE deja un
-- instante sin policy, y en una tabla con RLS eso significa que nadie ve nada.
-- Las llamadas siguen envueltas en `(SELECT ...)` — sin el initplan, Postgres
-- las evalúa POR FILA y ése fue el outage del 2026-07-08. Medido después de
-- aplicar: count() de 23,617 filas de sales_invoices en 27 ms.
--
-- Probado primero en el branch de staging (ewcmerxqjvludtgskuin), como manda la
-- regla para DDL sobre tablas calientes.
ALTER POLICY purchase_receipts_select ON public.purchase_receipts
  USING (
    (
      (SELECT auth_has_module_permission('compras', 'can_view'))
      AND (
        (SELECT auth_module_scope('compras')) = 'ALL'
        OR branch_id = (SELECT auth_employee_branch_id())
      )
    )
    OR (
      (SELECT auth_has_module_permission('minmax_ver_costos', 'can_view'))
      AND (
        (SELECT auth_module_scope('minmax_ver_costos')) = 'ALL'
        OR branch_id = (SELECT auth_employee_branch_id())
      )
    )
    OR (
      (SELECT auth_has_module_permission('productos_tab_catalogo_costos', 'can_view'))
      AND (
        (SELECT auth_module_scope('productos_tab_catalogo_costos')) = 'ALL'
        OR branch_id = (SELECT auth_employee_branch_id())
      )
    )
  );

ALTER POLICY sales_invoices_select ON public.sales_invoices
  USING (
    (
      (SELECT auth_has_module_permission('ventas', 'can_view'))
      AND (
        (SELECT auth_module_scope('ventas')) = 'ALL'
        OR branch_id = (SELECT auth_employee_branch_id())
      )
    )
    OR (
      (SELECT auth_has_module_permission('minmax_ver_costos', 'can_view'))
      AND (
        (SELECT auth_module_scope('minmax_ver_costos')) = 'ALL'
        OR branch_id = (SELECT auth_employee_branch_id())
      )
    )
    OR (
      (SELECT auth_has_module_permission('dash_top_productos', 'can_view'))
      AND (
        (SELECT auth_module_scope('dash_top_productos')) = 'ALL'
        OR branch_id = (SELECT auth_employee_branch_id())
      )
    )
  );
