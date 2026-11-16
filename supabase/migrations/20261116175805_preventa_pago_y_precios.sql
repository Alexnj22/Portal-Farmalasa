-- Preventa, segunda vuelta (2026-11-16, usuario: «no es nada práctico»).
--
-- · Tipo de pago: contado, tarjeta, transferencia, crédito o cheque. Viaja a la
--   caja tal cual (el crédito exige un cliente con datos).
-- · Otro precio: quien tiene `preventa.can_approve` ES quien autoriza; ya no se
--   le pide motivo (queda anotado quién y qué lista en la preventa y el
--   registro). La lista pedida se respeta exacta: Mayoreo Plus en un blíster es
--   Mayoreo Plus, no se baja a Preferente como la lista automática.
-- · Cotizar devuelve el precio de cada lista (para elegir viendo el monto), la
--   existencia en las otras sucursales y los datos fiscales del cliente.
-- · Crédito fiscal exige cliente contribuyente con NIT y NRC.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.preventa_cotizar(p_branch bigint, p_customer bigint, p_lineas jsonb)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
                   (x->>'cantidad')::int AS cantidad, nullif(x->>'lista', '') AS lista_pedida, o AS ord
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
                 ORDER BY pp.vineta DESC LIMIT 1) q) pr ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('factor', z.factor, 'tipo', z.tipo) ORDER BY z.factor) AS lista_pres
          FROM (SELECT DISTINCT coalesce(pp.factor, 1)::int AS factor, coalesce(pre.tipo, 'Unidad') AS tipo
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
END $$;
REVOKE EXECUTE ON FUNCTION public.preventa_cotizar(bigint, bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preventa_cotizar(bigint, bigint, jsonb) TO authenticated, service_role;

-- La firma cambia (se agrega el pago): la vieja se borra para que una llamada
-- por nombre no quede ambigua.
DROP FUNCTION IF EXISTS public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text);

CREATE OR REPLACE FUNCTION public.preventa_directa_preparar(
  p_employee uuid, p_branch bigint, p_customer bigint, p_documento text, p_nota text,
  p_lineas jsonb, p_preventa bigint DEFAULT NULL, p_motivo_precio text DEFAULT NULL, p_pago text DEFAULT 'contado')
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  e public.employees; pv public.preventas; v_c json; v_erp int; v_id bigint; l json; v_err text;
  v_otro boolean; v_cli public.customers;
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
  END LOOP;

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
    'documento', p_documento, 'pago', p_pago, 'nota', left(btrim(coalesce(p_nota, '')), 60),
    'motivo_precio', CASE WHEN v_otro THEN coalesce(nullif(btrim(p_motivo_precio), ''), 'autorizado por quien vende') END,
    'cliente', CASE WHEN v_cli.id IS NOT NULL THEN json_build_object('erp_id', v_cli.erp_id, 'name', v_cli.name) END,
    'vendedor', json_build_object('code', e.code, 'role_id', e.role_id),
    'pagado', 0, 'falta_pagar', NULL,
    'renglones', (SELECT json_agg(json_build_object(
        'reserva_id', NULL, 'producto_id', x->'producto_id', 'nombre', x->>'nombre', 'cantidad', x->'cantidad',
        'factor', x->'factor', 'precio_unitario', x->'precio', 'precio_normal', x->'precio_regular',
        'lista_precio', x->>'lista', 'lista_autorizada', x->>'lista_pedida'))
      FROM json_array_elements(v_c->'lineas') x));
END $$;
REVOKE ALL ON FUNCTION public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text, text) TO service_role;
