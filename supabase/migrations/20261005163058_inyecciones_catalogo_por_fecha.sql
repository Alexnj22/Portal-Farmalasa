-- Inyecciones: el catálogo de Ajustes dejaba de recorrer la tabla de ventas
-- desde el principio (2026-10-05). Lo marcó `gate:perf` sección F: 1,191 MB
-- por llamada en 181 llamadas. Detalle en el comentario del cuerpo.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.inyeccion_catalogo_dosis()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT ((SELECT auth_has_module_permission('inyecciones_dosis', 'can_view'))
          OR (SELECT auth_has_module_permission('inyecciones_precios', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    WITH f AS MATERIALIZED (
      -- `id + 0` y no `id`: con `min(id)` a secas el planificador recorre la
      -- llave primaria desde la venta MÁS VIEJA buscando la primera del rango —
      -- medido el 2026-10-05: 320,763 ventas descartadas, ~160,000 bloques
      -- (1.2 GB) y hasta 3.6 s por apertura de Ajustes. Con `+ 0` entra por el
      -- índice de fecha: 7,000 bloques, 21 ms. Mismo resultado.
      SELECT min(id + 0) lo, max(id + 0) hi FROM sales_invoices
      WHERE fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
    ), pares AS MATERIALIZED (
      -- Agrupar ANTES de mirar el nombre: el nombre se evalúa una vez por
      -- (producto, descripción) distinto y no por renglón (1,688 → 243 ms).
      SELECT ii.erp_product_id, ii.descripcion, count(*) AS n
      FROM f JOIN sales_invoice_items ii ON ii.invoice_id BETWEEN f.lo AND f.hi
      WHERE ii.erp_product_id IS NOT NULL
      GROUP BY 1, 2
    ), vendidos AS MATERIALIZED (
      -- Lo vendido en 90 días que el NOMBRE da por inyección, o que alguien
      -- marcó a mano (en cualquier sentido: los quitados también se listan,
      -- para poder volver a incluirlos).
      SELECT g.erp_product_id, max(g.descripcion) AS descripcion, sum(g.n)::bigint AS ventas
      FROM pares g
      WHERE public.es_inyectable(g.descripcion)
         OR EXISTS (SELECT 1 FROM inyeccion_producto_clasificacion c WHERE c.erp_product_id = g.erp_product_id)
      GROUP BY 1
    ), v AS (
      SELECT * FROM vendidos
      UNION ALL
      -- Marcados a mano como inyección que no se vendieron en 90 días.
      SELECT c.erp_product_id, p.nombre, 0
      FROM inyeccion_producto_clasificacion c JOIN products p ON p.id = c.erp_product_id
      WHERE c.es_inyeccion AND NOT EXISTS (SELECT 1 FROM vendidos x WHERE x.erp_product_id = c.erp_product_id)
    )
    SELECT json_agg(json_build_object(
             'erp_product_id', v.erp_product_id,
             'descripcion', coalesce(p.nombre, v.descripcion), 'ventas', v.ventas,
             -- auto: lo decide el nombre · incluido / quitado: marcado a mano.
             'clasificacion', CASE WHEN c.es_inyeccion IS NULL THEN 'auto'
                                   WHEN c.es_inyeccion THEN 'incluido' ELSE 'quitado' END,
             'clasificado_por', ec.name,
             -- Cómo se vende: «suelta y caja de 5». Le dice a quien confirma
             -- qué es la unidad base.
             'factores', (SELECT array_agg(DISTINCT pp.factor ORDER BY pp.factor)
                          FROM product_precios pp WHERE pp.product_id = v.erp_product_id AND pp.factor IS NOT NULL),
             'sugeridas', public.inyeccion_base_sugerida(v.erp_product_id, v.descripcion),
             'confirmadas', d.aplicaciones, 'confirmado_por', e.name, 'confirmado_at', d.confirmado_at,
             -- Por ml: el vial y las dosis que se usan.
             'contenido_ml', m.contenido_ml, 'opciones_ml', m.dosis_ml, 'ml_por', em.name
           ) ORDER BY (c.es_inyeccion IS FALSE), (d.aplicaciones IS NOT NULL OR m.erp_product_id IS NOT NULL), v.ventas DESC)
    FROM v
    LEFT JOIN products p ON p.id = v.erp_product_id
    LEFT JOIN inyeccion_dosis_producto d ON d.erp_product_id = v.erp_product_id
    LEFT JOIN employees e ON e.id = d.confirmado_por
    LEFT JOIN inyeccion_dosis_ml m ON m.erp_product_id = v.erp_product_id
    LEFT JOIN employees em ON em.id = m.confirmado_por
    LEFT JOIN inyeccion_producto_clasificacion c ON c.erp_product_id = v.erp_product_id
    LEFT JOIN employees ec ON ec.id = c.cambiado_por
  ), '[]'::json);
END;
$function$;