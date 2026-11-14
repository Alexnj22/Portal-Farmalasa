SET lock_timeout = '5s';

-- El cliente ya no quiere un encargo que todavía no pagó (2026-11-14, pedido
-- del usuario). Desde la app lo cancela él (`cancelar_encargo` en
-- app-clientes); quien no tiene la app, o avisa por teléfono, no tenía cómo:
-- el encargo quedaba abierto para siempre. Lo cancela la sala del retiro,
-- Bodega o administración (`encargo_puede_manejar`), con el motivo escrito.
--
-- Sólo sin dinero de por medio: pagado, con un cobro en caja vivo o con un
-- pago en línea en curso, NO se cancela acá — lo pagado va por «Pasar a saldo
-- a favor». El resto de una reserva se resuelve desde la reserva.
CREATE OR REPLACE FUNCTION public.encargo_cancelar_sin_pago(p_id bigint, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos; v_emp uuid := public.auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe el motivo (por ejemplo, qué dijo el cliente).'; END IF;
  IF e.estado NOT IN ('solicitado', 'confirmado') THEN
    RAISE EXCEPTION 'Ese encargo ya no se puede cancelar: ya se pagó o ya está cerrado.';
  END IF;
  IF e.pago_estado = 'pagado' THEN
    RAISE EXCEPTION 'Ese encargo ya está pagado: usa «Pasar a saldo a favor».';
  END IF;
  IF e.reserva_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se resuelve desde la reserva.', lpad(e.reserva_id::text, 6, '0');
  END IF;
  IF EXISTS (SELECT 1 FROM public.caja_movimientos_portal m WHERE m.encargo_id = e.id AND m.anulado_at IS NULL) THEN
    RAISE EXCEPTION 'Ese encargo tiene un cobro en caja: no se cancela sin resolver ese cobro.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas_pagos pg WHERE pg.encargo_id = e.id
               AND (pg.pagado_at IS NOT NULL OR pg.created_at > now() - interval '2 hours')) THEN
    RAISE EXCEPTION 'El cliente tiene un pago en línea en curso para ese encargo: espera a que se resuelva.';
  END IF;

  UPDATE public.app_encargos
     SET estado = 'cancelado', cerrado_at = now(), updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || 'Cancelado: ' || v_motivo, 300)
   WHERE id = p_id;

  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (e.customer_id, 'encargo', 'base:encargo_cancelado:' || p_id, 'Cancelamos tu encargo',
          'Como nos pediste, cancelamos el encargo de ' || coalesce(e.producto_nombre, 'tu producto') || '. No se te cobró nada.',
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;

  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_CANCELADO_SIN_PAGO', p_id::text,
          jsonb_build_object('antes', e.estado, 'motivo', v_motivo, 'por_cobrar', e.anticipo), e.branch_id, 'ADMIN_PANEL');

  RETURN json_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE EXECUTE ON FUNCTION public.encargo_cancelar_sin_pago(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_cancelar_sin_pago(bigint, text) TO authenticated, service_role;

