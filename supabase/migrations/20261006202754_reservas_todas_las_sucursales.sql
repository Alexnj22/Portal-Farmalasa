-- Reservas: con `p_branch_id` NULL, todas las sucursales (sólo quien edita
-- Ofertas para clientes) — para la pestaña Reservas del portal. Cada fila
-- trae el nombre de su sucursal.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reservas_de_sucursal(p_branch_id bigint, p_abiertas boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $$
BEGIN
  IF p_branch_id IS NULL THEN
    IF NOT public.auth_can_edit_any(ARRAY['ofertas_clientes']) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.reserva_puede_manejar(p_branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', r.id, 'estado', r.estado, 'origen', r.origen,
      'branch_id', r.branch_id, 'sala', b.name,
      'cliente', c.name, 'telefono', c.phone,
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = r.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'producto_id', r.producto_id, 'producto', r.producto_nombre, 'cantidad', r.cantidad,
      'precio', r.precio_unitario, 'precio_normal', r.precio_normal,
      'oferta', r.oferta_titulo, 'oferta_fin', r.oferta_fin,
      'creada', r.created_at, 'lista_at', r.lista_at, 'vence_at', r.vence_at,
      'avisado_via', r.avisado_via, 'avisado_at', r.avisado_at, 'cerrada_at', r.cerrada_at)
      ORDER BY (r.estado = 'pendiente') DESC, (r.estado = 'lista') DESC, r.created_at DESC)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
      JOIN public.branches b ON b.id = r.branch_id
     WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertas THEN r.estado IN ('pendiente', 'lista')
                 ELSE r.created_at > now() - interval '30 days' END)), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reservas_de_sucursal(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservas_de_sucursal(bigint, boolean) TO authenticated, service_role;
