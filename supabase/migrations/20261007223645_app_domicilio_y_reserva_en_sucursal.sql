SET lock_timeout = '5s';
-- Entrega a domicilio y reserva en sucursal con anticipo (2026-10-07).

-- 1. Ajustes de la app: una fila. El envío se configura desde el portal.
CREATE TABLE IF NOT EXISTS public.app_ajustes (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  envio_activo boolean NOT NULL DEFAULT true,
  envio_costo numeric(8,2) NOT NULL DEFAULT 1.50 CHECK (envio_costo >= 0),
  envio_gratis_desde numeric(8,2) CHECK (envio_gratis_desde IS NULL OR envio_gratis_desde > 0),
  envio_nota text NOT NULL DEFAULT 'Entregamos el mismo día en la ciudad de la sucursal que elijas.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.app_ajustes (id, envio_gratis_desde) VALUES (true, 25.00) ON CONFLICT DO NOTHING;
ALTER TABLE public.app_ajustes ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_ajustes_ver ON public.app_ajustes FOR SELECT TO authenticated USING (true);
CREATE POLICY app_ajustes_editar ON public.app_ajustes FOR UPDATE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])))
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));

-- 2. El costo del envío va en cada renglón del pedido (el mismo valor); el
--    total del pedido es la suma de productos + el envío UNA vez.
ALTER TABLE public.app_reservas ADD COLUMN IF NOT EXISTS costo_envio numeric(8,2) NOT NULL DEFAULT 0 CHECK (costo_envio >= 0);
ALTER TABLE public.app_reservas DROP CONSTRAINT IF EXISTS app_reservas_cantidad_check,
  ADD CONSTRAINT app_reservas_cantidad_check CHECK (cantidad >= 1 AND cantidad <= CASE WHEN origen = 'sucursal' THEN 50 ELSE 5 END);

-- 3. Reserva hecha en la sucursal: anticipo de al menos el 50 % y 7 días para
--    retirarla. La crea un dependiente de ESA sala (o quien administra ofertas).
CREATE OR REPLACE FUNCTION public.reserva_en_sucursal_crear(
  p_branch_id bigint, p_customer_id bigint, p_producto_id bigint, p_producto_nombre text,
  p_cantidad integer, p_precio numeric, p_anticipo numeric, p_metodo text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_total numeric; v_id bigint; v_emp uuid := public.auth_employee_id();
BEGIN
  IF NOT (p_branch_id = public.auth_employee_branch_id() OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN RAISE EXCEPTION 'Elige el cliente'; END IF;
  IF coalesce(btrim(p_producto_nombre), '') = '' THEN RAISE EXCEPTION 'Elige el producto'; END IF;
  IF p_cantidad IS NULL OR p_cantidad < 1 OR p_cantidad > 50 THEN RAISE EXCEPTION 'La cantidad va de 1 a 50'; END IF;
  IF p_precio IS NULL OR p_precio <= 0 THEN RAISE EXCEPTION 'Falta el precio'; END IF;
  IF p_metodo NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN RAISE EXCEPTION 'Elige cómo pagó el anticipo'; END IF;
  v_total := round(p_precio * p_cantidad, 2);
  IF p_anticipo IS NULL OR p_anticipo < round(v_total * 0.5, 2) THEN
    RAISE EXCEPTION 'El anticipo mínimo es el 50 %% (%)', to_char(round(v_total * 0.5, 2), 'FM$999,990.00');
  END IF;
  IF p_anticipo > v_total THEN RAISE EXCEPTION 'El anticipo no puede pasar del total'; END IF;
  INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad,
      precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, vence_at, preparada_por,
      pago_estado, pago_metodo, pagado_at)
  VALUES (p_customer_id, p_branch_id, 'sucursal', p_producto_id, left(btrim(p_producto_nombre), 200), p_cantidad,
      p_precio, p_precio, 'lista', 'sucursal-v1', round(p_anticipo, 2), now(), now() + interval '7 days', v_emp,
      CASE WHEN round(p_anticipo, 2) >= v_total THEN 'pagado' ELSE 'anticipo' END, p_metodo, now())
  RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id, 'total', v_total, 'anticipo', round(p_anticipo, 2),
    'saldo', v_total - round(p_anticipo, 2), 'vence_at', now() + interval '7 days');
END $$;
REVOKE EXECUTE ON FUNCTION public.reserva_en_sucursal_crear(bigint, bigint, bigint, text, integer, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_en_sucursal_crear(bigint, bigint, bigint, text, integer, numeric, numeric, text) TO authenticated, service_role;

-- 4. El tablero de la sala ve el envío y el anticipo.
CREATE OR REPLACE FUNCTION public.reservas_de_sucursal(p_branch_id bigint, p_abiertas boolean DEFAULT true)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
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
      'oferta', r.oferta_titulo, 'oferta_fin', r.oferta_fin,
      'creada', r.created_at, 'lista_at', r.lista_at, 'vence_at', r.vence_at,
      'avisado_via', r.avisado_via, 'avisado_at', r.avisado_at, 'cerrada_at', r.cerrada_at,
      'pago_estado', r.pago_estado, 'pago_metodo', r.pago_metodo, 'entrega', r.entrega,
      'direccion_entrega', r.direccion_entrega, 'costo_envio', r.costo_envio, 'anticipo', r.anticipo)
      ORDER BY (r.estado = 'pendiente') DESC, (r.estado = 'lista') DESC, r.created_at DESC)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
      JOIN public.branches b ON b.id = r.branch_id
     WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertas THEN r.estado IN ('pendiente', 'lista')
                 ELSE r.created_at > now() - interval '30 days' END)), '[]'::json);
END;
$function$;
