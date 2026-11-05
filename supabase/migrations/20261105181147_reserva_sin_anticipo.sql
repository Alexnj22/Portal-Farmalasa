-- Reserva SIN anticipo (2026-11-05, pedido del usuario): «al reservar sin
-- anticipo, queda a responsabilidad de quien solicita la reserva (el
-- empleado)». Para el cliente que no puede dejar nada (vive lejos, etc.).
--
-- · Se aparta igual que una reserva sin pagar (la del enlace de pago):
--   `sucursal-v3`, pago pendiente, plazo `dias_sin_pagar`.
-- · Queda firmada: `responsable_id` es la ficha de quien la creó
--   (`auth_employee_id()`, nunca un parámetro del navegador).
-- · Sólo lo que hay en la sala o ya viene en camino: pedir un traslado a otra
--   sala para alguien que no dejó nada mueve producto sin compromiso.
SET lock_timeout = '5s';

ALTER TABLE public.app_reservas
  ADD COLUMN IF NOT EXISTS responsable_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS responsable_at timestamptz;
COMMENT ON COLUMN public.app_reservas.responsable_id IS
  'Reserva sin anticipo: la persona del personal que la pidió y responde por ella (2026-11-05).';
CREATE INDEX IF NOT EXISTS app_reservas_responsable_idx
  ON public.app_reservas (responsable_id) WHERE responsable_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.apartado_sin_anticipo(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_modo text := p_apartado->>'modo';
  v_cliente bigint := nullif(p_apartado->>'customer_id', '')::bigint;
  v_cot json; v_pedido text; v_id bigint; v_ids bigint[] := '{}'; l jsonb;
  v_vence timestamptz; v_pend boolean; v_codigo text; c record;
BEGIN
  IF v_emp IS NULL OR NOT (SELECT public.auth_can_edit_any(ARRAY['reservas']))
     OR NOT public.reserva_puede_manejar(p_branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND coalesce(b.type, 'FARMACIA') = 'FARMACIA') THEN
    RAISE EXCEPTION 'Se aparta en una sala de venta.';
  END IF;
  IF v_modo IS DISTINCT FROM 'nueva' AND v_modo IS DISTINCT FROM 'pedido' THEN
    RAISE EXCEPTION 'Sin anticipo se aparta un producto o un pedido nuevo.';
  END IF;
  IF nullif(p_apartado->>'traslado_desde', '') IS NOT NULL THEN
    RAISE EXCEPTION 'Sin anticipo no se pide a otra sala: sólo lo que hay en la sala o ya viene en camino.';
  END IF;

  -- Las mismas validaciones que con anticipo: cliente, precio, existencia, traslados en camino.
  v_cot := public.apartado_cotizar(p_branch_id, p_apartado);

  IF v_modo = 'pedido' THEN
    v_pedido := public.apartado_codigo_de_pedido();
    FOR l IN SELECT * FROM jsonb_array_elements(p_apartado->'lineas') LOOP
      v_ids := v_ids || public.apartado_crear_reserva(p_branch_id, v_cliente, l, 0, NULL, v_emp, v_pedido, true);
    END LOOP;
    v_codigo := v_pedido;
  ELSE
    v_id := public.apartado_crear_reserva(p_branch_id, v_cliente, p_apartado, 0, NULL, v_emp, NULL, true);
    v_ids := ARRAY[v_id];
    v_codigo := 'R-' || lpad(v_id::text, 6, '0');
  END IF;

  UPDATE public.app_reservas SET responsable_id = v_emp, responsable_at = now() WHERE id = ANY (v_ids);
  SELECT min(vence_at), bool_or(estado = 'pendiente') INTO v_vence, v_pend FROM public.app_reservas WHERE id = ANY (v_ids);
  SELECT name, phone INTO c FROM public.customers WHERE id = v_cliente;

  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id, source)
  VALUES ('RESERVA_SIN_ANTICIPO', v_codigo,
          jsonb_build_object('reservas', to_jsonb(v_ids), 'total', (v_cot->>'total')::numeric, 'responsable', v_emp),
          p_branch_id, v_emp, 'ADMIN_PANEL');

  RETURN json_build_object('codigo', v_codigo, 'id', v_ids[1], 'ids', to_json(v_ids), 'pedido', v_pedido,
    'total', (v_cot->>'total')::numeric, 'vence_at', CASE WHEN v_pend THEN NULL ELSE v_vence END,
    'cliente', c.name, 'telefono', c.phone, 'detalle', v_cot->>'detalle');
END $function$;

REVOKE EXECUTE ON FUNCTION public.apartado_sin_anticipo(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apartado_sin_anticipo(bigint, jsonb) TO authenticated, service_role;

-- La lista de reservas trae quién responde. Se parte de la definición VIVA y se
-- le agregan dos piezas; si alguna no se encuentra, la migración falla.
DO $do$
DECLARE
  d text := pg_get_functiondef('public.reservas_de_sucursal(bigint,boolean)'::regprocedure);
  n text;
  a1 text := $x$'faltan_en_sala', cob.faltan, 'hay_en_sala', cob.hay)$x$;
  a2 text := 'LEFT JOIN public.branches bt ON bt.id = r.traslado_desde';
BEGIN
  IF position('responsable' IN d) > 0 THEN RETURN; END IF;
  IF position(a1 IN d) = 0 OR position(a2 IN d) = 0 THEN
    RAISE EXCEPTION 'reservas_de_sucursal cambió: no se encontró dónde agregar el responsable.';
  END IF;
  n := replace(d, a1, $x$'faltan_en_sala', cob.faltan, 'hay_en_sala', cob.hay,
      'responsable', CASE WHEN r.responsable_id IS NOT NULL THEN jsonb_build_object('id', er.id, 'name', er.name,
        'first_names', er.first_names, 'last_names', er.last_names, 'at', r.responsable_at) END)$x$);
  n := replace(n, a2, a2 || E'\n      LEFT JOIN public.employees er ON er.id = r.responsable_id');
  EXECUTE n;
END $do$;
