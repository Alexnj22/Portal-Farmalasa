-- Corrige la 20261021171816: con los seis campos de la preventa el
-- `json_build_object` pasaba de 100 argumentos (el tope de Postgres) y la
-- función LANZABA en cada llamada — la lista de Reservas no cargaba. Lo de la
-- preventa va en un segundo objeto que se une al primero.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reservas_de_sucursal(p_branch_id bigint, p_abiertas boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF p_branch_id IS NULL THEN
    IF NOT public.auth_can_edit_any(ARRAY['ofertas_clientes']) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT (p_branch_id = public.auth_employee_branch_id() OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
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
      -- Mayoreo (2026-10-19): la lista con que se cobró al reservar, para facturar igual.
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
      -- La preventa (2026-10-21): en qué quedó, su número en la caja y la factura.
      || jsonb_build_object(
      'preventa_id', pv.id, 'preventa_estado', pv.estado, 'preventa_ref', pv.externo_ref,
      'preventa_at', pv.enviada_at, 'preventa_por', pv.enviada_por, 'factura', si.correlativo)
      ORDER BY (r.estado = 'en_revision') DESC, (r.estado = 'pendiente') DESC, (r.estado = 'lista') DESC, r.created_at DESC)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
      JOIN public.branches b ON b.id = r.branch_id
      LEFT JOIN public.preventas pv ON pv.id = r.preventa_id
      LEFT JOIN public.sales_invoices si ON si.id = pv.sales_invoice_id
     WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertas THEN r.estado IN ('en_revision', 'pendiente', 'lista')
                   OR (coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL
                       AND r.saldo_favor_devuelto_at IS NULL AND r.saldo_favor_vence >= v_hoy)
                 ELSE r.created_at > now() - interval '30 days' END)), '[]'::json);
END;
$function$;
