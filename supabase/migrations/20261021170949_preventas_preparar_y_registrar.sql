-- Preventas de reservas (2026-10-21), 2 de 5: armar y registrar el envío.
-- Las llama la edge function `preventa-caja` con la llave del servidor.
SET lock_timeout = '5s';

-- Valida permiso y sala OTRA VEZ acá (la edge function ya lo hizo): editar
-- reservas, y la sala propia salvo alcance de toda la red. Bloquea las
-- reservas, impide una segunda preventa viva y deja la nueva «enviando».
CREATE OR REPLACE FUNCTION public.preventa_preparar(p_employee uuid, p_reservas bigint[])
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  e public.employees;
  v_branch bigint; v_branch2 bigint; v_customer bigint; v_customer2 bigint; v_n int; v_id bigint; v_erp int;
  v_todas boolean; v_puede boolean; v_ref text;
  r record;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee AND status = 'ACTIVO';
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_reservas IS NULL OR cardinality(p_reservas) = 0 THEN RAISE EXCEPTION 'No se dijo qué reserva.'; END IF;

  PERFORM 1 FROM public.app_reservas WHERE id = ANY (p_reservas) ORDER BY id FOR UPDATE;
  SELECT count(*), min(branch_id), max(branch_id), min(customer_id), max(customer_id)
    INTO v_n, v_branch, v_branch2, v_customer, v_customer2
    FROM public.app_reservas WHERE id = ANY (p_reservas);
  IF v_n <> cardinality(p_reservas) THEN RAISE EXCEPTION 'Una de esas reservas no existe.'; END IF;
  IF v_branch <> v_branch2 THEN RAISE EXCEPTION 'Esas reservas son de salas distintas.'; END IF;
  IF v_customer <> v_customer2 THEN RAISE EXCEPTION 'Esas reservas son de clientes distintos.'; END IF;

  SELECT bool_or(rp.can_edit), bool_or(rp.can_edit AND rp.scope = 'ALL')
    INTO v_puede, v_todas
    FROM public.role_permissions rp
   WHERE rp.role_id IN (e.role_id, e.secondary_role_id) AND rp.module_key = 'reservas';
  IF NOT coalesce(v_puede, false) OR NOT (coalesce(v_todas, false) OR e.branch_id = v_branch) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  FOR r IN SELECT a.*, pv.estado AS pv_estado, pv.externo_ref AS pv_ref, pv.created_at AS pv_at
             FROM public.app_reservas a LEFT JOIN public.preventas pv ON pv.id = a.preventa_id
            WHERE a.id = ANY (p_reservas) LOOP
    IF r.estado NOT IN ('pendiente', 'lista') THEN
      RAISE EXCEPTION 'La reserva R-% ya no está abierta.', lpad(r.id::text, 6, '0');
    END IF;
    IF r.origen = 'app' AND r.bajo_receta AND r.receta_estado IS DISTINCT FROM 'aprobada' THEN
      RAISE EXCEPTION 'La receta de la reserva R-% todavía no está aprobada.', lpad(r.id::text, 6, '0');
    END IF;
    IF r.producto_id IS NULL OR r.producto_id <= 0 THEN
      RAISE EXCEPTION '«%» no es un producto del catálogo: no se puede mandar a la caja.', r.producto_nombre;
    END IF;
    IF r.pv_estado IN ('viva', 'sin_enlace', 'facturada')
       OR (r.pv_estado = 'enviando' AND r.pv_at > now() - interval '5 minutes') THEN
      RAISE EXCEPTION 'La reserva R-% ya tiene una preventa en la caja%.', lpad(r.id::text, 6, '0'),
        coalesce(' (#' || r.pv_ref || ')', '');
    END IF;
  END LOOP;

  SELECT erp_sucursal_id INTO v_erp FROM public.erp_sucursal_map WHERE branch_id = v_branch AND NOT es_bodega;
  IF v_erp IS NULL THEN RAISE EXCEPTION 'Esa sala no factura en la caja.'; END IF;

  INSERT INTO public.preventas (branch_id, customer_id, reservas_ids, enviada_por)
  VALUES (v_branch, v_customer, (SELECT array_agg(x ORDER BY x) FROM unnest(p_reservas) x), p_employee)
  RETURNING id INTO v_id;
  UPDATE public.app_reservas SET preventa_id = v_id, updated_at = now() WHERE id = ANY (p_reservas);

  SELECT coalesce(min(pedido), 'R-' || lpad(min(id)::text, 6, '0')) INTO v_ref
    FROM public.app_reservas WHERE id = ANY (p_reservas);

  RETURN json_build_object(
    'preventa_id', v_id, 'erp_sucursal', v_erp, 'branch_id', v_branch, 'codigo', v_ref,
    'documento', (SELECT min(documento) FROM public.app_reservas WHERE id = ANY (p_reservas)),
    'cliente', (SELECT json_build_object('erp_id', c.erp_id, 'name', c.name) FROM public.customers c WHERE c.id = v_customer),
    'vendedor', json_build_object('code', e.code, 'role_id', e.role_id),
    'pagado', (SELECT coalesce(sum(k.pagado), 0) FROM unnest(p_reservas) x, public.reserva_cuenta(x) k),
    'falta_pagar', (SELECT coalesce(sum(k.falta_pagar), 0) FROM unnest(p_reservas) x, public.reserva_cuenta(x) k),
    'renglones', (SELECT json_agg(json_build_object(
        'reserva_id', a.id, 'producto_id', a.producto_id, 'nombre', a.producto_nombre, 'cantidad', a.cantidad,
        'factor', a.factor, 'precio_unitario', a.precio_unitario, 'precio_normal', a.precio_normal,
        'lista_precio', a.lista_precio) ORDER BY a.id)
      FROM public.app_reservas a WHERE a.id = ANY (p_reservas)));
