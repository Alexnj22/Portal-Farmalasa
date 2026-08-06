-- `get_donde_hay` dice también CUÁNDO VENCE lo de cada sala.
--
-- Pedido del usuario el 2026-08-06: «si una sucursal tiene una fecha de vence
-- más corta, que avise».
--
-- Es una preocupación de farmacia, no de inventario: dos salas pueden tener el
-- mismo producto y la misma cantidad, y pedirle a la que lo tiene por vencer
-- mueve el problema en vez de resolverlo — llega algo que hay que descartar en
-- un mes. Con la fecha a la vista, quien pide elige.
--
-- Se toma la fecha MÁS CERCANA de esa sala, que es la que manda: es lo primero
-- que va a salir de ahí y por lo tanto lo que probablemente llegue. Los lotes
-- sin fecha (los no perecederos, y los `GENERICO` sin control) no cuentan —
-- `min()` los ignora solo, y una sala sin ninguna fecha devuelve null, que la
-- pantalla lee como «sin vencimiento que avisar».

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_donde_hay(
    p_erp_product_id integer,
    p_erp_sucursal_destino integer
)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    SELECT coalesce(json_agg(x ORDER BY (x->>'unidades')::numeric DESC), '[]'::json)
    FROM (
        SELECT json_build_object(
                   'sala',            coalesce(m.nombre, 'Sucursal ' || d.erp_sucursal_id),
                   'unidades',        d.unidades::integer,
                   'minimo',          coalesce(sp.manual_min, sp.calc_min, sp.min_units, 0),
                   'vence',           v.primero,
                   'erp_sucursal_id', d.erp_sucursal_id,
                   'branch_id',       m.branch_id
               ) AS x
        FROM public.v_inventario_disponible d
        LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = d.erp_sucursal_id
        LEFT JOIN public.product_stock_params sp
               ON sp.erp_product_id = d.erp_product_id
              AND sp.erp_sucursal_id = d.erp_sucursal_id
        LEFT JOIN LATERAL (
            SELECT min(i.fecha_vencimiento) AS primero
            FROM public.inventory i
            WHERE i.erp_product_id = d.erp_product_id
              AND i.erp_sucursal_id = d.erp_sucursal_id
              AND i.is_vencidos = false
              AND i.cantidad > 0
              AND i.fecha_vencimiento IS NOT NULL
        ) v ON true
        WHERE d.erp_product_id = p_erp_product_id
          AND d.unidades > 0
          AND d.erp_sucursal_id <> p_erp_sucursal_destino
    ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_donde_hay(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_donde_hay(integer, integer) TO authenticated, service_role;
