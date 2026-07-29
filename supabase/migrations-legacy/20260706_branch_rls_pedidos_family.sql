-- Auditoría a fondo de pedidos + 14 tablas relacionadas — TODAS tenían
-- SELECT (y varias INSERT/UPDATE) literalmente `USING (true)` para
-- cualquier autenticado. Confirmado con datos reales: "Dependiente de
-- Farmacia" (22 empleados activos, scope=BRANCH) y "Jefe/a de Sala" (6,
-- scope=BRANCH) tienen pedidos.can_edit=true — hoy ven y pueden escribir
-- pedidos de TODAS las sucursales, cuando su scope dice que deberían ver
-- solo la propia. "Auxiliar de Bodega" (scope=ALL) sí necesita ver todo
-- (despacha a todas las sucursales) — sin cambio para ellos.
--
-- Semántica de sucursal por tabla (confirmada en information_schema):
-- - pedidos / pedidos_snapshots: `sucursal_ids` es ARRAY (un pedido puede
--   despachar a varias sucursales a la vez) → containment con ANY().
-- - pedido_sucursal_status/items/item_eventos/pausa_historial/
--   recepcion_extras/recepcion_firmas/apoyo: `erp_sucursal_id` escalar.
-- - purchase_receipts/purchase_sync_log: branch_id directo (más simple que
--   el mapeo erp).
-- - purchase_receipt_items: sin sucursal propia, vía receipt_id →
--   purchase_receipts.branch_id.
-- - rutas/ruta_pedidos/ruta_locations: módulo separado
--   'pedidos_tab_rutas', que en la práctica siempre es scope=ALL incluso
--   para roles BRANCH en 'pedidos' (ver la ruta completa no es sensible,
--   solo view; escritura sigue exigiendo can_edit, que hoy solo tienen
--   bodega/logística).
--
-- `pedidos`/`pedido_items` y la mayoría de estas tablas NO tienen policy de
-- INSERT/UPDATE en absoluto (los flujos de creación pasan por RPCs
-- SECURITY DEFINER) — esas ya estaban correctamente cerradas por defecto,
-- no se tocan.

CREATE OR REPLACE FUNCTION public.auth_employee_erp_sucursal_id()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT esm.erp_sucursal_id FROM public.erp_sucursal_map esm WHERE esm.branch_id = auth_employee_branch_id();
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_employee_erp_sucursal_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_employee_erp_sucursal_id() TO authenticated, service_role;

-- pedidos (solo SELECT existe; sucursal_ids es array)
DROP POLICY IF EXISTS pedidos_select ON public.pedidos;
CREATE POLICY pedidos_select ON public.pedidos
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos', 'can_view')
    AND (auth_module_scope('pedidos') = 'ALL' OR auth_employee_erp_sucursal_id() = ANY (sucursal_ids))
  );

-- pedidos_snapshots (insert/delete ya estaban bien: created_by=own; falta SELECT)
DROP POLICY IF EXISTS snapshots_select ON public.pedidos_snapshots;
CREATE POLICY snapshots_select ON public.pedidos_snapshots
  FOR SELECT
  USING (
    created_by = (select auth.uid())
    OR (
      auth_has_module_permission('pedidos', 'can_view')
      AND (auth_module_scope('pedidos') = 'ALL' OR auth_employee_erp_sucursal_id() = ANY (sucursal_ids))
    )
  );

-- pedido_sucursal_status
DROP POLICY IF EXISTS pss_select ON public.pedido_sucursal_status;
CREATE POLICY pss_select ON public.pedido_sucursal_status
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos', 'can_view')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );
DROP POLICY IF EXISTS pss_insert ON public.pedido_sucursal_status;
CREATE POLICY pss_insert ON public.pedido_sucursal_status
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('pedidos', 'can_edit')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );
DROP POLICY IF EXISTS pss_update ON public.pedido_sucursal_status;
CREATE POLICY pss_update ON public.pedido_sucursal_status
  FOR UPDATE
  USING (
    auth_has_module_permission('pedidos', 'can_edit')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );

-- pedido_items (solo SELECT existe)
DROP POLICY IF EXISTS pedido_items_select ON public.pedido_items;
CREATE POLICY pedido_items_select ON public.pedido_items
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos', 'can_view')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );

-- pedido_item_eventos (solo SELECT existe)
DROP POLICY IF EXISTS pie_select ON public.pedido_item_eventos;
CREATE POLICY pie_select ON public.pedido_item_eventos
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos', 'can_view')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );

-- pedido_pausa_historial
DROP POLICY IF EXISTS pph_select ON public.pedido_pausa_historial;
CREATE POLICY pph_select ON public.pedido_pausa_historial
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos', 'can_view')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );
DROP POLICY IF EXISTS pph_insert ON public.pedido_pausa_historial;
CREATE POLICY pph_insert ON public.pedido_pausa_historial
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('pedidos', 'can_edit')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );
DROP POLICY IF EXISTS pph_update ON public.pedido_pausa_historial;
CREATE POLICY pph_update ON public.pedido_pausa_historial
  FOR UPDATE
  USING (
    auth_has_module_permission('pedidos', 'can_edit')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );

