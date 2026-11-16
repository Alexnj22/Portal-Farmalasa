-- Preventa (2026-11-16, usuario: «este producto tenía 2 precios de viñeta,
-- ¿cómo sabemos cuál es?»). Un producto puede tener dos presentaciones con
-- las mismas unidades y distinta viñeta (ACETAMINOFEN 500MG CAJA X 100 TAB MK:
-- CAJA $10.61 y CAJA $10.65; 1,568 productos así). La existencia no dice de
-- cuál viñeta es cada caja: lo sabe quien la tiene en la mano. Ahora cada
-- línea puede pedir la suya (`presentacion` = id_presentacion de
-- product_precios); sin pedirla, la de viñeta más alta, como antes. La lista
-- `presentaciones` trae cada una con su viñeta para elegirla en pantalla.
-- Parte de la definición VIVA (md5 53192d34…).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.preventa_cotizar(p_branch bigint, p_customer bigint, p_lineas jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lista text := public.lista_de_precio_del_cliente(p_customer);
  v_ids int[];
  v_exist json;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.preventa_puede(public.auth_employee_id(), p_branch, 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'No se dijo qué productos.'; END IF;
  SELECT array_agg(DISTINCT (x->>'producto_id')::int) INTO v_ids FROM jsonb_array_elements(p_lineas) x;
  v_exist := CASE WHEN v_ids IS NULL THEN '[]'::json ELSE public.app_existencias_netas(v_ids) END;
  RETURN json_build_object(
    'lista', v_lista,
    'generico', public.cliente_es_generico(p_customer),
    'cliente', (SELECT json_build_object('id', c.id, 'name', c.name, 'erp_id', c.erp_id, 'nrc', c.nrc, 'nit', c.nit,
                                          'dui', c.dui, 'giro', c.giro, 'email', c.email, 'direccion', c.direccion,
                                          'departamento', c.departamento, 'municipio', c.municipio, 'distrito', c.distrito,
                                          'categoria', c.categoria, 'phone', c.phone)
                  FROM public.customers c WHERE c.id = p_customer),
    'lineas', coalesce((
      SELECT json_agg(json_build_object(
        'producto_id', l.producto_id, 'factor', l.factor, 'cantidad', l.cantidad,
        'nombre', p.nombre, 'bajo_receta', coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false),
        'tipo', pr.tipo, 'precio', pr.precio, 'precio_regular', pr.vineta, 'lista', pr.lista,
        'lista_pedida', l.lista_pedida,
        'id_presentacion', pr.id_presentacion, 'presentacion_pedida', l.pres_pedida,
        'precios', CASE WHEN pr.id IS NOT NULL THEN json_build_object(
                     'vineta', round(pr.vineta, 2), 'descuento_1', round(pr.descuento_1, 2), 'vip', round(pr.vip, 2),
                     'clinica', round(pr.clinica, 2), 'mayoreo', round(pr.mayoreo, 2)) END,
        'subtotal', round(coalesce(pr.precio, 0) * l.cantidad, 2),
        'existencia', coalesce(ex.disp, 0),
        'otras', ot.lista_otras,
        'presentaciones', pres.lista_pres,
        'error', CASE
          WHEN p.id IS NULL THEN 'Ese producto no existe.'
          WHEN NOT coalesce(p.activo, true) THEN 'Ese producto está inactivo.'
          WHEN pr.precio IS NULL THEN 'Esa presentación no tiene precio.'
          WHEN l.cantidad IS NULL OR l.cantidad < 1 OR l.cantidad > 999 THEN 'La cantidad va de 1 a 999.'
          WHEN coalesce(ex.disp, 0) < l.cantidad * l.factor THEN
            'Hay ' || coalesce(ex.disp, 0)::int || ' unidades y se piden ' || (l.cantidad * l.factor) || '.'
        END) ORDER BY l.ord)
      FROM (SELECT (x->>'producto_id')::int AS producto_id, greatest(coalesce((x->>'factor')::int, 1), 1) AS factor,
                   (x->>'cantidad')::int AS cantidad, nullif(x->>'lista', '') AS lista_pedida,
                   CASE WHEN x->>'presentacion' ~ '^\d{1,9}$' THEN (x->>'presentacion')::int END AS pres_pedida, o AS ord
              FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS t(x, o)) l
      LEFT JOIN public.products p ON p.id = l.producto_id
      LEFT JOIN LATERAL (
        SELECT max(coalesce(pp.factor, 1))::int AS mayor FROM public.product_precios pp
         WHERE pp.product_id = l.producto_id AND pp.activo AND pp.vineta > 0) fm ON true
      LEFT JOIN LATERAL (
        SELECT q.*, round(CASE q.lista WHEN 'mayoreo' THEN q.mayoreo WHEN 'clinica' THEN q.clinica WHEN 'vip' THEN q.vip
                                       WHEN 'descuento_1' THEN q.descuento_1 ELSE q.vineta END, 2) AS precio
          FROM (SELECT pp.*, coalesce(pre.tipo, 'Unidad') AS tipo,
                       -- La lista pedida a mano se respeta en cualquier presentación.
                       public.preventa_lista_efectiva(coalesce(l.lista_pedida, v_lista), l.factor,
                         CASE WHEN l.lista_pedida IS NOT NULL THEN l.factor ELSE fm.mayor END,
                         pp.mayoreo, pp.clinica, pp.vip, pp.descuento_1, pp.vineta) AS lista
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = l.producto_id AND coalesce(pp.factor, 1) = l.factor AND pp.activo AND pp.vineta > 0
                 -- La viñeta pedida primero; si no existe (ya no está activa), la más alta.
                 ORDER BY (pp.id_presentacion = l.pres_pedida) DESC NULLS LAST, pp.vineta DESC LIMIT 1) q) pr ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('factor', z.factor, 'tipo', z.tipo, 'id_presentacion', z.id_presentacion,
                                          'vineta', z.vineta) ORDER BY z.factor, z.vineta DESC) AS lista_pres
          FROM (SELECT coalesce(pp.factor, 1)::int AS factor, coalesce(pre.tipo, 'Unidad') AS tipo,
                       pp.id_presentacion, round(pp.vineta, 2) AS vineta
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = l.producto_id AND pp.activo AND pp.vineta > 0) z) pres ON true
      LEFT JOIN LATERAL (
        SELECT max((e->>'disponibles')::numeric) AS disp FROM json_array_elements(v_exist) e
         WHERE (e->>'product_id')::int = l.producto_id AND (e->>'branch_id')::bigint = p_branch) ex ON true
      -- Dónde más hay, para decirle al cliente o pedir un traslado.
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('sucursal', w.name, 'disponibles', w.disp) ORDER BY w.disp DESC) AS lista_otras
          FROM (SELECT b.name, (e->>'disponibles')::numeric::int AS disp
                  FROM json_array_elements(v_exist) e JOIN public.branches b ON b.id = (e->>'branch_id')::bigint
                 WHERE (e->>'product_id')::int = l.producto_id AND (e->>'branch_id')::bigint <> p_branch
                   AND (e->>'disponibles')::numeric > 0
                 ORDER BY (e->>'disponibles')::numeric DESC LIMIT 3) w) ot ON true
    ), '[]'::json));
END $function$;
