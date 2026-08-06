-- La lista de faltantes también dice cuándo vence lo de cada sala.
--
-- El aviso de vencimiento se agregó en `get_donde_hay`, que es el camino de la
-- BÚSQUEDA. Pero el otro camino —la lista de faltantes— arma su propio `donde`,
-- y sin la fecha el mismo formulario deja de avisar según por dónde se haya
-- entrado. Dos listas que se parecen y no contestan igual es exactamente lo que
-- este módulo viene evitando todo el día.

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
        SELECT d.erp_product_id, d.erp_sucursal_id, d.unidades::integer AS unidades
        FROM public.v_inventario_disponible d
        WHERE d.unidades > 0
    ),
    nombres AS (
        SELECT i.erp_product_id, max(i.descripcion) AS descripcion
        FROM public.inventory i WHERE i.cantidad > 0 GROUP BY 1
    ),
    mio AS (
        SELECT sp.erp_product_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units) AS min_mio
        FROM public.product_stock_params sp
        WHERE sp.erp_sucursal_id = p_erp_sucursal_id
          AND coalesce(sp.manual_min, sp.calc_min, sp.min_units) > 0
    ),
    ajenas AS (
        SELECT b.erp_product_id, b.erp_sucursal_id, b.unidades,
               coalesce(m.nombre, 'Sucursal ' || b.erp_sucursal_id) AS sala,
               m.branch_id,
               coalesce(sp2.manual_min, sp2.calc_min, sp2.min_units, 0) AS min_suyo,
               v.primero AS vence
        FROM base b
        JOIN public.product_stock_params sp2
          ON sp2.erp_product_id = b.erp_product_id
         AND sp2.erp_sucursal_id = b.erp_sucursal_id
        LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = b.erp_sucursal_id
        LEFT JOIN LATERAL (
            SELECT min(i.fecha_vencimiento) AS primero
            FROM public.inventory i
            WHERE i.erp_product_id = b.erp_product_id
              AND i.erp_sucursal_id = b.erp_sucursal_id
              AND i.is_vencidos = false AND i.cantidad > 0
              AND i.fecha_vencimiento IS NOT NULL
        ) v ON true
        WHERE b.erp_sucursal_id <> p_erp_sucursal_id
    )
    SELECT a.erp_product_id,
           max(n.descripcion) AS descripcion,
           max(mio.min_mio)   AS min_units,
           jsonb_agg(jsonb_build_object(
                       'sala',            a.sala,
                       'unidades',        a.unidades,
                       'minimo',          a.min_suyo,
                       'vence',           a.vence,
                       'erp_sucursal_id', a.erp_sucursal_id,
                       'branch_id',       a.branch_id)
                     ORDER BY a.unidades DESC) AS donde
    FROM ajenas a
    JOIN mio ON mio.erp_product_id = a.erp_product_id
    LEFT JOIN nombres n ON n.erp_product_id = a.erp_product_id
    WHERE NOT EXISTS (
        SELECT 1 FROM base b0
        WHERE b0.erp_product_id = a.erp_product_id
          AND b0.erp_sucursal_id = p_erp_sucursal_id
    )
    GROUP BY a.erp_product_id
    ORDER BY max(mio.min_mio) DESC, max(n.descripcion)
    LIMIT greatest(1, least(p_limite, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.get_faltantes_con_stock_en_otra_sala(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_faltantes_con_stock_en_otra_sala(integer, integer) TO authenticated, service_role;
