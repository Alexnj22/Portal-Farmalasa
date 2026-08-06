-- La lista de faltantes tiene que decir A QUÉ SALA pedirle, con su id.
--
-- `donde` traía solo el nombre y las unidades, que alcanza para leerlo pero no
-- para pedirlo: armar una solicitud con «Salud 3» obligaría al navegador a
-- traducir el nombre de vuelta a un id, y el nombre no es la llave de nada.
-- Es la misma familia del id de factura que casi se manda equivocado: el
-- identificador viaja, la etiqueta se muestra.
--
-- Se agrega el `erp_sucursal_id` y el `branch_id`, que son las dos numeraciones
-- que necesita la solicitud: la primera para hablar con el sistema y la segunda
-- para resolver a quién avisarle.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_faltantes_con_stock_en_otra_sala(
    p_erp_sucursal_id integer,
    p_limite integer DEFAULT 40
)
RETURNS TABLE (
    erp_product_id integer,
    descripcion    text,
    min_units      integer,
    donde          jsonb
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    WITH base AS (
        SELECT i.erp_product_id,
               i.erp_sucursal_id,
               max(i.descripcion)                                  AS descripcion,
               sum(i.cantidad * coalesce(pp.factor, 1))::integer   AS unidades
        FROM public.inventory i
        LEFT JOIN public.presentaciones pr
               ON upper(pr.tipo) = upper(i.presentacion)
        LEFT JOIN public.product_precios pp
               ON pp.product_id = i.erp_product_id
              AND pp.id_presentacion = pr.id
              AND pp.activo
        WHERE i.is_vencidos = false AND i.cantidad > 0
        GROUP BY 1, 2
    ),
    mio AS (
        SELECT sp.erp_product_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units) AS min_mio
        FROM public.product_stock_params sp
        WHERE sp.erp_sucursal_id = p_erp_sucursal_id
          AND coalesce(sp.manual_min, sp.calc_min, sp.min_units) > 0
    ),
    ajenas AS (
        SELECT b.erp_product_id, b.erp_sucursal_id, b.descripcion, b.unidades,
               coalesce(m.nombre, 'Sucursal ' || b.erp_sucursal_id) AS sala,
               m.branch_id
        FROM base b
        JOIN public.product_stock_params sp2
          ON sp2.erp_product_id = b.erp_product_id
         AND sp2.erp_sucursal_id = b.erp_sucursal_id
        LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = b.erp_sucursal_id
        WHERE b.erp_sucursal_id <> p_erp_sucursal_id
          -- (3) le queda al menos su mínimo después de ceder una
          AND b.unidades - 1 >= coalesce(sp2.manual_min, sp2.calc_min, sp2.min_units, 1)
    )
    SELECT a.erp_product_id,
           max(a.descripcion) AS descripcion,
           max(mio.min_mio)   AS min_units,
           jsonb_agg(jsonb_build_object(
                       'sala',            a.sala,
                       'unidades',        a.unidades,
                       'erp_sucursal_id', a.erp_sucursal_id,
                       'branch_id',       a.branch_id)
                     ORDER BY a.unidades DESC) AS donde
    FROM ajenas a
    JOIN mio ON mio.erp_product_id = a.erp_product_id          -- (1) está en su min/max
    WHERE NOT EXISTS (                                          -- (2) acá no hay nada
        SELECT 1 FROM base b0
        WHERE b0.erp_product_id = a.erp_product_id
          AND b0.erp_sucursal_id = p_erp_sucursal_id
    )
    GROUP BY a.erp_product_id
    ORDER BY max(mio.min_mio) DESC, max(a.descripcion)
    LIMIT greatest(1, least(p_limite, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.get_faltantes_con_stock_en_otra_sala(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_faltantes_con_stock_en_otra_sala(integer, integer) TO authenticated, service_role;
