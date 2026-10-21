-- Rechazar = anular (2026-10-21). «si no la aprobé significa que se cancela»
-- (usuario). Desde hoy el rechazo lo hace `operar-caja` (acción
-- `rechazar_autorizacion`): llama a esta función con la sesión de quien decide
-- y después borra el movimiento en la caja y lo anula en el portal. Acá sólo
-- cambia lo que se le dice a quien lo anotó: ya no «puedes reenviarla», sino
-- que se anuló y, si hacía falta, se anota de nuevo con su comprobante.
-- Cuerpo partido de la definición VIVA (pg_get_functiondef), sólo dos textos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.caja_ingreso_resolver(p_solicitud uuid, p_aprobar boolean, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo     uuid := public.auth_employee_id();
  v_sol    public.approval_requests%ROWTYPE;
  v_mov    public.caja_movimientos_portal%ROWTYPE;
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_titulo text;
  v_cuerpo text;
  v_forma  text;
  v_que    text;
BEGIN
  IF v_yo IS NULL OR NOT public.puede_aprobar_modulo(v_yo, 'requests_caja') THEN
    RAISE EXCEPTION 'No tienes permiso para autorizar movimientos de caja.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sol FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
  IF NOT FOUND OR v_sol.type <> 'CAJA_INGRESO_AUTORIZACION' THEN
    RAISE EXCEPTION 'No existe esa solicitud de autorización.';
  END IF;
  IF v_sol.status <> 'PENDING' THEN RAISE EXCEPTION 'Esa solicitud ya está resuelta.'; END IF;
  IF v_sol.employee_id = v_yo THEN
    RAISE EXCEPTION 'No puedes autorizar un movimiento que anotaste tú.';
  END IF;
  IF NOT p_aprobar AND v_nota IS NULL THEN
    RAISE EXCEPTION 'Para rechazarlo escribe por qué.';
  END IF;

  SELECT * INTO v_mov FROM public.caja_movimientos_portal
   WHERE id = (v_sol.metadata ->> 'movimiento_portal')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El movimiento de esa solicitud ya no existe.'; END IF;
  -- Anulado (o pasado a efectivo con una corrección) ya no hay nada que autorizar.
  IF v_mov.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese movimiento ya se anuló: no hay nada que autorizar.'; END IF;

  UPDATE public.approval_requests
     SET status = CASE WHEN p_aprobar THEN 'APPROVED' ELSE 'REJECTED' END,
         approver_id = v_yo, approver_note = v_nota, updated_at = now()
   WHERE id = p_solicitud;

  UPDATE public.caja_movimientos_portal
     SET autorizacion = CASE WHEN p_aprobar THEN 'APROBADA' ELSE 'RECHAZADA' END,
         autorizacion_por = v_yo, autorizacion_at = now(), autorizacion_nota = v_nota,
         updated_at = now()
   WHERE id = v_mov.id;

  v_forma := CASE v_mov.forma_pago WHEN 'TARJETA' THEN 'con tarjeta'
                                   WHEN 'TRANSFERENCIA' THEN 'por transferencia'
                                   ELSE 'en efectivo' END;
  v_que := CASE WHEN v_mov.tipo = 'SALIDA' THEN 'La salida' ELSE 'El ingreso' END;
  v_titulo := CASE WHEN v_mov.tipo = 'SALIDA'
                   THEN CASE WHEN p_aprobar THEN 'Salida autorizada' ELSE 'Salida anulada' END
                   ELSE CASE WHEN p_aprobar THEN 'Ingreso autorizado' ELSE 'Ingreso anulado' END END;
  v_cuerpo := v_que || ' de ' || to_char(v_mov.monto, 'FM$999,990.00') || ' ' || v_forma
           || ' (' || coalesce(v_mov.concepto, 'sin concepto') || ')'
           || CASE WHEN p_aprobar THEN ' quedó autorizad' || CASE WHEN v_mov.tipo = 'SALIDA' THEN 'a.' ELSE 'o.' END
                   ELSE ' no se autorizó y se anuló: ' || v_nota || '. Si hacía falta, anótal'
                        || CASE WHEN v_mov.tipo = 'SALIDA' THEN 'a' ELSE 'o' END || ' de nuevo con su comprobante.' END;
  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, created_by)
  VALUES (v_sol.employee_id, 'REQUEST_DECIDED', v_titulo, v_cuerpo, '/mi-caja',
          jsonb_build_object('request_id', p_solicitud, 'request_type', 'CAJA_INGRESO_AUTORIZACION',
                             'movimiento_portal', v_mov.id), v_yo);
  -- El push es un aviso: si falla, la decisión ya quedó escrita.
  BEGIN
    PERFORM net.http_post(
      url := public.push_function_url(), headers := public.push_function_headers(),
      body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', '/mi-caja',
                                 'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[v_sol.employee_id])));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'caja_ingreso_resolver: push no enviado: %', SQLERRM;
  END;

  RETURN json_build_object('movimiento', v_mov.id, 'aprobado', p_aprobar);
END $function$;

REVOKE ALL ON FUNCTION public.caja_ingreso_resolver(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caja_ingreso_resolver(uuid, boolean, text) TO authenticated, service_role;
