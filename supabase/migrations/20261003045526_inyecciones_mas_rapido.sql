-- Inyecciones: las pantallas de supervisión, de 1-2 s a décimas (2026-10-03).
--
-- Medido en producción la noche del pase: el catálogo de Ajustes tardaba
-- 2.0 s y «Por cobrar» (30 días, todas las salas) 1.1 s — esta última era
-- 0.33 s antes de agregarle los renglones con dosis. En los dos casos el costo
-- era el mismo: llamar una función plpgsql POR RENGLÓN (`inyeccion_es_aplicable`
-- y `inyeccion_base_sugerida`, cada una con su búsqueda). Medido por partes:
--   · catálogo: evaluar el nombre en cada renglón de 90 días 1,688 ms →
--     agrupar antes por (producto, descripción) y evaluar lo distinto 243 ms;
--   · renglones de 1,956 facturas: 728 ms → con uniones directas 79 ms,
--     mismas 2,157 filas.
-- Las respuestas no cambian (comparado en prod antes de aplicar, dentro de una
-- transacción revertida: renglones 2,157/2,157, Por cobrar 80/80 y catálogo
-- 133/133, cero diferencias): misma regla (lo marcado a mano gana; si no, el
-- nombre), escrita como uniones en vez de llamadas. `inyeccion_es_aplicable` y
-- `inyeccion_base_sugerida` siguen existiendo y siguen siendo la regla para
-- quien pregunte por un producto suelto.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.inyeccion_renglones_de_venta(p_invoice_ids bigint[])
RETURNS TABLE (invoice_id bigint, linea_num smallint, erp_product_id integer,
               descripcion text, presentacion text, cantidad numeric, factor integer,
               por_unidad integer, confirmado boolean, total integer, usadas integer, disponibles integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
BEGIN
  RETURN QUERY
  WITH r AS MATERIALIZED (
    -- Lo marcado a mano gana; si no, el nombre (= inyeccion_es_aplicable).
    SELECT ii.invoice_id, ii.linea_num, ii.erp_product_id, ii.descripcion, ii.presentacion, ii.cantidad,
           greatest(coalesce(ii.factor_unidades, 1), 1)::int AS factor
    FROM public.sales_invoice_items ii
    LEFT JOIN public.inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
    WHERE ii.invoice_id = ANY (p_invoice_ids)
      AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion))
  ), sueltos AS (
    -- Se vende suelto (alguna presentación con factor > 1) → base 1
    -- (= inyeccion_base_sugerida).
    SELECT DISTINCT pp.product_id FROM public.product_precios pp
    WHERE pp.factor > 1 AND pp.product_id IN (SELECT r.erp_product_id FROM r)
  ), b AS (
    SELECT r.*, d.aplicaciones AS base_confirmada,
           CASE WHEN s.product_id IS NOT NULL THEN 1
                ELSE public.inyeccion_aplicaciones_por_nombre(r.descripcion) END AS base_sugerida
    FROM r
    LEFT JOIN public.inyeccion_dosis_producto d ON d.erp_product_id = r.erp_product_id
    LEFT JOIN sueltos s ON s.product_id = r.erp_product_id
  ), u AS (
    SELECT a.invoice_id, a.linea_num, count(*)::int AS usadas
    FROM public.inyeccion_aplicaciones a
    JOIN public.caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
    WHERE a.invoice_id = ANY (p_invoice_ids)
      AND (a.confirmada OR a.created_at > now() - interval '5 minutes')
    GROUP BY 1, 2
  )
  SELECT b.invoice_id, b.linea_num, b.erp_product_id, b.descripcion, b.presentacion, b.cantidad, b.factor,
         (b.factor * coalesce(b.base_confirmada, b.base_sugerida))::int,
         b.base_confirmada IS NOT NULL,
         floor(b.cantidad * b.factor * coalesce(b.base_confirmada, b.base_sugerida))::int,
         coalesce(u.usadas, 0),
         greatest(floor(b.cantidad * b.factor * coalesce(b.base_confirmada, b.base_sugerida))::int - coalesce(u.usadas, 0), 0)
  FROM b LEFT JOIN u ON u.invoice_id = b.invoice_id AND u.linea_num = b.linea_num;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_renglones_de_venta(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inyeccion_renglones_de_venta(bigint[]) TO service_role;

CREATE OR REPLACE FUNCTION public.inyecciones_para_cobrar(p_branch_id integer, p_buscar text DEFAULT NULL, p_dias integer DEFAULT 7)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE
  v_ids    bigint[];
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Igual que `operar-caja`: sin alcance total, sólo la sala propia.
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(si.id) INTO v_ids
  FROM sales_invoices si
  WHERE si.branch_id = p_branch_id
    AND si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - greatest(least(coalesce(p_dias, 7), 31), 0)
    AND public.venta_valida(si.estado)
    AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                LEFT JOIN inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
                WHERE ii.invoice_id = si.id
                  AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion))
                  -- Se busca por cliente, por factura o por la INYECCIÓN.
                  AND (v_buscar IS NULL
                       OR upper(si.cliente) LIKE '%' || v_buscar || '%'
                       OR si.correlativo LIKE '%' || v_buscar || '%'
                       OR upper(ii.descripcion) LIKE '%' || v_buscar || '%'));

  RETURN coalesce((
    SELECT json_agg(v ORDER BY v.fecha DESC, v.hora DESC NULLS LAST, v.id DESC)
    FROM (
      SELECT si.id, si.fecha, to_char(si.hora, 'HH24:MI') AS hora, si.correlativo, si.cliente,
             si.customer_id, si.cod_vendedor, ev.name AS vendedor_nombre, ev.id AS vendedor_id,
             json_agg(json_build_object(
               'linea_num', r.linea_num, 'descripcion', r.descripcion, 'presentacion', r.presentacion,
               'cantidad', r.cantidad, 'por_unidad', r.por_unidad, 'confirmado', r.confirmado,
               'total', r.total, 'usadas', r.usadas, 'disponibles', r.disponibles
             ) ORDER BY r.linea_num) AS renglones,
             sum(r.disponibles) AS disponibles
      FROM sales_invoices si
      JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.invoice_id = si.id
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      WHERE si.id = ANY (v_ids)
      GROUP BY si.id, ev.name, ev.id
      -- Sólo las que todavía tienen algo por pagar: una venta ya pagada entera
      -- no es una opción, es ruido en la lista (pedido del usuario).
      HAVING sum(r.disponibles) > 0
      ORDER BY si.fecha DESC, si.hora DESC NULLS LAST
      LIMIT 80
    ) v
  ), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyecciones_para_cobrar(integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyecciones_para_cobrar(integer, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inyeccion_catalogo_dosis()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NOT ((SELECT auth_has_module_permission('inyecciones_dosis', 'can_view'))
          OR (SELECT auth_has_module_permission('inyecciones_precios', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    WITH f AS MATERIALIZED (
      SELECT min(id) lo, max(id) hi FROM sales_invoices
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
             'confirmadas', d.aplicaciones, 'confirmado_por', e.name, 'confirmado_at', d.confirmado_at
           ) ORDER BY (c.es_inyeccion IS FALSE), (d.aplicaciones IS NOT NULL), v.ventas DESC)
    FROM v
    LEFT JOIN products p ON p.id = v.erp_product_id
    LEFT JOIN inyeccion_dosis_producto d ON d.erp_product_id = v.erp_product_id
    LEFT JOIN employees e ON e.id = d.confirmado_por
    LEFT JOIN inyeccion_producto_clasificacion c ON c.erp_product_id = v.erp_product_id
    LEFT JOIN employees ec ON ec.id = c.cambiado_por
  ), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_catalogo_dosis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_catalogo_dosis() TO authenticated, service_role;