END;
$$;
REVOKE ALL ON FUNCTION public.preventa_preparar(uuid, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_preparar(uuid, bigint[]) TO service_role;

-- Lo que contestó el destino. Sin número leído queda `sin_enlace`: no se cierra sola.
CREATE OR REPLACE FUNCTION public.preventa_registrar(
  p_id bigint, p_ok boolean, p_venta jsonb DEFAULT NULL, p_externo_id text DEFAULT NULL,
  p_externo_ref text DEFAULT NULL, p_destino jsonb DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE pv public.preventas;
BEGIN
  UPDATE public.preventas
     SET estado = CASE WHEN NOT p_ok THEN 'fallida' WHEN nullif(p_externo_id, '') IS NULL THEN 'sin_enlace' ELSE 'viva' END,
         venta = coalesce(p_venta, venta), total = coalesce((p_venta->>'total')::numeric, total),
         vendedor_codigo = coalesce(p_venta->>'vendedor', vendedor_codigo),
         externo_id = nullif(p_externo_id, ''), externo_ref = nullif(p_externo_ref, ''),
         destino = p_destino, error = p_error,
         enviada_at = CASE WHEN p_ok THEN now() ELSE enviada_at END, updated_at = now()
   WHERE id = p_id AND estado = 'enviando'
  RETURNING * INTO pv;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa preventa ya no se está enviando.'; END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (pv.enviada_por, CASE WHEN p_ok THEN 'RESERVA_PREVENTA_ENVIADA' ELSE 'RESERVA_PREVENTA_FALLIDA' END,
          array_to_string(pv.reservas_ids, ','),
          jsonb_build_object('preventa', pv.id, 'externo_id', pv.externo_id, 'referencia', pv.externo_ref,
                             'total', pv.total, 'error', p_error), pv.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('id', pv.id, 'estado', pv.estado, 'externo_id', pv.externo_id, 'referencia', pv.externo_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.preventa_registrar(bigint, boolean, jsonb, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_registrar(bigint, boolean, jsonb, text, text, jsonb, text) TO service_role;
