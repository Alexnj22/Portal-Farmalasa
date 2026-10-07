SET lock_timeout = '5s';

-- El catálogo de la app de clientes (2026-10-07): por ahora, precio de viñeta
-- y precio VIP de cada presentación, y en qué sucursales hay. Lo lee sólo
-- `app-clientes` (service_role).

-- Lo más vendido de los últimos 60 días: lo que el catálogo muestra antes de
-- buscar. Una tabla chica que un cron rehace cada noche, para no sumar 70,000
-- renglones cada vez que alguien abre la pestaña.
CREATE TABLE public.app_catalogo_destacados (
    product_id  integer PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
    unidades    numeric NOT NULL,
    posicion    integer NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_catalogo_destacados_posicion_idx ON public.app_catalogo_destacados (posicion);
ALTER TABLE public.app_catalogo_destacados ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_catalogo_destacados_select ON public.app_catalogo_destacados
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_view')));

CREATE FUNCTION public.app_catalogo_rehacer_destacados()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v integer;
BEGIN
  DELETE FROM public.app_catalogo_destacados;
  INSERT INTO public.app_catalogo_destacados (product_id, unidades, posicion)
  SELECT x.id, x.unidades, row_number() OVER (ORDER BY x.unidades DESC, x.id)
    FROM (
      SELECT p.id, sum(ii.cantidad) AS unidades
        FROM public.sales_invoice_items ii
        JOIN public.sales_invoices si ON si.id = ii.invoice_id
        JOIN public.products p ON p.id = ii.erp_product_id
       WHERE si.fecha > (now() AT TIME ZONE 'America/El_Salvador')::date - 60
         AND public.venta_valida(si.estado)
         AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
         AND EXISTS (SELECT 1 FROM public.product_precios pp WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0)
       GROUP BY p.id
       ORDER BY 2 DESC
       LIMIT 300
    ) x;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION public.app_catalogo_rehacer_destacados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_catalogo_rehacer_destacados() TO service_role;

SELECT public.app_catalogo_rehacer_destacados();

-- Cada noche a las 2:40 SV (08:40 UTC), fuera del horario de los syncs.
SELECT cron.schedule('app-catalogo-destacados', '40 8 * * *', $c$SELECT public.app_catalogo_rehacer_destacados()$c$);

-- Una página del catálogo: con texto, la búsqueda del portal
-- (`buscar_productos_ids`, nombre y principio activo); sin texto, lo más
-- vendido. Por producto: el precio de viñeta y el VIP más bajos de sus
-- presentaciones, cuántas tiene y si hay en alguna sucursal.
CREATE FUNCTION public.app_catalogo(p_q text, p_desde integer DEFAULT 0, p_limite integer DEFAULT 30)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE
  v_ids integer[];
  v_q text := trim(coalesce(p_q, ''));
  v_lim integer := least(greatest(coalesce(p_limite, 30), 1), 50);
  v_res json;
BEGIN
  IF length(v_q) >= 2 THEN
    SELECT array_agg((x)::integer) INTO v_ids
      FROM json_array_elements_text((public.buscar_productos_ids(v_q, 200, true, false, true))->'ids') x;
  ELSE
    SELECT array_agg(product_id ORDER BY posicion) INTO v_ids FROM public.app_catalogo_destacados;
  END IF;
  IF v_ids IS NULL THEN RETURN json_build_object('productos', '[]'::json, 'hay_mas', false); END IF;

  SELECT json_agg(r ORDER BY r.orden) INTO v_res FROM (
    SELECT p.id, p.nombre, p.foto_url AS foto, p.principio_activo,
           (coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false)) AS bajo_receta,
           pr.precio, pr.precio_vip, pr.presentaciones,
           EXISTS (SELECT 1 FROM public.inventory i
                     JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                    WHERE i.erp_product_id = p.id AND i.cantidad > 0 AND NOT coalesce(i.is_vencidos, false)) AS disponible,
           array_position(v_ids, p.id) AS orden
      FROM public.products p
      CROSS JOIN LATERAL (
        SELECT round(min(pp.vineta), 2) AS precio,
               round(min(nullif(pp.vip, 0)) FILTER (WHERE pp.vip < pp.vineta), 2) AS precio_vip,
               count(*)::int AS presentaciones
          FROM public.product_precios pp WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0
      ) pr
     WHERE p.id = ANY (v_ids) AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
       AND pr.precio IS NOT NULL
     ORDER BY array_position(v_ids, p.id)
     OFFSET greatest(coalesce(p_desde, 0), 0) LIMIT v_lim + 1
  ) r;

  RETURN json_build_object(
    'productos', coalesce((SELECT json_agg(e) FROM (SELECT e FROM json_array_elements(coalesce(v_res, '[]'::json)) WITH ORDINALITY AS t(e, n) WHERE n <= v_lim) z), '[]'::json),
    'hay_mas', coalesce(json_array_length(v_res), 0) > v_lim);
END $$;
REVOKE EXECUTE ON FUNCTION public.app_catalogo(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_catalogo(text, integer, integer) TO service_role;

-- La ficha de un producto: presentaciones con sus dos precios, laboratorio y
-- en qué sucursal hay (pocas = menos de 5).
CREATE FUNCTION public.app_catalogo_producto(p_id integer)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
BEGIN
  RETURN (
    SELECT json_build_object(
      'id', p.id, 'nombre', p.nombre, 'foto', p.foto_url, 'principio_activo', p.principio_activo,
      'laboratorio', l.nombre,
      'bajo_receta', (coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false)),
      'presentaciones', coalesce((
        SELECT json_agg(json_build_object(
                 'tipo', coalesce(pr.tipo, 'Unidad'), 'precio', round(pp.vineta, 2),
                 'precio_vip', CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END)
               ORDER BY pp.vineta)
          FROM public.product_precios pp LEFT JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
         WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0), '[]'::json),
      'existencias', coalesce((
        SELECT json_agg(json_build_object('branch_id', s.branch_id, 'nivel', CASE WHEN s.cant >= 5 THEN 'hay' ELSE 'pocas' END)
                        ORDER BY s.branch_id)
          FROM (SELECT m.branch_id, sum(i.cantidad) AS cant
                  FROM public.inventory i
                  JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                 WHERE i.erp_product_id = p.id AND NOT coalesce(i.is_vencidos, false)
                 GROUP BY m.branch_id HAVING sum(i.cantidad) > 0) s), '[]'::json))
      FROM public.products p LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
     WHERE p.id = p_id AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false));
END $$;
REVOKE EXECUTE ON FUNCTION public.app_catalogo_producto(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_catalogo_producto(integer) TO service_role;