-- pedido_recepcion_extras
DROP POLICY IF EXISTS pre_select ON public.pedido_recepcion_extras;
CREATE POLICY pre_select ON public.pedido_recepcion_extras
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos', 'can_view')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );
DROP POLICY IF EXISTS pre_insert ON public.pedido_recepcion_extras;
CREATE POLICY pre_insert ON public.pedido_recepcion_extras
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('pedidos', 'can_edit')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );

-- pedido_recepcion_firmas
DROP POLICY IF EXISTS prf_select ON public.pedido_recepcion_firmas;
CREATE POLICY prf_select ON public.pedido_recepcion_firmas
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos', 'can_view')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );
DROP POLICY IF EXISTS prf_insert ON public.pedido_recepcion_firmas;
CREATE POLICY prf_insert ON public.pedido_recepcion_firmas
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('pedidos', 'can_edit')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );

-- pedido_apoyo (empleados de apoyo entre sucursales durante recepción)
DROP POLICY IF EXISTS pedido_apoyo_select ON public.pedido_apoyo;
CREATE POLICY pedido_apoyo_select ON public.pedido_apoyo
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos', 'can_view')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );
DROP POLICY IF EXISTS pedido_apoyo_insert ON public.pedido_apoyo;
CREATE POLICY pedido_apoyo_insert ON public.pedido_apoyo
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('pedidos', 'can_edit')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );
DROP POLICY IF EXISTS pedido_apoyo_update ON public.pedido_apoyo;
CREATE POLICY pedido_apoyo_update ON public.pedido_apoyo
  FOR UPDATE
  USING (
    auth_has_module_permission('pedidos', 'can_edit')
    AND (auth_module_scope('pedidos') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );

-- purchase_receipts / purchase_receipt_items / purchase_sync_log (módulo 'compras')
DROP POLICY IF EXISTS "authenticated read purchase_receipts" ON public.purchase_receipts;
CREATE POLICY purchase_receipts_select ON public.purchase_receipts
  FOR SELECT
  USING (
    auth_has_module_permission('compras', 'can_view')
    AND (auth_module_scope('compras') = 'ALL' OR branch_id = auth_employee_branch_id())
  );

DROP POLICY IF EXISTS "authenticated read purchase_receipt_items" ON public.purchase_receipt_items;
CREATE POLICY purchase_receipt_items_select ON public.purchase_receipt_items
  FOR SELECT
  USING (
    auth_has_module_permission('compras', 'can_view')
    AND (
      auth_module_scope('compras') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.purchase_receipts pr WHERE pr.id = purchase_receipt_items.receipt_id AND pr.branch_id = auth_employee_branch_id())
    )
  );

DROP POLICY IF EXISTS "authenticated read purchase_sync_log" ON public.purchase_sync_log;
CREATE POLICY purchase_sync_log_select ON public.purchase_sync_log
  FOR SELECT
  USING (
    auth_has_module_permission('compras', 'can_view')
    AND (auth_module_scope('compras') = 'ALL' OR branch_id = auth_employee_branch_id())
  );

-- rutas / ruta_pedidos / ruta_locations (módulo 'pedidos_tab_rutas' — ver la
-- ruta completa no es sensible por sucursal individual; en la práctica todo
-- rol con este permiso hoy es scope=ALL, pero se deja scope-aware por si
-- cambia a futuro).
DROP POLICY IF EXISTS rutas_select ON public.rutas;
CREATE POLICY rutas_select ON public.rutas
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos_tab_rutas', 'can_view')
    AND (
      auth_module_scope('pedidos_tab_rutas') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.ruta_pedidos rp WHERE rp.ruta_id = rutas.id AND rp.erp_sucursal_id = auth_employee_erp_sucursal_id())
    )
  );
DROP POLICY IF EXISTS rutas_update ON public.rutas;
CREATE POLICY rutas_update ON public.rutas
  FOR UPDATE
  USING (auth_has_module_permission('pedidos_tab_rutas', 'can_edit'));

DROP POLICY IF EXISTS ruta_pedidos_select ON public.ruta_pedidos;
CREATE POLICY ruta_pedidos_select ON public.ruta_pedidos
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos_tab_rutas', 'can_view')
    AND (auth_module_scope('pedidos_tab_rutas') = 'ALL' OR erp_sucursal_id = auth_employee_erp_sucursal_id())
  );
DROP POLICY IF EXISTS ruta_pedidos_update ON public.ruta_pedidos;
CREATE POLICY ruta_pedidos_update ON public.ruta_pedidos
  FOR UPDATE
  USING (auth_has_module_permission('pedidos_tab_rutas', 'can_edit'));

DROP POLICY IF EXISTS "staff write ruta_locations" ON public.ruta_locations;
CREATE POLICY ruta_locations_select ON public.ruta_locations
  FOR SELECT
  USING (
    auth_has_module_permission('pedidos_tab_rutas', 'can_view')
    AND (
      auth_module_scope('pedidos_tab_rutas') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.ruta_pedidos rp WHERE rp.ruta_id = ruta_locations.ruta_id AND rp.erp_sucursal_id = auth_employee_erp_sucursal_id())
    )
  );
CREATE POLICY ruta_locations_write ON public.ruta_locations
  FOR ALL
  USING (auth_has_module_permission('pedidos_tab_rutas', 'can_edit'));
