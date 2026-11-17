-- Preventa a toda prueba (2026-11-16, auditoría pedida por el usuario).
-- Parte de las definiciones VIVAS: preventa_directa_preparar (md5 25dc5563…),
-- preventa_registrar (f8e87628…), preventa_anular (2f19d018…).
--
-- · Un cobro con monto (COMISIONES) va con cantidad 1: con 2 se cobraba el
--   monto dos veces.
-- · `p_total_esperado`: el total que vio quien vende. Si la base calcula otro
--   (un precio cambió entre la cotización y el envío), no se manda.
-- · Corregir y que falle ya no cambia el cliente ni quién la envió: la caja se
--   quedó con la venta vieja, y el portal vuelve a lo que tenía
--   (`correccion_previa`).
-- · Anular devuelve estado y número de caja, para encontrar en caja una
--   preventa que llegó sin enlace en vez de darla por borrada.
-- · Turno de un cobro con monto (`preventa_cobro_turno`): dos personas a la
--   vez escribían el mismo precio en los datos del producto y una se llevaba
--   el monto de la otra. Uno a la vez; el turno vence solo a los 3 minutos.
SET lock_timeout = '5s';

ALTER TABLE public.preventas ADD COLUMN IF NOT EXISTS correccion_previa jsonb;
ALTER TABLE public.preventa_cobros_con_monto ADD COLUMN IF NOT EXISTS ocupado_hasta timestamptz;

CREATE OR REPLACE FUNCTION public.preventa_cobro_turno(p_product integer, p_tomar boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_tomar THEN
    UPDATE public.preventa_cobros_con_monto SET ocupado_hasta = now() + interval '3 minutes'
     WHERE product_id = p_product AND (ocupado_hasta IS NULL OR ocupado_hasta < now());
    RETURN FOUND;
  END IF;
  UPDATE public.preventa_cobros_con_monto SET ocupado_hasta = NULL WHERE product_id = p_product;
  RETURN true;
END $function$;
REVOKE EXECUTE ON FUNCTION public.preventa_cobro_turno(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_cobro_turno(integer, boolean) TO service_role;

DROP FUNCTION IF EXISTS public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text, text, integer);
CREATE FUNCTION public.preventa_directa_preparar(p_employee uuid, p_branch bigint, p_customer bigint, p_documento text, p_nota text, p_lineas jsonb, p_preventa bigint DEFAULT NULL::bigint, p_motivo_precio text DEFAULT NULL::text, p_pago text DEFAULT 'contado'::text, p_puntos integer DEFAULT 0, p_total_esperado numeric DEFAULT NULL::numeric)
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
    -- 4 cargos admin, sólo con crédito fiscal (así se cobra) y una sola vez.
    IF coalesce((l->>'cobro_con_monto')::boolean, false) THEN
      IF e.role_id IS NULL OR e.role_id NOT IN (2, 3, 11, 13) THEN
        RAISE EXCEPTION '«%» sólo lo cobra administración.', l->>'nombre';
      END IF;
      IF p_documento <> 'credito_fiscal' THEN
        RAISE EXCEPTION '«%» va con crédito fiscal.', l->>'nombre';
      END IF;
      IF (l->>'cantidad')::int <> 1 THEN
        RAISE EXCEPTION '«%» va con cantidad 1: el monto ya es el total.', l->>'nombre';
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
  -- Lo que vio quien vende tiene que ser lo que se manda (2026-11-16).
  IF p_total_esperado IS NOT NULL AND abs(greatest(v_total - v_desc, 0) - p_total_esperado) > 0.005 THEN
    RAISE EXCEPTION 'El total cambió de $% a $% desde que lo viste. Revisa la venta y envía de nuevo.',
      to_char(p_total_esperado, 'FM999990.00'), to_char(greatest(v_total - v_desc, 0), 'FM999990.00');
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
    -- Si la corrección no llega a caja, `preventa_registrar` vuelve a esto.
    UPDATE public.preventas SET estado = 'enviando', customer_id = p_customer, enviada_por = p_employee,
           correccion_previa = jsonb_build_object('customer_id', pv.customer_id, 'enviada_por', pv.enviada_por),
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
        'lista_precio', x->>'lista', 'lista_autorizada', x->>'lista_pedida', 'id_presentacion', x->'id_presentacion',
        'cobro_con_monto', coalesce((x->>'cobro_con_monto')::boolean, false)))
      FROM json_array_elements(v_c->'lineas') x));
