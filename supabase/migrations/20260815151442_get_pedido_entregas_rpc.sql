SET lock_timeout = '5s';

-- La entrega de un pedido es HISTORIA DEL PEDIDO, no acceso al módulo de Rutas.
--
-- El paso «Entregado» de la tarjeta se leía de `ruta_pedidos`, y esa tabla está
-- gateada por `pedidos_tab_rutas.can_view`: quien no administra rutas veía el
-- paso vacío aunque el pedido fuera suyo. Darle ese permiso para arreglarlo le
-- abriría además la pestaña de Rutas entera — un módulo que no le toca.
--
-- Esta función sirve el dato con la MISMA autorización con la que esa persona ya
-- ve el pedido (`pedidos.can_view` + su alcance), y nada más: cuatro campos de
-- las paradas de los pedidos que pidió. No expone la tabla, no expone otras
-- rutas, y no hace falta tocar ningún permiso.
CREATE OR REPLACE FUNCTION public.get_pedido_entregas(p_pedido_ids uuid[])
RETURNS TABLE (
    pedido_id        uuid,
    erp_sucursal_id  integer,
    entregado_at     timestamptz,
    entregado_por    uuid,
    conductor_id     uuid,
    conductor_nombre text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT rp.pedido_id, rp.erp_sucursal_id, rp.entregado_at, rp.entregado_por,
           r.conductor_id, r.conductor_nombre
    FROM   public.ruta_pedidos rp
    JOIN   public.rutas r ON r.id = rp.ruta_id
    WHERE  rp.pedido_id = ANY(p_pedido_ids)
      AND  rp.entregado_at IS NOT NULL
      -- Copia literal del predicado de `pedido_items_select`: quien ve el
      -- pedido ve su entrega, con el mismo alcance. Si esa policy cambia, ésta
      -- tiene que cambiar con ella.
      AND  (SELECT auth_has_module_permission('pedidos', 'can_view'))
      AND  (
             (SELECT auth_module_scope('pedidos')) = 'ALL'
             OR rp.erp_sucursal_id = (SELECT auth_employee_erp_sucursal_id())
           );
$$;

COMMENT ON FUNCTION public.get_pedido_entregas(uuid[]) IS
    'Entrega (hora + conductor) de las paradas de los pedidos dados. Autoriza por el módulo pedidos, no por pedidos_tab_rutas: la entrega es historia del pedido y verla no debe exigir acceso al módulo de Rutas.';

REVOKE EXECUTE ON FUNCTION public.get_pedido_entregas(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pedido_entregas(uuid[]) TO authenticated, service_role;
