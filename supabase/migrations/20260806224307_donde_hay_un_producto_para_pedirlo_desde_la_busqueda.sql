-- Dónde hay un producto, para poder pedirlo desde la búsqueda.
--
-- Hasta acá solo se podía pedir desde la lista de faltantes, que ya traía sus
-- salas adentro. Pero el caso real es el otro: alguien busca un producto porque
-- un cliente lo está preguntando, ve que Salud 3 lo tiene y **no tiene cómo
-- pedirlo** — tiene que cerrar, abrir el otro widget y esperar que aparezca en
-- la lista. Lo reportó el usuario el 2026-08-06 probándolo.
--
-- Devuelve la misma forma que el `donde` de los faltantes, para que la pantalla
-- que arma el pedido sea una sola y no dos que se parecen.
--
-- Sale de `v_inventario_disponible`, así que trae la existencia YA descontada
-- de lo que salió y el conteo todavía no trajo, y con un factor por
-- (producto, tipo). Un `sum(cantidad)` hecho en el navegador sobre las filas de
-- la búsqueda mezclaría cajas con unidades — es el error que se corrigió hoy.

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
                   'erp_sucursal_id', d.erp_sucursal_id,
                   'branch_id',       m.branch_id
               ) AS x
        FROM public.v_inventario_disponible d
        LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = d.erp_sucursal_id
        LEFT JOIN public.product_stock_params sp
               ON sp.erp_product_id = d.erp_product_id
              AND sp.erp_sucursal_id = d.erp_sucursal_id
        WHERE d.erp_product_id = p_erp_product_id
          AND d.unidades > 0
          AND d.erp_sucursal_id <> p_erp_sucursal_destino
    ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_donde_hay(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_donde_hay(integer, integer) TO authenticated, service_role;
