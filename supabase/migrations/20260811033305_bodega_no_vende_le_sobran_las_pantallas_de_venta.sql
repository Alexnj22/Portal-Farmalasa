SET lock_timeout = '5s';

-- Bodega no vende (2026-08-10, usuario: «bodega solo debe tener inventario y
-- ajuste de inventario —solo jefe—, los demás no, no vende»).
--
-- Bodega son 6 personas: 5 `Auxiliar de Bodega` y la jefatura
-- (`Jefe/a de Compras y Logistica`). Auditado uno por uno:
--
-- ── La jefatura ya estaba bien ───────────────────────────────────────────
-- Tiene `inventario` y `dash_inv_movement` (el ajuste), y NO tiene ni una
-- pantalla de ventas ni de facturación. No se toca nada suyo.
--
-- ── Los auxiliares tenían ocho pantallas de un trabajo que no hacen ──────
-- `ventas_tab_ventas`, `ventas_tab_vendedores`, `ventas_tab_productos` y cinco
-- `facturacion_tab_*` (anuladas, no efectivo, observaciones, pendiente MH,
-- saltos). Son las pantallas de quien factura y quien vende.
--
-- **Hoy no se les abren**: el módulo PADRE (`ventas`, `facturacion`) está
-- apagado, y sin padre la pestaña no lleva a ninguna parte. O sea que no había
-- una fuga de datos, había ocho permisos encendidos que no significaban nada —
-- y ese es justo el estado del que sale una fuga el día que alguien encienda el
-- padre «para que vean el listado» sin mirar qué pestañas quedaron abajo.
--
-- ── Y les faltaba lo suyo ────────────────────────────────────────────────
-- `inventario` estaba apagado para los auxiliares: la gente de la bodega no
-- podía consultar existencias. Se enciende en modo lectura, con el mismo
-- alcance que ya tienen en `dash_inv_search` (ALL), así que no ven nada que no
-- pudieran ver antes — sólo que ahora por la pantalla que corresponde.
--
-- `dash_inv_movement` (crear el ajuste) NO se les da: es de la jefatura, que ya
-- lo tiene. Es la parte «solo jefe» del pedido.

-- 1 · Apagar lo que es de vender.
UPDATE public.role_permissions
SET can_view = false, can_edit = false, can_approve = false
WHERE role_id IN (SELECT id FROM public.roles WHERE name = 'Auxiliar de Bodega')
  AND module_key IN (
    'ventas_tab_ventas', 'ventas_tab_vendedores', 'ventas_tab_productos',
    'facturacion_tab_anuladas', 'facturacion_tab_no_efectivo',
    'facturacion_tab_observaciones', 'facturacion_tab_pendiente_mh',
    'facturacion_tab_saltos');

-- 2 · Encender lo que sí es de bodega: consultar existencias.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'inventario', true, false, false, 'ALL'
FROM public.roles r
WHERE r.name = 'Auxiliar de Bodega'
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id = r.id AND rp.module_key = 'inventario');

UPDATE public.role_permissions
SET can_view = true, can_edit = false, can_approve = false, scope = 'ALL'
WHERE module_key = 'inventario'
  AND role_id IN (SELECT id FROM public.roles WHERE name = 'Auxiliar de Bodega');
