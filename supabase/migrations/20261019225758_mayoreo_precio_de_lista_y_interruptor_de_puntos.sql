SET lock_timeout = '5s';
-- Mayoreo (2026-10-19) · UNA sola regla para el precio de lista del Cliente
-- Mayorista, y el interruptor de sus puntos.
--
-- Por qué: el catálogo de la app (`app_catalogo`, `app_catalogo_producto`) y el
-- cobro (`reservar_carrito` de app-clientes) decidían el precio de mayoreo cada
-- uno a su manera, y no coincidían en dos casos que existen en los datos:
--   · VIP más ALTO que la viñeta (33 renglones activos el 2026-10-19, casi
--     todos viñetas por unidad del tipo 0.1957 contra un VIP de 0.20): el
--     catálogo tomaba como techo el VIP y el cobro la viñeta, así que un
--     precio de mayoreo entre los dos se MOSTRABA y no se COBRABA.
--   · Mayoreo Plus (columna `mayoreo`) más CARO que Mayoreo (columna
--     `clinica`) — 16 renglones: al cliente Plus se le mostraba y cobraba más
--     que a uno de Mayoreo. Las Condiciones (§3) dicen que el Plus es «el más
--     conveniente»: se cobra el menor de los dos.
-- Esos datos vienen del sistema de origen y NO se corrigen acá; esta función
-- sólo hace que la pantalla y el cobro de la app digan lo mismo.
--
-- Regla (Condiciones del Cliente Mayorista §3):
--   preferente   = el menor entre la viñeta y el VIP (> 0)
--   mayoreo      = `clinica`, si es > 0 y menor que el preferente
--   mayoreo_plus = el menor entre `mayoreo` y `clinica` que sean > 0 y menores
--                  que el preferente (sin precio Plus, se cobra el de Mayoreo)
-- Sin `WITH` y sin tablas: el `search_path` vacío es sólo para el advisor.