END $function$;
REVOKE EXECUTE ON FUNCTION public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text, text, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text, text, integer, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.preventa_registrar(p_id bigint, p_ok boolean, p_venta jsonb DEFAULT NULL::jsonb, p_externo_id text DEFAULT NULL::text, p_externo_ref text DEFAULT NULL::text, p_destino jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE pv public.preventas; v_actor uuid;
BEGIN
  -- Quien hizo ESTE intento firma el registro, aunque una corrección fallida
  -- devuelva la preventa a quien la tenía.
  SELECT enviada_por INTO v_actor FROM public.preventas WHERE id = p_id;
  UPDATE public.preventas
     SET estado = CASE WHEN NOT p_ok AND externo_id IS NOT NULL THEN 'viva'
                       WHEN NOT p_ok THEN 'fallida'
                       WHEN nullif(coalesce(p_externo_id, externo_id), '') IS NULL THEN 'sin_enlace' ELSE 'viva' END,
         venta = CASE WHEN p_ok OR externo_id IS NULL THEN coalesce(p_venta, venta) ELSE venta END,
         total = CASE WHEN p_ok OR externo_id IS NULL THEN coalesce((p_venta->>'total')::numeric, total) ELSE total END,
         vendedor_codigo = CASE WHEN p_ok OR externo_id IS NULL THEN coalesce(p_venta->>'vendedor', vendedor_codigo) ELSE vendedor_codigo END,
         -- Corrección que no llegó: la caja tiene la venta vieja, el portal también.
         customer_id = CASE WHEN NOT p_ok AND externo_id IS NOT NULL AND correccion_previa IS NOT NULL
                            THEN (correccion_previa->>'customer_id')::bigint ELSE customer_id END,
         enviada_por = CASE WHEN NOT p_ok AND externo_id IS NOT NULL AND correccion_previa IS NOT NULL
                            THEN coalesce((correccion_previa->>'enviada_por')::uuid, enviada_por) ELSE enviada_por END,
         correccion_previa = NULL,
         externo_id = coalesce(nullif(p_externo_id, ''), externo_id),
         externo_ref = coalesce(nullif(p_externo_ref, ''), externo_ref),
         destino = CASE WHEN p_ok OR externo_id IS NULL THEN p_destino ELSE destino END, error = p_error,
         enviada_at = CASE WHEN p_ok THEN now() ELSE enviada_at END, updated_at = now()
   WHERE id = p_id AND estado = 'enviando'
  RETURNING * INTO pv;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa preventa ya no se está enviando.'; END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (coalesce(v_actor, pv.enviada_por),
          CASE WHEN pv.origen = 'directa' THEN
                 CASE WHEN NOT p_ok THEN 'PREVENTA_FALLIDA' WHEN pv.corregida_veces > 0 THEN 'PREVENTA_CORREGIDA' ELSE 'PREVENTA_ENVIADA' END
               WHEN p_ok THEN 'RESERVA_PREVENTA_ENVIADA' ELSE 'RESERVA_PREVENTA_FALLIDA' END,
          CASE WHEN pv.origen = 'directa' THEN pv.id::text ELSE array_to_string(pv.reservas_ids, ',') END,
          jsonb_build_object('preventa', pv.id, 'externo_id', pv.externo_id, 'referencia', pv.externo_ref,
                             'total', pv.total, 'error', p_error), pv.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('id', pv.id, 'estado', pv.estado, 'externo_id', pv.externo_id, 'referencia', pv.externo_ref);
END;
$function$;

CREATE OR REPLACE FUNCTION public.preventa_anular(p_employee uuid, p_id bigint, p_paso text DEFAULT 'revisar'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE pv public.preventas;
BEGIN
  SELECT * INTO pv FROM public.preventas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa preventa no existe.'; END IF;
  IF NOT public.preventa_puede(p_employee, pv.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF pv.origen <> 'directa' THEN RAISE EXCEPTION 'Esa preventa es de una reserva: se maneja desde Reservas.'; END IF;
  IF pv.estado NOT IN ('viva', 'fallida', 'sin_enlace') THEN RAISE EXCEPTION 'Esa preventa ya está %.', pv.estado; END IF;
  IF pv.externo_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.sales_invoices si WHERE si.erp_invoice_id = pv.externo_id AND si.branch_id = pv.branch_id) THEN
    RAISE EXCEPTION 'Esa preventa ya se facturó: no se puede anular.';
  END IF;
  IF p_paso = 'revisar' THEN
    RETURN json_build_object('id', pv.id, 'externo_id', pv.externo_id, 'branch_id', pv.branch_id,
      'estado', pv.estado, 'referencia', pv.externo_ref,
      'erp_sucursal', (SELECT erp_sucursal_id FROM public.erp_sucursal_map WHERE branch_id = pv.branch_id AND NOT es_bodega),
      'vendedor', pv.vendedor_codigo,
      'productos', (SELECT json_agg((r->>'producto_id')::int) FROM jsonb_array_elements(coalesce(pv.venta->'renglones', '[]')) r));
  END IF;
  UPDATE public.preventas SET estado = 'descartada', anulada_por = p_employee, anulada_at = now(), updated_at = now()
   WHERE id = pv.id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (p_employee, 'PREVENTA_ANULADA', pv.id::text,
          jsonb_build_object('preventa', pv.id, 'externo_id', pv.externo_id, 'referencia', pv.externo_ref, 'total', pv.total),
          pv.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('id', pv.id, 'estado', 'descartada');
END $function$;
