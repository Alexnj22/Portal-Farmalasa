-- Quién hizo cada paso de un encargo (2026-11-04). La tarjeta no decía quién
-- lo encargó, quién confirmó el precio ni quién cobró, y los datos ya
-- existían: la bitácora (`audit_logs`: ENCARGO_EN_SUCURSAL / _NUEVO_ /
-- _CONFIRMAR / _PEDIDO / _LISTO), `respondido_por` y el movimiento de caja
-- del cobro (`caja_movimientos_portal.encargo_id`, sin el APLICA_ANTICIPO del
-- retiro). Se agrega `pasos` a `encargos_de_sucursal`; nada se escribe.
--
-- Un paso sin persona (`por_id` null) es uno que no hizo nadie del personal:
-- el encargo lo pidió el cliente desde la app, o lo pagó en línea, o nació
-- como resto de una reserva. Lo rotula la pantalla.
--
-- Partida de la definición VIVA (pg_get_functiondef del 2026-11-04); el único
-- cambio es la clave 'pasos'.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.encargos_de_sucursal(p_branch_id bigint, p_abiertos boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_v2 boolean := public.reservas_v2_rige();
  v_compras boolean := (SELECT public.auth_employee_branch_id()) IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
                       OR public.auth_can_edit_any(ARRAY['ofertas_clientes']);
BEGIN
  IF p_branch_id IS NOT NULL AND NOT (p_branch_id = public.auth_employee_branch_id()
       OR public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL AND NOT (public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', e.id, 'codigo', 'E-' || lpad(e.id::text, 6, '0'), 'estado', e.estado, 'pago_estado', e.pago_estado,
      'branch_id', e.branch_id, 'sala', b.name, 'cliente', c.name, 'telefono', c.phone,
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = e.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'product_id', e.product_id, 'producto', e.producto_nombre, 'cantidad', e.cantidad, 'nota_cliente', e.nota_cliente,
      'precio_unitario', e.precio_unitario, 'anticipo', e.anticipo, 'fecha_estimada', e.fecha_estimada, 'nota_sucursal', e.nota_sucursal,
      'devolutivo', p.devolutivo,
      'vendido_antes', e.product_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sales_invoice_items ii WHERE ii.erp_product_id = e.product_id LIMIT 1),
      'producto_nuevo', e.producto_nuevo, 'srs', e.srs, 'foto_url', e.foto_url,
      'producto_catalogo', p.nombre, 'vinculado_at', e.vinculado_at,
      'reserva_id', e.reserva_id, 'reserva', CASE WHEN e.reserva_id IS NOT NULL THEN 'R-' || lpad(e.reserva_id::text, 6, '0') END,
      'sugerido_product_id', e.sugerido_product_id, 'sugerido', ps.nombre,
      'listo_at', e.listo_at, 'prorrogado_at', e.prorrogado_at, 'prorroga', public.prorroga_de('encargo', e.id), 'aviso_sin_retirar_at', e.aviso_sin_retirar_at,
      'retirar_hasta', public.encargo_retirar_hasta(e),
      'creado', e.created_at)::jsonb
      || jsonb_build_object(
      'prorrogable', public.encargo_prorrogable(e),
      'nivel', pr.j, 'prioridad', coalesce((pr.j->>'prioridad')::boolean, false),
      'puede_cambiar_fecha', v_v2 AND v_compras AND e.estado IN ('confirmado', 'aceptado', 'pedido'),
      'puede_no_entrego', v_v2 AND e.estado IN ('aceptado', 'pedido') AND e.pago_estado = 'pagado' AND e.reserva_id IS NULL
                          AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id),
      'registrar_llamada', v_v2 AND e.estado IN ('confirmado', 'listo'),
      'avisos', CASE WHEN v_v2 THEN (SELECT jsonb_agg(jsonb_build_object('canal', l.canal, 'at', l.created_at, 'por_id', l.employee_id,
                                                        'por', em.name, 'por_nombres', em.first_names, 'por_apellidos', em.last_names, 'contesto', l.contesto, 'respuesta', l.respuesta) ORDER BY l.created_at DESC)
                                       FROM public.reserva_avisos_log l LEFT JOIN public.employees em ON em.id = l.employee_id
                                      WHERE l.encargo_id = e.id) END,
      'aviso_app', CASE WHEN v_v2 THEN (SELECT jsonb_build_object('at', a.created_at, 'leido_at', a.leido_at)
                                          FROM public.app_cliente_avisos a
                                         WHERE a.customer_id = e.customer_id AND a.tipo = 'encargo' AND a.ref = 'encargo:' || e.id || ':listo') END,
      'pasos', (SELECT jsonb_agg(jsonb_build_object('paso', x.paso, 'at', x.at, 'por_id', x.por, 'por', em.name,
                                                    'por_nombres', em.first_names, 'por_apellidos', em.last_names) ORDER BY x.orden)
                  FROM (
                    -- 1 · Se encargó: en la sala (bitácora) o, si no hay, el cliente desde la app / el resto de una reserva.
                    SELECT 1 AS orden, 'encargado' AS paso,
                           coalesce(cr.at, e.created_at) AS at, cr.por
                      FROM (SELECT NULL::int) uno
                      LEFT JOIN LATERAL (SELECT al.created_at AS at, al.user_id AS por FROM public.audit_logs al
                                          WHERE al.target_id = e.id::text AND al.action IN ('ENCARGO_EN_SUCURSAL', 'ENCARGO_NUEVO_EN_SUCURSAL')
                                          ORDER BY al.created_at LIMIT 1) cr ON true
                    UNION ALL
                    -- 2 · Compras confirmó precio y fecha.
                    SELECT 2, 'confirmado', e.respondido_at, e.respondido_por
                     WHERE e.respondido_at IS NOT NULL AND e.estado <> 'rechazado'
                    UNION ALL
                    -- 3 · Se cobró: el movimiento de caja (quién lo registró) o, sin él, el pago en línea.
                    SELECT 3, 'cobrado', coalesce(cj.at, e.pagado_at), cj.por
                      FROM (SELECT NULL::int) uno
                      LEFT JOIN LATERAL (SELECT m.registrado_at AS at, m.registrado_por AS por FROM public.caja_movimientos_portal m
                                          WHERE m.encargo_id = e.id AND m.anulado_at IS NULL
                                            AND m.tipo_codigo IS DISTINCT FROM 'APLICA_ANTICIPO'
                                          ORDER BY m.registrado_at LIMIT 1) cj ON true
                     WHERE e.pago_estado = 'pagado' AND e.reserva_id IS NULL
                    UNION ALL
                    -- 4 · Compras le hizo el pedido al proveedor.
                    SELECT 4, 'pedido', al.created_at, al.user_id
                      FROM (SELECT a2.created_at, a2.user_id FROM public.audit_logs a2
                             WHERE a2.target_id = e.id::text AND a2.action = 'ENCARGO_PEDIDO'
                             ORDER BY a2.created_at DESC LIMIT 1) al
                    UNION ALL
                    -- 5 · Llegó a la sala.
                    SELECT 5, 'llego', coalesce(ll.at, e.listo_at), ll.por
                      FROM (SELECT NULL::int) uno
                      LEFT JOIN LATERAL (SELECT al.created_at AS at, al.user_id AS por FROM public.audit_logs al
                                          WHERE al.target_id = e.id::text AND al.action = 'ENCARGO_LISTO'
                                          ORDER BY al.created_at DESC LIMIT 1) ll ON true
                     WHERE e.listo_at IS NOT NULL
                  ) x
                  LEFT JOIN public.employees em ON em.id = x.por))
      ORDER BY (e.estado = 'solicitado') DESC, (e.estado = 'aceptado') DESC,
               coalesce((pr.j->>'prioridad')::boolean, false) DESC, e.created_at DESC)
      FROM public.app_encargos e
      JOIN public.branches b ON b.id = e.branch_id
      JOIN public.customers c ON c.id = e.customer_id
      LEFT JOIN public.products p ON p.id = e.product_id
      LEFT JOIN public.products ps ON ps.id = e.sugerido_product_id AND e.product_id IS NULL
      LEFT JOIN LATERAL (SELECT CASE WHEN v_v2 AND e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                                     THEN public.reserva_prioridad(e.customer_id) END AS j) pr ON true
     WHERE (p_branch_id IS NULL OR e.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertos THEN e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                 ELSE e.created_at > now() - interval '30 days' END)), '[]'::json);
END $function$;