CREATE OR REPLACE FUNCTION public.precio_de_lista(p_clave text, p_vineta numeric, p_vip numeric, p_clinica numeric, p_mayoreo numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT round(CASE p_clave
           WHEN 'preferente' THEN b.pref
           WHEN 'mayoreo' THEN CASE WHEN p_clinica > 0 AND p_clinica < b.pref THEN p_clinica END
           WHEN 'mayoreo_plus' THEN least(CASE WHEN p_mayoreo > 0 AND p_mayoreo < b.pref THEN p_mayoreo END,
                                          CASE WHEN p_clinica > 0 AND p_clinica < b.pref THEN p_clinica END)
         END, 2)
    FROM (SELECT CASE WHEN p_vineta > 0 THEN least(p_vineta, CASE WHEN p_vip > 0 THEN p_vip END) END AS pref) b;
$$;
REVOKE EXECUTE ON FUNCTION public.precio_de_lista(text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.precio_de_lista(text, numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- El interruptor de los puntos del Cliente Mayorista (Condiciones §5) y del
-- personal por renglón. APAGADO: el programa no está aprobado todavía.
-- Encender: UPDATE public.puntos_config SET mayoreo_puntos_activo = true;
ALTER TABLE public.puntos_config ADD COLUMN IF NOT EXISTS mayoreo_puntos_activo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.puntos_config.mayoreo_puntos_activo IS
  'Mayoreo (2026-10-19): con true, ventas_elegibles_puntos suma por renglón al Cliente Mayorista (rango a mayoreo, 1 pt/$ a Preferente) y al personal (sólo lo de Preferente). Con false, todo-o-nada por factura como siempre.';

-- El catálogo: la misma presentación de siempre (DISTINCT ON factor, la de
-- mayor viñeta), con los precios de mayoreo por la regla única de arriba.

CREATE OR REPLACE FUNCTION public.app_catalogo(p_q text, p_desde integer DEFAULT 0, p_limite integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
           pr.precio, pr.precio_vip, pr.precio_mayoreo, pr.precio_plus, pr.presentacion, pr.presentaciones,
           EXISTS (SELECT 1 FROM public.inventory i
                     JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                    WHERE i.erp_product_id = p.id AND i.cantidad > 0 AND NOT coalesce(i.is_vencidos, false)) AS disponible,
           array_position(v_ids, p.id) AS orden
      FROM public.products p
      CROSS JOIN LATERAL (
        SELECT u.precio, u.precio_vip, u.precio_mayoreo, u.precio_plus, u.tipo AS presentacion, count(*) OVER ()::int AS presentaciones
          FROM (SELECT DISTINCT ON (coalesce(pp.factor, 1))
                       round(pp.vineta, 2) AS precio,
                       CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END AS precio_vip,
                       -- Mayoreo (2026-10-19): la regla única de precio_de_lista.
                       public.precio_de_lista('mayoreo', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_mayoreo,
                       public.precio_de_lista('mayoreo_plus', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_plus,
                       pre.tipo, coalesce(pp.factor, 1) AS factor
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0
                 ORDER BY coalesce(pp.factor, 1), pp.vineta DESC) u
         ORDER BY u.factor DESC, u.precio DESC LIMIT 1
      ) pr
     WHERE p.id = ANY (v_ids) AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
       AND NOT EXISTS (SELECT 1 FROM public.app_catalogo_ocultos o WHERE o.product_id = p.id)
     ORDER BY array_position(v_ids, p.id)
     OFFSET greatest(coalesce(p_desde, 0), 0) LIMIT v_lim + 1
  ) r;

  RETURN json_build_object(
    'productos', coalesce((SELECT json_agg(e) FROM (SELECT e FROM json_array_elements(coalesce(v_res, '[]'::json)) WITH ORDINALITY AS t(e, n) WHERE n <= v_lim) z), '[]'::json),
    'hay_mas', coalesce(json_array_length(v_res), 0) > v_lim);
END $function$;

CREATE OR REPLACE FUNCTION public.app_catalogo_producto(p_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN (
    SELECT json_build_object(
      'id', p.id, 'nombre', p.nombre, 'foto', p.foto_url, 'principio_activo', p.principio_activo,
      'laboratorio', l.nombre,
      'bajo_receta', (coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false)),
      'presentaciones', coalesce((
        SELECT json_agg(json_build_object('tipo', x.tipo, 'precio', x.precio, 'precio_vip', x.precio_vip, 'factor', x.factor,
                                          'precio_mayoreo', x.precio_mayoreo, 'precio_plus', x.precio_plus)
                        ORDER BY x.precio)
          FROM (SELECT DISTINCT ON (coalesce(pp.factor, 1))
                       coalesce(pr.tipo, 'Unidad') AS tipo, round(pp.vineta, 2) AS precio,
                       CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END AS precio_vip,
                       -- Mayoreo (2026-10-19): la regla única de precio_de_lista.
                       public.precio_de_lista('mayoreo', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_mayoreo,
                       public.precio_de_lista('mayoreo_plus', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_plus,
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
     WHERE p.id = p_id AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
       AND NOT EXISTS (SELECT 1 FROM public.app_catalogo_ocultos o WHERE o.product_id = p.id));
END $function$;

-- El COBRO de la app (`reservar_carrito`): las mismas filas y los mismos
-- precios que mostró el catálogo, para hasta 10 productos. Antes el cobro leía
-- `product_precios` y repetía la regla en TypeScript, y ahí se separaban.
-- RETURNS json: pocas filas, pero así no hay techo de 1000 que recordar.
CREATE OR REPLACE FUNCTION public.app_precios_para_cobro(p_ids integer[])
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(to_json(x)), '[]'::json)
      FROM (SELECT DISTINCT ON (pp.product_id, coalesce(pp.factor, 1))
                   pp.product_id, coalesce(pp.factor, 1) AS factor, pre.tipo,
                   round(pp.vineta, 2) AS vineta,
                   CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END AS vip,
                   public.precio_de_lista('mayoreo', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_mayoreo,
                   public.precio_de_lista('mayoreo_plus', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_plus
              FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
             WHERE pp.product_id = ANY (p_ids[1:10]) AND pp.activo AND pp.vineta > 0
             ORDER BY pp.product_id, coalesce(pp.factor, 1), pp.vineta DESC) x);
END $$;
REVOKE EXECUTE ON FUNCTION public.app_precios_para_cobro(integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_precios_para_cobro(integer[]) TO service_role;
