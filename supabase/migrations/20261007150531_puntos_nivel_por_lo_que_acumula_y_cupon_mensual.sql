SET lock_timeout = '5s';

-- 1 · El nivel se mide con lo que ACUMULA, no con todo lo comprado (usuario,
-- 2026-10-07: «los demás no acumulan puntos así que no cuenta»). Una compra
-- acumula sólo si se vendió a precio VIP o más alto; la medida exacta son los
-- puntos BASE (1 por dólar) que dio cada venta: los del motor (`venta`) y los
-- del sistema anterior (`migracion` con motivo «compra · ticket …»). Medido
-- ese día: 83 Plata, 34 Oro, 8 Platino (contra 495/133/63 contando todo).
-- Y es más barato: un índice por cliente y fecha en una tabla chica.
CREATE OR REPLACE FUNCTION public.puntos_compra_12m(p_customer_id bigint, p_hasta date, p_excluir bigint DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
BEGIN
  RETURN coalesce((
    SELECT sum(coalesce(l.puntos_base, l.puntos)) FROM public.puntos_lote l
     WHERE l.customer_id = p_customer_id
       AND l.ganado_el > p_hasta - 365 AND l.ganado_el <= p_hasta
       AND (l.origen = 'venta' OR (l.origen = 'migracion' AND l.motivo ILIKE 'compra%'))
       AND (p_excluir IS NULL OR l.invoice_id IS DISTINCT FROM p_excluir)), 0);
END $$;

-- 2 · El cupón mensual de Platino (plan: «cupón mensual exclusivo»). Se da
-- como PUNTOS que vencen a fin de mes: se usa en caja igual que cualquier
-- saldo, con la misma tarjeta y el mismo canje —no hace falta tocar la caja— y
-- lo que no se usa se vence solo con `puntos-vencer-diario`. Monto y tope son
-- una fila: `puntos_niveles.cupon_mensual` y `puntos_config.cupon_presupuesto_mensual`.
ALTER TABLE public.puntos_niveles ADD COLUMN cupon_mensual integer NOT NULL DEFAULT 0 CHECK (cupon_mensual >= 0);
UPDATE public.puntos_niveles SET cupon_mensual = 500 WHERE clave = 'platino';  -- 500 puntos = $5
ALTER TABLE public.puntos_config ADD COLUMN cupon_presupuesto_mensual integer NOT NULL DEFAULT 10000
  CHECK (cupon_presupuesto_mensual >= 0);  -- en puntos: 10,000 = $100 al mes como máximo

ALTER TABLE public.puntos_lote DROP CONSTRAINT puntos_lote_origen_check;
ALTER TABLE public.puntos_lote ADD CONSTRAINT puntos_lote_origen_check
  CHECK (origen = ANY (ARRAY['venta', 'ajuste', 'migracion', 'cumpleanos', 'venta_pasada', 'referido', 'cupon'])) NOT VALID;
CREATE UNIQUE INDEX puntos_lote_un_cupon_por_mes ON public.puntos_lote (customer_id, date_trunc('month', ganado_el::timestamp))
  WHERE origen = 'cupon';

CREATE FUNCTION public.puntos_dar_cupones(p_dia date DEFAULT NULL, p_simular boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_dia date := coalesce(p_dia, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_fin date := (date_trunc('month', v_dia) + interval '1 month - 1 day')::date;
  v_tope integer;
  v_dado integer;
  r record; v_n integer := 0; v_total integer := 0; v_sin_tope integer := 0;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  SELECT cupon_presupuesto_mensual INTO v_tope FROM public.puntos_config WHERE id;
  SELECT coalesce(sum(puntos), 0) INTO v_dado FROM public.puntos_lote
   WHERE origen = 'cupon' AND date_trunc('month', ganado_el) = date_trunc('month', v_dia);

  -- Los candidatos: quien acumula y tuvo compras que acumulan en el año.
  FOR r IN
    SELECT c.id, n.cupon_mensual, n.nombre
      FROM (SELECT DISTINCT l.customer_id FROM public.puntos_lote l
             WHERE l.ganado_el > v_dia - 365 AND l.origen IN ('venta', 'migracion')) x
      JOIN public.customers c ON c.id = x.customer_id
      CROSS JOIN LATERAL public.puntos_nivel_de(public.puntos_compra_12m(c.id, v_dia)) n
     WHERE n.cupon_mensual > 0
       AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))
     ORDER BY public.puntos_compra_12m(c.id, v_dia) DESC
  LOOP
    -- El presupuesto del mes: lo que no cabe, no se da (y se cuenta).
    IF v_dado + v_total + r.cupon_mensual > coalesce(v_tope, 0) THEN v_sin_tope := v_sin_tope + 1; CONTINUE; END IF;
    v_n := v_n + 1;
    v_total := v_total + r.cupon_mensual;
    CONTINUE WHEN p_simular;
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.id) ON CONFLICT (customer_id) DO NOTHING;
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.id, 'cupon', r.cupon_mensual, r.cupon_mensual, v_dia, v_fin, 'Cupón ' || r.nombre || ' del mes');
    UPDATE public.puntos_cuenta SET saldo = saldo + r.cupon_mensual, ganados = ganados + r.cupon_mensual, updated_at = now()
     WHERE customer_id = r.id;
  END LOOP;

  RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', v_n, 'puntos', v_total,
                           'vence', v_fin, 'fuera_del_presupuesto', v_sin_tope);
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_dar_cupones(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_dar_cupones(date, boolean) TO service_role;

-- Todos los días a las 7:15 SV: el día 1 se da a todos; los otros días, sólo
-- a quien llegó a Platino durante el mes (el índice único impide dos).
SELECT cron.schedule('puntos-cupones-diario', '15 13 * * *',
  $c$SELECT public.puntos_dar_cupones() WHERE public.puntos_fuente() = 'portal'$c$);

-- 3 · Catálogo: una presentación por FACTOR, la de mayor precio (usuario,
-- 2026-10-07: «siempre deja la de mayor valor si es el mismo factor»). Neurobion
-- salía como «caja x 1 amp $8.95» y «caja $9.45»: es el mismo producto con dos
-- filas de precio y hoy no se sabe cuánto hay de cada una por sucursal.
CREATE OR REPLACE FUNCTION public.app_catalogo_producto(p_id integer)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
BEGIN
  RETURN (
    SELECT json_build_object(
      'id', p.id, 'nombre', p.nombre, 'foto', p.foto_url, 'principio_activo', p.principio_activo,
      'laboratorio', l.nombre,
      'bajo_receta', (coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false)),
      'presentaciones', coalesce((
        SELECT json_agg(json_build_object('tipo', x.tipo, 'precio', x.precio, 'precio_vip', x.precio_vip, 'factor', x.factor)
                        ORDER BY x.precio)
          FROM (SELECT DISTINCT ON (coalesce(pp.factor, 1))
                       coalesce(pr.tipo, 'Unidad') AS tipo, round(pp.vineta, 2) AS precio,
                       CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END AS precio_vip,
                       coalesce(pp.factor, 1) AS factor
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
                 WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0
                 ORDER BY coalesce(pp.factor, 1), pp.vineta DESC) x), '[]'::json),
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

CREATE OR REPLACE FUNCTION public.app_catalogo(p_q text, p_desde integer DEFAULT 0, p_limite integer DEFAULT 30)
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
           pr.precio, pr.precio_vip, pr.presentacion, pr.presentaciones,
           EXISTS (SELECT 1 FROM public.inventory i
                     JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                    WHERE i.erp_product_id = p.id AND i.cantidad > 0 AND NOT coalesce(i.is_vencidos, false)) AS disponible,
           array_position(v_ids, p.id) AS orden
      FROM public.products p
      CROSS JOIN LATERAL (
        -- Una por factor (la de mayor precio), y de ésas la más barata: «Desde».
        SELECT u.precio, u.precio_vip, u.tipo AS presentacion, count(*) OVER ()::int AS presentaciones
          FROM (SELECT DISTINCT ON (coalesce(pp.factor, 1))
                       round(pp.vineta, 2) AS precio,
                       CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END AS precio_vip,
                       pre.tipo
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0
                 ORDER BY coalesce(pp.factor, 1), pp.vineta DESC) u
         ORDER BY u.precio ASC LIMIT 1
      ) pr
     WHERE p.id = ANY (v_ids) AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
     ORDER BY array_position(v_ids, p.id)
     OFFSET greatest(coalesce(p_desde, 0), 0) LIMIT v_lim + 1
  ) r;

  RETURN json_build_object(
    'productos', coalesce((SELECT json_agg(e) FROM (SELECT e FROM json_array_elements(coalesce(v_res, '[]'::json)) WITH ORDINALITY AS t(e, n) WHERE n <= v_lim) z), '[]'::json),
    'hay_mas', coalesce(json_array_length(v_res), 0) > v_lim);
END $$;
