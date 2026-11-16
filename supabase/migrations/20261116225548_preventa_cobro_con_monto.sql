-- Preventa: cobros con monto (2026-11-16). COMISIONES POR SERVICIO DE
-- CORRESPONSAL se cobra una vez al mes en Salud 3 por un monto que llega por
-- correo (valor neto + IVA). Su precio no viene en el catálogo: lo escribe
-- administración en la preventa, la función de caja lo pone como viñeta en
-- la ficha del producto (y lo verifica releyéndola) y la caja lo cobra con el
-- crédito fiscal, que calcula el IVA y la retención.
--  · `preventa_cobros_con_monto`: qué productos se cobran así y qué
--    presentación de la ficha lleva el precio.
--  · `preventa_cotizar`: la línea trae `monto`; sin él, error.
--  · `preventa_directa_preparar`: sólo los 4 cargos admin y sólo con crédito
--    fiscal.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.preventa_cobros_con_monto (
  product_id integer PRIMARY KEY REFERENCES public.products(id),
  id_pres_prod_erp integer NOT NULL,
  presentacion text NOT NULL DEFAULT 'UNIDAD',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.preventa_cobros_con_monto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS preventa_cobros_con_monto_select ON public.preventa_cobros_con_monto;
CREATE POLICY preventa_cobros_con_monto_select ON public.preventa_cobros_con_monto FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.preventa_cobros_con_monto FROM anon;
INSERT INTO public.preventa_cobros_con_monto (product_id, id_pres_prod_erp, presentacion)
SELECT 4239, 5573, 'UNIDAD TRANSACCION' WHERE EXISTS (SELECT 1 FROM public.products WHERE id = 4239)
ON CONFLICT (product_id) DO NOTHING;

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
        'tipo', pv.tipo, 'precio', pv.precio, 'precio_regular', pv.regular, 'lista', pv.lista,
        'cobro_con_monto', cm.product_id IS NOT NULL, 'monto', l.monto,
        'lista_pedida', l.lista_pedida,
        'id_presentacion', pr.id_presentacion, 'presentacion_pedida', l.pres_pedida,
        'precios', CASE WHEN pr.id IS NOT NULL AND cm.product_id IS NULL THEN json_build_object(
                     'vineta', round(pr.vineta, 2), 'descuento_1', round(pr.descuento_1, 2), 'vip', round(pr.vip, 2),
                     'clinica', round(pr.clinica, 2), 'mayoreo', round(pr.mayoreo, 2)) END,
        'subtotal', round(coalesce(pv.precio, 0) * l.cantidad, 2),
        'existencia', coalesce(ex.disp, 0),
        'otras', ot.lista_otras,
        'presentaciones', CASE WHEN cm.product_id IS NOT NULL
                            THEN json_build_array(json_build_object('factor', 1, 'tipo', cm.presentacion))
                            ELSE pres.lista_pres END,
        'error', CASE
          WHEN p.id IS NULL THEN 'Ese producto no existe.'
          WHEN NOT coalesce(p.activo, true) THEN 'Ese producto está inactivo.'
          WHEN cm.product_id IS NOT NULL AND l.factor <> 1 THEN 'Va por unidad.'
          WHEN cm.product_id IS NOT NULL AND l.monto IS NULL THEN 'Escribe el monto: neto más IVA.'
          WHEN cm.product_id IS NOT NULL AND (l.monto <= 0 OR l.monto > 99999.99) THEN 'El monto va de $0.01 a $99,999.99.'
          WHEN pv.precio IS NULL THEN 'Esa presentación no tiene precio.'
          WHEN l.cantidad IS NULL OR l.cantidad < 1 OR l.cantidad > 999 THEN 'La cantidad va de 1 a 999.'
          WHEN coalesce(ex.disp, 0) < l.cantidad * l.factor THEN
            'Hay ' || coalesce(ex.disp, 0)::int || ' unidades y se piden ' || (l.cantidad * l.factor) || '.'
        END) ORDER BY l.ord)
      FROM (SELECT (x->>'producto_id')::int AS producto_id, greatest(coalesce((x->>'factor')::int, 1), 1) AS factor,
                   (x->>'cantidad')::int AS cantidad, nullif(x->>'lista', '') AS lista_pedida,
                   CASE WHEN x->>'presentacion' ~ '^\d{1,9}$' THEN (x->>'presentacion')::int END AS pres_pedida,
                   CASE WHEN x->>'monto' ~ '^\d{1,5}(\.\d{1,2})?$' THEN round((x->>'monto')::numeric, 2) END AS monto, o AS ord
              FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS t(x, o)) l
      LEFT JOIN public.products p ON p.id = l.producto_id
      -- Un cobro con monto (2026-11-16): su precio lo escribe administración.
      LEFT JOIN public.preventa_cobros_con_monto cm ON cm.product_id = l.producto_id
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
        SELECT CASE WHEN cm.product_id IS NOT NULL THEN l.monto ELSE pr.precio END AS precio,
               CASE WHEN cm.product_id IS NOT NULL THEN l.monto ELSE pr.vineta END AS regular,
               CASE WHEN cm.product_id IS NOT NULL THEN 'vineta' ELSE pr.lista END AS lista,
               CASE WHEN cm.product_id IS NOT NULL THEN cm.presentacion ELSE pr.tipo END AS tipo) pv ON true
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


