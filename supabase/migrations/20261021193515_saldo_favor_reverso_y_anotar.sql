-- Saldo a favor: lo que no se canjeó en una hora vuelve a la reserva, y lo que
-- sale de lo normal queda anotado donde se anotan las de puntos (2026-10-21).
-- Parte 1: el tipo 'reverso' y la función que anota.
SET lock_timeout = '5s';

ALTER TABLE public.saldo_favor_movimientos DROP CONSTRAINT saldo_favor_movimientos_tipo_check;
ALTER TABLE public.saldo_favor_movimientos ADD CONSTRAINT saldo_favor_movimientos_tipo_check
  CHECK (tipo = ANY (ARRAY['uso', 'devolucion', 'vencimiento', 'reverso']));

-- Una sola forma de anotar lo que sale de lo normal en el saldo a favor: la
-- misma tabla que el programa de puntos (`puntos_irregularidad`), así sale en
-- Puntos → Avisos junto a las de puntos. `puntos` lleva el monto en centavos
-- (1 punto = $0.01, la misma conversión del saldo). La clave hace que un mismo
-- hecho no se anote dos veces.
CREATE OR REPLACE FUNCTION public.saldo_favor_anotar(
  p_clave text, p_tipo text, p_customer_id bigint, p_branch_id bigint, p_invoice_id bigint,
  p_employee_id uuid, p_monto numeric, p_nota text, p_detalle jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.puntos_irregularidad
    (clave, tipo, dia, customer_id, sucursal, invoice_id, employee_id, puntos, nota, detalle)
  VALUES (p_clave, p_tipo, (now() AT TIME ZONE 'America/El_Salvador')::date, p_customer_id,
          (SELECT b.codigo_puntos FROM public.branches b WHERE b.id = p_branch_id),
          p_invoice_id, p_employee_id, round(coalesce(p_monto, 0) * 100)::integer, p_nota,
          coalesce(p_detalle, '{}'::jsonb) || jsonb_build_object('branch_id', p_branch_id))
  ON CONFLICT (clave) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_anotar(text, text, bigint, bigint, bigint, uuid, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saldo_favor_anotar(text, text, bigint, bigint, bigint, uuid, numeric, text, jsonb) TO service_role;
