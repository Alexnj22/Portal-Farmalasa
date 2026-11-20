SET lock_timeout = '5s';

-- Reserva vendida en caja por fuera (2026-11-20).
--
-- La R-000164 de Salud 1 se vendió en caja como venta suelta el 13 nov,
-- 30 minutos después de quedar lista: no pasó por «Enviar a caja», así que
-- `preventas_cerrar_facturadas` nunca la vio y siguió «Lista para retirar»
-- (con «Falta 1 en la sucursal», porque la caja ya no estaba). Lo mismo la
-- R-000154 de Salud 5 (vendida el 6 nov).
--
-- `vendida_aparte`: para una reserva pendiente o lista, la PRIMERA venta
-- válida de la misma sucursal, al mismo cliente, con el mismo producto,
-- hecha después de crear la reserva, que no sea la factura de ninguna
-- preventa. Sólo avisa: cerrarla depende de si el cliente pagó dos veces,
-- y eso lo decide la sucursal.
--
-- Partida de la definición VIVA (pg_get_functiondef, 2026-11-20). Único
-- cambio: el LATERAL `va` y la clave `vendida_aparte`.
--
-- jsonb-agg: el `jsonb_agg` de `avisos` ya estaba en la viva; agrega los avisos de UNA reserva (un puñado de filas).
CREATE OR REPLACE FUNCTION public.reservas_de_sucursal(p_branch_id bigint, p_abiertas boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_v2 boolean := public.reservas_v2_rige();
  v_ids integer[];
  v_netas json := '[]'::json;
BEGIN
  IF p_branch_id IS NULL THEN
    IF NOT public.auth_can_edit_any(ARRAY['ofertas_clientes']) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.reserva_puede_manejar(p_branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- La existencia de la sala sólo hace falta para lo que está LISTA.
  SELECT array_agg(DISTINCT r.producto_id::int) INTO v_ids
    FROM public.app_reservas r
   WHERE r.estado = 'lista' AND r.producto_id IS NOT NULL
     AND (p_branch_id IS NULL OR r.branch_id = p_branch_id);
  IF v_ids IS NOT NULL THEN
    v_netas := public.app_existencias_netas(v_ids);
  END IF;

  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', r.id, 'estado', r.estado, 'origen', r.origen, 'pedido', r.pedido,
      'documento', r.documento, 'datos_fiscales', r.datos_fiscales,
      'branch_id', r.branch_id, 'sala', b.name,
      'cliente', c.name, 'telefono', c.phone,
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = r.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'producto_id', r.producto_id, 'producto', r.producto_nombre, 'cantidad', r.cantidad,
      'precio', r.precio_unitario, 'precio_normal', r.precio_normal,
      'lista_precio', r.lista_precio,
      'oferta', r.oferta_titulo, 'oferta_fin', r.oferta_fin,
      'creada', r.created_at, 'lista_at', r.lista_at, 'vence_at', r.vence_at,
      'avisado_via', r.avisado_via, 'avisado_at', r.avisado_at, 'cerrada_at', r.cerrada_at,
      'pago_estado', r.pago_estado, 'pago_metodo', r.pago_metodo, 'pago_prueba', r.pago_prueba, 'entrega', r.entrega,
      'direccion_entrega', r.direccion_entrega, 'costo_envio', r.costo_envio, 'anticipo', r.anticipo,
      'saldo_favor', r.saldo_favor, 'saldo_favor_vence', r.saldo_favor_vence, 'saldo_favor_origen', r.saldo_favor_origen,
      'saldo_favor_usado_at', r.saldo_favor_usado_at, 'saldo_favor_devuelto_at', r.saldo_favor_devuelto_at,
      'vencida_motivo', r.vencida_motivo, 'pendiente_at', r.pendiente_at,
      'bajo_receta', r.bajo_receta, 'puede_revisar_receta', public.receta_app_puede_aprobar(r.branch_id),
      'receta_ruta', r.receta_ruta, 'receta_estado', r.receta_estado, 'receta_motivo', r.receta_motivo,
      'receta_subida_at', r.receta_subida_at, 'receta_fotos', r.receta_fotos,
      'receta_revisada_at', r.receta_revisada_at)::jsonb
      || jsonb_build_object(
      'preventa_id', pv.id, 'preventa_estado', pv.estado, 'preventa_ref', pv.externo_ref,
      'preventa_at', pv.enviada_at, 'preventa_por', pv.enviada_por, 'factura', si.correlativo, 'cobro_distinto', pv.cobro_distinto,
      'plazo_hasta', public.reserva_plazo_hasta(r),
      'horas_al_preparar', CASE WHEN r.estado = 'pendiente' THEN public.reserva_horas_al_preparar(r) END)
      || jsonb_build_object(
      'factor', r.factor, 'traslado_desde', r.traslado_desde, 'traslado_sala', bt.name,
      'traslado_estado', r.traslado_estado, 'traslado_nota', r.traslado_nota,
      'traslado_llegaron', r.traslado_llegaron, 'traslado_por_llegar', r.traslado_por_llegar,
      'ajuste_de', r.ajuste_de, 'prorrogada_at', r.prorrogada_at, 'prorroga', public.prorroga_de('reserva', r.id), 'saldo_favor_devuelto_monto', r.saldo_favor_devuelto_monto,
      'devolucion_pedida_at', r.devolucion_pedida_at, 'devolucion_pedida_motivo', r.devolucion_pedida_motivo,
      'devolucion_entregada_at', r.devolucion_entregada_at,
      'encargo', (SELECT jsonb_build_object('id', e.id, 'codigo', 'E-' || lpad(e.id::text, 6, '0'), 'estado', e.estado,
                                            'precio', e.precio_unitario, 'fecha', e.fecha_estimada, 'cantidad', e.cantidad)
                    FROM public.app_encargos e WHERE e.reserva_id = r.id ORDER BY e.id DESC LIMIT 1))
      || jsonb_build_object(
      'prorrogable', public.reserva_prorrogable(r),
      'nivel', pr.j, 'prioridad', coalesce((pr.j->>'prioridad')::boolean, false),
      'registrar_llamada', v_v2 AND r.estado IN ('pendiente', 'lista'),
      'avisos', CASE WHEN v_v2 THEN (SELECT jsonb_agg(jsonb_build_object('canal', l.canal, 'at', l.created_at, 'por_id', l.employee_id,
                                                        'por', em.name, 'por_nombres', em.first_names, 'por_apellidos', em.last_names, 'contesto', l.contesto, 'respuesta', l.respuesta) ORDER BY l.created_at DESC)
                                       FROM public.reserva_avisos_log l LEFT JOIN public.employees em ON em.id = l.employee_id
                                      WHERE l.reserva_id = r.id) END,
      'aviso_app', CASE WHEN v_v2 THEN (SELECT jsonb_build_object('at', a.created_at, 'leido_at', a.leido_at)
                                          FROM public.app_cliente_avisos a
                                         WHERE a.customer_id = r.customer_id AND a.tipo = 'reserva' AND a.ref = 'reserva-lista:' || r.id) END)
      || jsonb_build_object(
      'faltan_en_sala', cob.faltan, 'hay_en_sala', cob.hay,
      'vendida_aparte', va.j,
      'responsable', CASE WHEN r.responsable_id IS NOT NULL THEN jsonb_build_object('id', er.id, 'name', er.name,
        'first_names', er.first_names, 'last_names', er.last_names, 'at', r.responsable_at) END)
      ORDER BY (r.estado = 'en_revision') DESC, (r.estado = 'pendiente') DESC,
               (r.estado = 'lista' AND coalesce(cob.faltan, 0) > 0) DESC, (r.estado = 'lista') DESC,
               coalesce((pr.j->>'prioridad')::boolean, false) DESC, r.created_at DESC)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
      JOIN public.branches b ON b.id = r.branch_id
      LEFT JOIN public.branches bt ON bt.id = r.traslado_desde
      LEFT JOIN public.employees er ON er.id = r.responsable_id
      LEFT JOIN public.preventas pv ON pv.id = r.preventa_id
      LEFT JOIN public.sales_invoices si ON si.id = pv.sales_invoice_id
      LEFT JOIN LATERAL (SELECT CASE WHEN v_v2 AND r.estado IN ('en_revision', 'pendiente', 'lista')
                                     THEN public.reserva_prioridad(r.customer_id) END AS j) pr ON true
      -- Lo que la sala tiene para ESTA reserva lista: su existencia menos lo
      -- que ya cubren las listas anteriores del mismo producto. En unidades
      -- para restar, en la presentación de la reserva para decirlo.
      LEFT JOIN LATERAL (
        SELECT ceil(greatest(0, u.pide - greatest(0, u.existencia - u.antes)) / u.f)::int AS faltan,
               floor(greatest(0, u.existencia - u.antes) / u.f)::int AS hay
          FROM (SELECT r.cantidad * greatest(coalesce(r.factor, 1), 1) AS pide,
                       greatest(coalesce(r.factor, 1), 1)::numeric AS f,
                       coalesce((SELECT e.existencia FROM json_to_recordset(v_netas)
                                         AS e(product_id int, branch_id bigint, existencia numeric)
                                  WHERE e.product_id = r.producto_id AND e.branch_id = r.branch_id), 0) AS existencia,
                       (SELECT coalesce(sum(r2.cantidad * greatest(coalesce(r2.factor, 1), 1)), 0)
                          FROM public.app_reservas r2
                         WHERE r2.estado = 'lista' AND r2.producto_id = r.producto_id AND r2.branch_id = r.branch_id
                           AND (coalesce(r2.lista_at, r2.created_at), r2.id) < (coalesce(r.lista_at, r.created_at), r.id)) AS antes) u
         WHERE r.estado = 'lista' AND r.producto_id IS NOT NULL) cob ON true
      -- ¿Ya se vendió en caja por fuera? Mismo cliente, misma sucursal, mismo
      -- producto, después de crear la reserva y sin preventa de por medio.
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object('invoice_id', sv.id, 'factura', sv.correlativo,
                 'at', (sv.fecha + sv.hora) AT TIME ZONE 'America/El_Salvador', 'total', sv.total) AS j
          FROM public.sales_invoices sv
         WHERE r.estado IN ('pendiente', 'lista') AND r.producto_id IS NOT NULL
           AND sv.customer_id = r.customer_id AND sv.branch_id = r.branch_id
           AND public.venta_valida(sv.estado)
           AND (sv.fecha + sv.hora) >= (r.created_at AT TIME ZONE 'America/El_Salvador')
           AND NOT EXISTS (SELECT 1 FROM public.preventas p2 WHERE p2.sales_invoice_id = sv.id)
           AND EXISTS (SELECT 1 FROM public.sales_invoice_items it
                        WHERE it.invoice_id = sv.id AND it.erp_product_id = r.producto_id)
         ORDER BY sv.fecha, sv.hora
         LIMIT 1) va ON true
     WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertas THEN r.estado IN ('en_revision', 'pendiente', 'lista')
                   OR (coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL
                       AND r.saldo_favor_devuelto_at IS NULL AND r.saldo_favor_vence >= v_hoy)
                   OR (r.devolucion_pedida_at IS NOT NULL AND r.saldo_favor_devuelto_at IS NOT NULL AND r.devolucion_movimiento IS NULL)
                 ELSE r.created_at > now() - interval '30 days' END)), '[]'::json);
END;
$function$;
