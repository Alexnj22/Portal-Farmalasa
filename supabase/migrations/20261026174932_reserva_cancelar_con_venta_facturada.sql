-- Cancelar una reserva cuyo producto YA se le facturó al cliente (2026-10-26).
--
-- R-000114 (La Popular): $40 de anticipo el 22-oct; el 24-oct la caja le
-- facturó a la misma clienta los 2 frascos (factura 398582) sin pasar por
-- «Retirar», así que nada amarró el anticipo a esa venta. El 25-oct la preventa
-- falló («en la caja hay 0») —porque ya se habían vendido— y la sala canceló.
-- Cancelar convierte el anticipo en saldo a favor: $40 que la clienta ya había
-- usado quedaron disponibles otra vez. El corte de esa noche dio −$40 y se
-- recontó exacto: el anticipo cubrió parte de la factura.
--
-- La guarda que existía (`apartado_aplicaciones`) sólo ve el anticipo aplicado
-- por «Retirar». Ahora, si cancelar dejaría saldo y hay una factura válida del
-- MISMO cliente con el MISMO producto desde que se reservó, la base no decide
-- sola: lanza VENTA_YA_FACTURADA con las facturas en DETAIL, y la sala contesta
-- con `p_anticipo_en_venta`:
--   true  → el anticipo se descontó en esa venta: se cancela SIN saldo.
--   false → el cliente pagó la venta completa: se cancela con saldo, como antes.
-- Las dos respuestas quedan en la bitácora con las facturas.
--
-- La firma cambia (un parámetro más con default), así que se BORRA la vieja:
-- dejarla viva sería una sobrecarga con sus permisos y sin el freno, y la
-- llamada de tres argumentos sería ambigua.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reserva_ventas_del_producto(p_reserva public.app_reservas)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json;
BEGIN
  -- Facturas válidas del mismo cliente que llevan el producto de la reserva,
  -- emitidas desde que se reservó (en cualquier sala). NULL si no hay.
  SELECT json_agg(x ORDER BY x.fecha, x.hora) INTO v FROM (
    SELECT si.id AS invoice_id, si.erp_invoice_id AS factura, si.fecha, si.hora,
           b.name AS sala, sum(ii.cantidad) AS cantidad
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id AND ii.erp_product_id = p_reserva.producto_id
      LEFT JOIN public.branches b ON b.id = si.branch_id
     WHERE si.customer_id = p_reserva.customer_id
       AND (si.fecha + si.hora) >= (p_reserva.created_at AT TIME ZONE 'America/El_Salvador')
       AND public.venta_valida(si.estado)
     GROUP BY si.id, si.erp_invoice_id, si.fecha, si.hora, b.name) x;
  RETURN v;
END $$;

REVOKE EXECUTE ON FUNCTION public.reserva_ventas_del_producto(public.app_reservas) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_ventas_del_producto(public.app_reservas) TO service_role;

DROP FUNCTION IF EXISTS public.reserva_cambiar_estado(bigint, text, text);

CREATE FUNCTION public.reserva_cambiar_estado(p_id bigint, p_estado text, p_motivo text DEFAULT NULL::text,
                                              p_anticipo_en_venta boolean DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_horas integer;
  v_saldo numeric;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_deja_saldo boolean;
  v_ventas json;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_estado IN ('lista', 'retirada') AND r.origen = 'app' AND r.bajo_receta AND r.receta_estado IS DISTINCT FROM 'aprobada' THEN
    RAISE EXCEPTION 'La receta de esta reserva todavía no está aprobada.' USING ERRCODE = 'P0001';
  END IF;
  IF p_estado = 'lista' AND r.estado = 'pendiente' THEN
    -- El plazo: la única regla (`reserva_horas_al_preparar` → `puntos_horas_reserva`).
    v_horas := public.reserva_horas_al_preparar(r);
    UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), vence_at = now() + make_interval(hours => v_horas),
           preparada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSIF p_estado = 'retirada' AND r.estado = 'lista' THEN
    -- Con anticipo, el retiro lo hace `apartado_entregar` / «Retirar» (2026-10-20).
    IF NOT coalesce(r.pago_prueba, false)
       AND greatest(coalesce(r.anticipo, 0), CASE WHEN r.pago_estado = 'pagado' THEN 1 ELSE 0 END) > 0
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
      RAISE EXCEPTION 'Esta reserva tiene un pago: usa «Retirar» para aplicarlo a la factura.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.app_reservas SET estado = 'retirada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
           pagado_at = coalesce(pagado_at, now())
     WHERE id = p_id;
  ELSIF p_estado = 'cancelada' AND r.estado IN ('en_revision', 'pendiente', 'lista') THEN
    -- Un anticipo ya aplicado a una factura es dinero de esa venta: no se
    -- cancela ni vuelve como saldo a favor.
    IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
      RAISE EXCEPTION 'El anticipo de esta reserva ya se aplicó a una factura: no se puede cancelar.' USING ERRCODE = 'P0001';
    END IF;
    -- El anticipo de caja queda a favor, igual que al vencer. Uno de PRUEBA
    -- no es dinero: no deja saldo.
    v_deja_saldo := r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado')
                    AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false);
    -- (2026-10-26) …salvo que el producto ya se le haya facturado al cliente
    -- por fuera de «Retirar»: ahí quien cancela tiene que decir si el anticipo
    -- se descontó en esa venta. Ver el encabezado de la migración.
    IF v_deja_saldo THEN
      v_ventas := public.reserva_ventas_del_producto(r);
      IF v_ventas IS NOT NULL THEN
        IF p_anticipo_en_venta IS NULL THEN
          RAISE EXCEPTION 'VENTA_YA_FACTURADA' USING ERRCODE = 'P0001', DETAIL = v_ventas::text;
        ELSIF p_anticipo_en_venta THEN
          v_deja_saldo := false;
        END IF;
      END IF;
    END IF;
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           saldo_favor = CASE WHEN v_deja_saldo THEN anticipo ELSE saldo_favor END,
           saldo_favor_vence = CASE WHEN v_deja_saldo THEN v_hoy + public.saldo_favor_dias() ELSE saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN v_deja_saldo THEN 'anticipo' ELSE saldo_favor_origen END
     WHERE id = p_id
    RETURNING saldo_favor INTO v_saldo;
    IF r.origen = 'app' THEN
      INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
      VALUES (r.customer_id, 'reserva', 'base:cancelada:' || r.id,
              'La sucursal canceló tu reserva',
              r.producto_nombre || coalesce(' · ' || nullif(btrim(p_motivo), ''), '')
                || CASE WHEN coalesce(v_saldo, 0) > 0 THEN '. Lo que pagaste quedó a tu favor para otra compra en cualquier sucursal.' ELSE '.' END,
              '/reservas')
      ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
    END IF;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', r.estado, p_estado;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'RESERVA_' || upper(p_estado), p_id::text,
          jsonb_build_object('antes', r.estado, 'motivo', p_motivo, 'saldo_favor', v_saldo)
            || CASE WHEN v_ventas IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('ventas', v_ventas::jsonb, 'anticipo_en_venta', p_anticipo_en_venta) END,
          r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', p_id, 'estado', p_estado, 'saldo_favor', v_saldo);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reserva_cambiar_estado(bigint, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_cambiar_estado(bigint, text, text, boolean) TO authenticated, service_role;
