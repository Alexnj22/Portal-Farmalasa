-- Regla 3 de la Fase 2 (docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md), aprobada
-- por el usuario el 2026-09-23: el inventario lo lee quien tiene alguna pantalla
-- que lo usa, y SIN recorte por sala.
--
-- Sin recorte a propósito: la consulta de inventario, pedir y enviar traslado,
-- y «faltantes con stock en otra sala» miran las OTRAS salas por diseño.
--
-- La lista de permisos sale del mapa de lectores del 2026-09-23 (22 funciones
-- INVOKER, 2 vistas y los widgets del Inicio) y se verificó al revés: con esta
-- regla sólo quedan afuera dos personas activas —Auxiliar de Servicios
-- Generales y Contador Externo—, cuyas pantallas (bitácoras, libros de IVA,
-- facturas de compra, proveedores, corte Z) no leen inventario.
--
-- Los permisos se preguntan UNA vez por consulta (initplan), no por fila, con la
-- misma función de siempre: respeta cargo secundario y permisos heredados.
--
-- Tabla caliente (el sync la escribe cada minuto): freno de 2 s.

SET lock_timeout = '2s';

DROP POLICY "allow read inventory" ON public.inventory;

CREATE POLICY inventory_select ON public.inventory
    FOR SELECT TO authenticated
    USING ((SELECT EXISTS (
        SELECT 1 FROM unnest(ARRAY[
            'inventario', 'dash_inv_search', 'dash_inv_movement', 'traslados',
            'dash_traslados', 'conteo_inventario', 'minmax', 'dash_minmax_req',
            'pedidos', 'gestion_stock', 'ventas', 'sync_health', 'requests'
        ]) m
        WHERE public.auth_has_module_permission(m, 'can_view'))));