-- Parte de la definición VIVA de preventa_directa_preparar; agrega el freno
-- del cobro con monto y lo marca en el renglón.
CREATE OR REPLACE FUNCTION public.preventa_directa_preparar(p_employee uuid, p_branch bigint, p_customer bigint, p_documento text, p_nota text, p_lineas jsonb, p_preventa bigint DEFAULT NULL::bigint, p_motivo_precio text DEFAULT NULL::text, p_pago text DEFAULT 'contado'::text, p_puntos integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.employees; pv public.preventas; v_c json; v_erp int; v_id bigint; l json; v_err text;
  v_otro boolean; v_cli public.customers; v_total numeric; v_desc numeric := 0; v_pc json;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee AND status = 'ACTIVO';
  IF NOT FOUND OR NOT public.preventa_puede(p_employee, p_branch) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lineas) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Una preventa lleva de 1 a 30 productos.';
  END IF;
  IF (SELECT count(DISTINCT (x->>'producto_id') || '|' || coalesce(x->>'factor', '1')) FROM jsonb_array_elements(p_lineas) x)
     < jsonb_array_length(p_lineas) THEN
    RAISE EXCEPTION 'Un producto va una sola vez por presentación: súmale la cantidad.';
  END IF;
  -- Otro precio que el del cliente: sólo quien lo puede autorizar. Quien lo
  -- elige ES quien autoriza: queda en `enviada_por` y en el registro.
  v_otro := EXISTS (SELECT 1 FROM jsonb_array_elements(p_lineas) x WHERE nullif(x->>'lista', '') IS NOT NULL);
  IF v_otro AND NOT public.preventa_puede(p_employee, p_branch, 'can_approve') THEN
    RAISE EXCEPTION 'Otro precio que el del cliente necesita autorización.';
  END IF;
  IF p_pago NOT IN ('contado', 'tarjeta', 'transferencia', 'credito', 'cheque') THEN RAISE EXCEPTION 'Elige el tipo de pago.'; END IF;
  IF p_documento NOT IN ('consumidor_final', 'credito_fiscal') THEN RAISE EXCEPTION 'Elige el documento.'; END IF;
  SELECT * INTO v_cli FROM public.customers WHERE id = p_customer;
  IF p_pago = 'credito' AND public.cliente_es_generico(p_customer) THEN
    RAISE EXCEPTION 'El crédito necesita un cliente con sus datos.';
  END IF;
  IF p_documento = 'credito_fiscal' AND (v_cli.id IS NULL OR nullif(btrim(v_cli.nrc), '') IS NULL OR nullif(btrim(v_cli.nit), '') IS NULL) THEN
    RAISE EXCEPTION 'El crédito fiscal necesita un cliente con NIT y NRC: complétale los datos.';
  END IF;

  v_c := public.preventa_cotizar(p_branch, p_customer, p_lineas);
  FOR l IN SELECT * FROM json_array_elements(v_c->'lineas') LOOP
    v_err := l->>'error';
    IF v_err IS NOT NULL THEN RAISE EXCEPTION '«%»: %', coalesce(l->>'nombre', l->>'producto_id'), v_err; END IF;
    -- Un cobro con monto cambia el precio en la ficha del producto: sólo los
    -- 4 cargos admin, y sólo con crédito fiscal (así se cobra).
    IF coalesce((l->>'cobro_con_monto')::boolean, false) THEN
      IF e.role_id IS NULL OR e.role_id NOT IN (2, 3, 11, 13) THEN
        RAISE EXCEPTION '«%» sólo lo cobra administración.', l->>'nombre';
      END IF;
      IF p_documento <> 'credito_fiscal' THEN
        RAISE EXCEPTION '«%» va con crédito fiscal.', l->>'nombre';
      END IF;
    END IF;
  END LOOP;

  -- Descuento por puntos (2026-11-16): $0.01 por punto, como en caja. Se
  -- descuenta del saldo cuando la factura llega (`puntos_barrer_canjes`), así
  -- que acá se comprueba que alcance contando lo que ya apartaron otras
  -- preventas en caja, y que la venta no quede bajo el mínimo a pagar.
  v_total := (SELECT coalesce(sum((x->>'subtotal')::numeric), 0) FROM json_array_elements(v_c->'lineas') x);
  IF coalesce(p_puntos, 0) > 0 THEN
    v_pc := public.preventa_puntos_del_cliente(p_customer, p_preventa);
    IF NOT coalesce((v_pc->>'puede_canjear')::boolean, false) THEN
      RAISE EXCEPTION 'Este cliente no puede canjear puntos.';
    END IF;
    IF p_puntos < (v_pc->>'minimo_canje')::int THEN
      RAISE EXCEPTION 'Se canjean como mínimo % puntos.', v_pc->>'minimo_canje';
    END IF;
    IF p_puntos > (v_pc->>'tope')::int THEN RAISE EXCEPTION 'Se canjean como máximo % puntos por venta.', v_pc->>'tope'; END IF;
    IF p_puntos > (v_pc->>'disponibles')::int THEN
      RAISE EXCEPTION 'El cliente tiene % puntos disponibles y se piden %.', v_pc->>'disponibles', p_puntos;
    END IF;
    v_desc := round(p_puntos * 0.01, 2);
    IF v_total - v_desc < public.puntos_minimo_a_pagar((now() AT TIME ZONE 'America/El_Salvador')::date) THEN
      RAISE EXCEPTION 'Con ese canje la venta queda bajo el mínimo a pagar ($%).',
        to_char(public.puntos_minimo_a_pagar((now() AT TIME ZONE 'America/El_Salvador')::date), 'FM0.00');
    END IF;
  END IF;

  SELECT erp_sucursal_id INTO v_erp FROM public.erp_sucursal_map WHERE branch_id = p_branch AND NOT es_bodega;
  IF v_erp IS NULL THEN RAISE EXCEPTION 'Esa sucursal no factura en la caja.'; END IF;

  IF p_preventa IS NOT NULL THEN
    SELECT * INTO pv FROM public.preventas WHERE id = p_preventa FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa preventa no existe.'; END IF;
    IF pv.branch_id <> p_branch THEN RAISE EXCEPTION 'Esa preventa es de otra sucursal.'; END IF;
    IF pv.origen <> 'directa' THEN RAISE EXCEPTION 'Esa preventa es de una reserva: se corrige desde Reservas.'; END IF;
    IF pv.estado <> 'viva' OR pv.externo_id IS NULL THEN
      RAISE EXCEPTION 'Esa preventa ya no está en caja (%).', pv.estado;
    END IF;
    IF EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.erp_invoice_id = pv.externo_id AND si.branch_id = pv.branch_id) THEN
      RAISE EXCEPTION 'Esa preventa ya se facturó: no se puede corregir.';
    END IF;
    UPDATE public.preventas SET estado = 'enviando', customer_id = p_customer, enviada_por = p_employee,
           corregida_veces = corregida_veces + 1, error = NULL, updated_at = now()
     WHERE id = pv.id;
    v_id := pv.id;
  ELSE
    INSERT INTO public.preventas (branch_id, customer_id, reservas_ids, enviada_por, origen)
    VALUES (p_branch, p_customer, '{}', p_employee, 'directa') RETURNING id INTO v_id;
  END IF;

  RETURN json_build_object(
    'preventa_id', v_id, 'erp_sucursal', v_erp, 'branch_id', p_branch,
    'codigo', 'V-' || lpad(v_id::text, 6, '0'), 'tipo', 'directa',
    'externo_id', pv.externo_id, 'externo_ref', pv.externo_ref,
    'documento', p_documento, 'pago', p_pago, 'puntos', coalesce(p_puntos, 0), 'descuento_puntos', v_desc, 'nota', left(btrim(coalesce(p_nota, '')), 60),
    'motivo_precio', CASE WHEN v_otro THEN coalesce(nullif(btrim(p_motivo_precio), ''), 'autorizado por quien vende') END,
    'cliente', CASE WHEN v_cli.id IS NOT NULL THEN json_build_object('erp_id', v_cli.erp_id, 'name', v_cli.name) END,
    'vendedor', json_build_object('code', e.code, 'role_id', e.role_id),
    'pagado', 0, 'falta_pagar', NULL,
    'renglones', (SELECT json_agg(json_build_object(
        'reserva_id', NULL, 'producto_id', x->'producto_id', 'nombre', x->>'nombre', 'cantidad', x->'cantidad',
        'factor', x->'factor', 'precio_unitario', x->'precio', 'precio_normal', x->'precio_regular',
        'lista_precio', x->>'lista', 'lista_autorizada', x->>'lista_pedida',
        'cobro_con_monto', coalesce((x->>'cobro_con_monto')::boolean, false)))
      FROM json_array_elements(v_c->'lineas') x));
END $function$;
