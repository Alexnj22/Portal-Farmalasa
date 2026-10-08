SET lock_timeout = '5s';
-- Anticipo de una reserva que vence sin retirarse (decisión del usuario,
-- 2026-10-08): queda como SALDO A FAVOR del cliente por 30 días, para otra
-- compra en cualquier sala; no se devuelve en efectivo. La sala lo ve en su
-- tablero y lo marca como usado al aplicarlo en caja.
ALTER TABLE public.app_reservas
  ADD COLUMN IF NOT EXISTS saldo_favor numeric(10,2),
  ADD COLUMN IF NOT EXISTS saldo_favor_vence date,
  ADD COLUMN IF NOT EXISTS saldo_favor_usado_at timestamptz,
  ADD COLUMN IF NOT EXISTS saldo_favor_usado_por uuid REFERENCES public.employees(id);

CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH liberadas AS (
    UPDATE public.app_reservas SET estado = 'pendiente', lista_at = NULL, vence_at = NULL, updated_at = now()
     WHERE estado = 'lista' AND vence_at < now() AND pago_estado = 'pagado'
    RETURNING 1),
  v AS (
    UPDATE public.app_reservas SET estado = 'vencida', cerrada_at = now(), updated_at = now(),
           -- El anticipo no se pierde: queda a favor 30 días.
           saldo_favor = CASE WHEN anticipo > 0 THEN anticipo END,
           saldo_favor_vence = CASE WHEN anticipo > 0 THEN (now() AT TIME ZONE 'America/El_Salvador')::date + 30 END
     WHERE pago_estado <> 'pagado'
       AND ((estado = 'lista' AND vence_at < now())
         OR (estado = 'pendiente' AND oferta_fin IS NOT NULL
             AND oferta_fin < (now() AT TIME ZONE 'America/El_Salvador')::date))
    RETURNING 1)
  SELECT ((SELECT count(*) FROM liberadas) + (SELECT count(*) FROM v))::int;
$function$;

-- Usar el saldo a favor: lo marca la sala al aplicarlo en caja.
CREATE OR REPLACE FUNCTION public.reserva_usar_saldo_favor(p_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE r public.app_reservas;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa reserva'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF coalesce(r.saldo_favor, 0) <= 0 THEN RAISE EXCEPTION 'Esa reserva no tiene saldo a favor'; END IF;
  IF r.saldo_favor_usado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se usó'; END IF;
  IF r.saldo_favor_vence < (now() AT TIME ZONE 'America/El_Salvador')::date THEN RAISE EXCEPTION 'Ese saldo a favor ya venció'; END IF;
  UPDATE public.app_reservas SET saldo_favor_usado_at = now(), saldo_favor_usado_por = public.auth_employee_id(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id)
  VALUES ('RESERVA_SALDO_FAVOR_USADO', p_id::text, jsonb_build_object('monto', r.saldo_favor), r.branch_id, public.auth_employee_id());
  RETURN json_build_object('ok', true, 'monto', r.saldo_favor);
END $$;
REVOKE EXECUTE ON FUNCTION public.reserva_usar_saldo_favor(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_usar_saldo_favor(bigint) TO authenticated, service_role;
