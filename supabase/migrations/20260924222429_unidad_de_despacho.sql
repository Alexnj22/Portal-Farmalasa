SET lock_timeout = '5s';

-- En qué presentación, y de a cuántas unidades, viaja un producto entre Bodega
-- y las salas. Es `unit_base` de `get_pedido_preview` dicho para un producto
-- suelto, con las MISMAS dos reglas y en el mismo orden:
--
--   1. con regla de despacho (`dispatch_rules`, las 851 que hay hoy usan
--      presentación): esa presentación × su múltiplo;
--   2. sin regla: la presentación más chica mayor a 1 (`auto_pres_factor`);
--   3. si sólo tiene la unidad: de a 1.
--
-- Nace del usuario (2026-09-24): «a Bodega no se pueden enviar productos en
-- unidades; sólo se pueden regresar según las reglas». La usan el envío
-- (freno al devolver a Bodega por baja rotación) y `productos_parados_de_sala`
-- (cuántas presentaciones completas hay), para que las dos digan lo mismo.
--
-- Las variantes viejas de la regla (solo_cajas, múltiplo, blíster, múltiplo en
-- unidades) no tienen ni una fila hoy; si vuelven a usarse, esta función y la
-- de pedidos tienen que moverse juntas.
CREATE OR REPLACE FUNCTION public.unidad_de_despacho(p_ids integer[])
RETURNS TABLE(erp_product_id integer, tipo text, etiqueta text, factor numeric, multiplo integer, unidades numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
#variable_conflict use_column
BEGIN
    -- plpgsql y no sql: con `SET` y parámetros, una función sql nace con plan
    -- genérico (CLAUDE.md, trampa 4). Acá el plan no depende del argumento,
    -- pero así no hay que declararla en `planes-genericos.json`.
    RETURN QUERY
    WITH ids AS (SELECT DISTINCT unnest(p_ids) AS pid),
    regla AS (
        SELECT DISTINCT ON (dr.erp_product_id) dr.erp_product_id AS pid,
               pres.tipo AS r_tipo, COALESCE(dr.dispatch_label, pres.tipo) AS r_etiqueta,
               pp.factor::numeric AS r_factor, COALESCE(dr.dispatch_multiplo, 1)::int AS r_multiplo
          FROM dispatch_rules dr
          JOIN product_precios pp ON pp.product_id = dr.erp_product_id AND pp.id_presentacion = dr.dispatch_id_presentacion
          JOIN presentaciones pres ON pres.id = dr.dispatch_id_presentacion
         WHERE dr.dispatch_id_presentacion IS NOT NULL
           AND dr.erp_product_id IN (SELECT pid FROM ids)
         ORDER BY dr.erp_product_id, pp.factor DESC
    ),
    auto AS (
        SELECT DISTINCT ON (pp.product_id) pp.product_id AS pid, pres.tipo AS a_tipo, pp.factor::numeric AS a_factor
          FROM product_precios pp JOIN presentaciones pres ON pres.id = pp.id_presentacion
         WHERE pp.factor > 1 AND pp.activo
           AND pp.product_id IN (SELECT pid FROM ids)
           AND pp.product_id NOT IN (SELECT pid FROM regla)
         ORDER BY pp.product_id, pp.factor ASC
    )
    SELECT i.pid::int,
           COALESCE(r.r_tipo, a.a_tipo, 'UNIDAD')::text,
           COALESCE(r.r_etiqueta, a.a_tipo, 'UNIDAD')::text,
           COALESCE(r.r_factor, a.a_factor, 1),
           COALESCE(r.r_multiplo, 1),
           COALESCE(r.r_factor * r.r_multiplo, a.a_factor, 1)
      FROM ids i
      LEFT JOIN regla r ON r.pid = i.pid
      LEFT JOIN auto a  ON a.pid = i.pid;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.unidad_de_despacho(integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unidad_de_despacho(integer[]) TO authenticated, service_role;
