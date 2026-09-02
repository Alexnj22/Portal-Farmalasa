-- Las presentaciones en que se ha vendido un producto, agrupadas POR FACTOR.
--
-- Por factor y no por rótulo, y es el hallazgo que ordenó todo el módulo: sobre
-- las 39,329 líneas de venta de agosto 2026, `id_presentacion` es NULL en el
-- 100%, hay 283 etiquetas distintas (217 al normalizar mayúsculas y espacios) y
-- sólo 29 factores. El mismo producto se factura como `CAJA 1x100` y
-- `CAJA 1X100`, y ORFENAFLEX AMPOLLA aparece como `CAJA  1X1` con dos espacios.
-- Agrupar por el texto partiría en dos una presentación que es una sola.
--
-- Devuelve el rótulo más frecuente de cada factor —para que la pantalla diga
-- «Caja» y no «×100» a secas— pero la CLAVE es el factor.
--
-- DEFINER porque lee `sales_invoice_items`, cuya policy pide permisos de ventas
-- que quien arma una promoción no tiene por qué tener. Por INVOKER devolvería
-- cero presentaciones sin dar error, y el selector saldría vacío.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_presentaciones_de_producto(p_erp_product_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_out json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.factor), '[]'::json)
      INTO v_out
      FROM (
        SELECT ii.factor_unidades AS factor,
               -- El rótulo que más veces se usó para ese factor. Se limpia el
               -- espacio de más y se deja en mayúscula inicial para que el
               -- desplegable no muestre la basura del origen.
               (array_agg(btrim(regexp_replace(ii.presentacion, '\s+', ' ', 'g'))
                          ORDER BY ii.n DESC))[1] AS etiqueta,
               sum(ii.n)::int AS lineas
          FROM (
            SELECT s.factor_unidades, s.presentacion, count(*) AS n
              FROM public.sales_invoice_items s
             WHERE s.erp_product_id = p_erp_product_id
               AND s.factor_unidades IS NOT NULL
             GROUP BY s.factor_unidades, s.presentacion
          ) ii
         GROUP BY ii.factor_unidades
      ) x;

    RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.get_presentaciones_de_producto(integer) IS
  'Las presentaciones de un producto agrupadas por FACTOR, con el rótulo más usado de cada una. El factor es la clave porque el rótulo está sucio: 283 etiquetas para 29 factores.';

ALTER FUNCTION public.get_presentaciones_de_producto(integer) SET plan_cache_mode = 'force_custom_plan';

REVOKE EXECUTE ON FUNCTION public.get_presentaciones_de_producto(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_presentaciones_de_producto(integer) TO authenticated, service_role;
