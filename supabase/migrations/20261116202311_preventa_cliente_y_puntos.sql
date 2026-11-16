-- Preventa, tercera vuelta (2026-11-16, usuario): ver los datos del cliente
-- —qué tipo es, su nivel, sus puntos— y descontar puntos en la venta.
--
-- El descuento viaja a caja como lo hace la caja misma: un renglón «-999»
-- (DESCUENTO POR PUNTOS SALUD) a $0.01 por punto. El saldo baja cuando llega
-- la factura (`puntos_barrer_canjes`), igual que un canje hecho en caja.
SET lock_timeout = '5s';

-- Los puntos de un cliente para canjear en una preventa. `p_excluir` es la
-- preventa que se está corrigiendo: lo que ella apartó vuelve a estar libre.
CREATE OR REPLACE FUNCTION public.preventa_puntos_del_cliente(p_customer bigint, p_excluir bigint DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE c public.customers; v_saldo int; v_comp int; v_min int; v_puede boolean;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer;
  IF NOT FOUND THEN
    RETURN json_build_object('puede_canjear', false, 'saldo', 0, 'comprometidos', 0, 'disponibles', 0,
                             'minimo_canje', 100, 'tope', 10000, 'valor', 0.01);
  END IF;
  v_saldo := coalesce((public.puntos_estado_cuenta(c.id)->>'saldo')::numeric, 0)::int;
  SELECT coalesce(sum((pv.venta->>'puntos')::int), 0) INTO v_comp
    FROM public.preventas pv
   WHERE pv.customer_id = c.id AND pv.origen = 'directa' AND pv.estado IN ('enviando', 'viva', 'sin_enlace')
     AND pv.id IS DISTINCT FROM p_excluir AND coalesce((pv.venta->>'puntos')::int, 0) > 0;
  SELECT coalesce(minimo_canje, 100) INTO v_min FROM public.puntos_config LIMIT 1;
  v_puede := NOT public.cliente_es_generico(c.id) AND coalesce(c.acumula_puntos, true)
             AND c.acepta_programa_puntos IS DISTINCT FROM false AND c.tipo_persona IS DISTINCT FROM 'juridica';
  RETURN json_build_object('puede_canjear', v_puede, 'saldo', v_saldo, 'comprometidos', v_comp,
                           'disponibles', greatest(v_saldo - v_comp, 0), 'minimo_canje', coalesce(v_min, 100),
                           'tope', 10000, 'valor', 0.01);
END $$;
REVOKE ALL ON FUNCTION public.preventa_puntos_del_cliente(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_puntos_del_cliente(bigint, bigint) TO service_role;

-- La ficha del cliente para la pantalla de Preventa: datos, tipo, nivel,
-- puntos y su última compra. Una sola llamada al elegirlo.
CREATE OR REPLACE FUNCTION public.preventa_cliente(p_branch bigint, p_customer bigint)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  c public.customers; v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_prog text; v_compra numeric; v_nivel record; v_ult record;
BEGIN
  IF NOT public.preventa_puede(public.auth_employee_id(), p_branch, 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.customers WHERE id = p_customer;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_prog := CASE
    WHEN public.es_cliente_mostrador(c.name, c.erp_id) THEN 'mostrador'
    WHEN c.tipo_persona IS NOT DISTINCT FROM 'juridica' THEN 'empresa'
    WHEN NOT coalesce(c.acumula_puntos, true) OR c.acepta_programa_puntos IS NOT DISTINCT FROM false THEN 'fuera'
    WHEN EXISTS (SELECT 1 FROM public.clientes_mayoristas cm WHERE cm.customer_id = c.id AND cm.estado = 'aprobado') THEN 'mayorista'
    ELSE 'socio' END;
  IF v_prog IN ('socio', 'mayorista') THEN
    v_compra := public.puntos_compra_12m(c.id, v_hoy, NULL);
    SELECT * INTO v_nivel FROM public.puntos_nivel_de(v_compra, v_hoy);
  END IF;
  SELECT si.fecha, si.total, b.name AS sucursal INTO v_ult
    FROM public.sales_invoices si LEFT JOIN public.branches b ON b.id = si.branch_id
   WHERE si.customer_id = c.id AND public.venta_valida(si.estado)
   ORDER BY si.fecha DESC, si.id DESC LIMIT 1;
  RETURN json_build_object(
    'id', c.id, 'name', c.name, 'categoria', c.categoria, 'tipo_persona', c.tipo_persona,
    'nit', c.nit, 'dui', c.dui, 'nrc', c.nrc, 'giro', c.giro, 'phone', c.phone, 'email', c.email,
    'direccion', c.direccion, 'erp_id', c.erp_id,
    'lista', public.lista_de_precio_del_cliente(c.id), 'generico', public.cliente_es_generico(c.id),
    'empleado', public.cliente_es_empleado(c.id), 'mayorista', public.mayorista_de(c.id),
    'programa', v_prog,
    'rango', CASE WHEN v_prog = 'mayorista' THEN public.mayorista_rango(c.id) END,
    'nivel', v_nivel.nombre, 'compra_12m', round(v_compra, 2),
    'puntos', public.preventa_puntos_del_cliente(c.id),
    'minimo_a_pagar', public.puntos_minimo_a_pagar(v_hoy),
    'ultima_compra', CASE WHEN v_ult.fecha IS NOT NULL THEN
       json_build_object('fecha', v_ult.fecha, 'total', v_ult.total, 'sucursal', v_ult.sucursal) END);
END $$;
REVOKE EXECUTE ON FUNCTION public.preventa_cliente(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preventa_cliente(bigint, bigint) TO authenticated, service_role;

-- La firma cambia (se agregan los puntos): la vieja se borra para que una
-- llamada por nombre no quede ambigua.
DROP FUNCTION IF EXISTS public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text, text);

CREATE OR REPLACE FUNCTION public.preventa_directa_preparar(
  p_employee uuid, p_branch bigint, p_customer bigint, p_documento text, p_nota text,
  p_lineas jsonb, p_preventa bigint DEFAULT NULL, p_motivo_precio text DEFAULT NULL, p_pago text DEFAULT 'contado', p_puntos integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
        'lista_precio', x->>'lista', 'lista_autorizada', x->>'lista_pedida'))
      FROM json_array_elements(v_c->'lineas') x));
END $$;
REVOKE ALL ON FUNCTION public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text, text, integer) TO service_role;
