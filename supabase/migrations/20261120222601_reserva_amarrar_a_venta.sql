SET lock_timeout = '5s';

-- Amarrar una reserva a la venta que ya se hizo en caja (2026-11-20).
--
-- La R-000164 de Salud 1 se vendió en caja como venta suelta; la sala sacó
-- después los $6.60 del anticipo con una salida de efectivo. La reserva no
-- se tenía que CANCELAR (eso habla de un cliente que no vino): se entregó, en
-- esa factura. Esta función la cierra como retirada y deja escrita la factura.
--
-- La factura tiene que ser una de `reserva_ventas_del_producto` (mismo
-- cliente, mismo producto, después de reservar, venta válida) y no estar
-- amarrada a otra reserva. `p_anticipo_descontado`:
--   true  — el anticipo se usó para esa venta: no queda saldo a favor;
--   false — el cliente pagó la factura completa: el anticipo queda a su favor
--           (misma regla que al cancelar).
--
-- `venta_amarrada_id` sin FK a propósito: una FK hacia `sales_invoices`
-- toma lock sobre una tabla caliente (la escriben los syncs cada minuto).
ALTER TABLE public.app_reservas ADD COLUMN IF NOT EXISTS venta_amarrada_id bigint;
COMMENT ON COLUMN public.app_reservas.venta_amarrada_id IS
  'sales_invoices.id de la venta hecha en caja por fuera que entregó esta reserva (reserva_amarrar_a_venta). Sin FK: sales_invoices es tabla caliente.';
CREATE UNIQUE INDEX IF NOT EXISTS app_reservas_venta_amarrada_uq
  ON public.app_reservas (venta_amarrada_id) WHERE venta_amarrada_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reserva_amarrar_a_venta(p_id bigint, p_invoice_id bigint, p_anticipo_descontado boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ventas json;
  v_factura text;
  v_deja_saldo boolean;
  v_saldo numeric;
  v_cod text;
BEGIN
  IF p_anticipo_descontado IS NULL THEN
    RAISE EXCEPTION 'Falta decir si en esa venta se descontó el anticipo.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF r.estado NOT IN ('pendiente', 'lista') THEN
    RAISE EXCEPTION 'Esta reserva ya no está abierta.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
    RAISE EXCEPTION 'El anticipo de esta reserva ya se aplicó a una factura.' USING ERRCODE = 'P0001';
  END IF;

  v_ventas := public.reserva_ventas_del_producto(r);
  SELECT v->>'factura' INTO v_factura
    FROM json_array_elements(coalesce(v_ventas, '[]'::json)) v
   WHERE (v->>'invoice_id')::bigint = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa venta no es de este cliente con este producto.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas x WHERE x.venta_amarrada_id = p_invoice_id AND x.id <> r.id) THEN
    RAISE EXCEPTION 'Esa venta ya está amarrada a otra reserva.' USING ERRCODE = 'P0001';
  END IF;

  -- Lo pagado en línea ya es de la venta en línea; uno de PRUEBA no es dinero.
  v_deja_saldo := NOT p_anticipo_descontado AND coalesce(r.anticipo, 0) > 0
                  AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado')
                  AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false);

  UPDATE public.app_reservas
     SET estado = 'retirada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
         venta_amarrada_id = p_invoice_id,
         pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
         pagado_at = coalesce(pagado_at, now()),
         saldo_favor = CASE WHEN v_deja_saldo THEN anticipo ELSE saldo_favor END,
         saldo_favor_vence = CASE WHEN v_deja_saldo THEN v_hoy + public.saldo_favor_dias() ELSE saldo_favor_vence END,
         saldo_favor_origen = CASE WHEN v_deja_saldo THEN 'anticipo' ELSE saldo_favor_origen END
   WHERE id = p_id
  RETURNING saldo_favor INTO v_saldo;

  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'RESERVA_RETIRADA', r.id::text,
          jsonb_build_object('por', 'venta_en_caja', 'sales_invoice_id', p_invoice_id, 'factura', v_factura,
                             'anticipo_descontado', p_anticipo_descontado,
                             'saldo_favor', CASE WHEN v_deja_saldo THEN v_saldo END),
          r.branch_id, 'ADMIN_PANEL');

  IF r.origen = 'app' THEN
    v_cod := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));
    INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
    VALUES (r.customer_id, 'reserva', 'base:retirada:' || v_cod, '¡Gracias por tu compra!',
            r.producto_nombre || ' ya es tuyo. Tu reserva quedó entregada.', '/reservas')
    ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  END IF;

  RETURN json_build_object('ok', true, 'factura', v_factura, 'saldo_favor', CASE WHEN v_deja_saldo THEN v_saldo END);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reserva_amarrar_a_venta(bigint, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_amarrar_a_venta(bigint, bigint, boolean) TO authenticated, service_role;
