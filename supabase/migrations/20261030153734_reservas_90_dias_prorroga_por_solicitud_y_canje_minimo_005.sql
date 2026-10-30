-- Reglamento de reservas v2 · ajustes finales (2026-10-30):
--  * reserva pagada completa y encargo especial: 90 días para retirar (antes 60);
--  * prórroga por SOLICITUD (cláusula 6.4): la pide la sala o el cliente desde la
--    app con los días que necesita y el motivo; la autoriza quien tenga
--    `dash_reservas_prorroga` (Talento Humano y Supervisión de ventas). Una sola
--    prórroga autorizada por reserva o encargo. Mientras está pendiente, el
--    plazo no vence.
-- Reglamento Puntos Salud v2, cláusula 6.4: un canje deja al menos US$0.05 a
-- pagar (antes US$0.01). La caja no lo frena: lo vigila la alerta.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.parchar(p_fn regprocedure, p_viejo text, p_nuevo text, p_veces int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text := pg_get_functiondef(p_fn); n int;
BEGIN
  n := (length(d) - length(replace(d, p_viejo, ''))) / length(p_viejo);
  IF n <> p_veces THEN RAISE EXCEPTION 'parche: «%» aparece % veces en % (se esperaban %)', left(p_viejo, 70), n, p_fn, p_veces; END IF;
  EXECUTE replace(d, p_viejo, p_nuevo);
END $$;

-- ─── 1 · Plazos: pagada y encargo, 90 días ────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserva_dias_retiro(p_pago_estado text, p_anticipo numeric)
 RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN p_pago_estado = 'pagado' THEN 90
              WHEN p_pago_estado = 'anticipo' OR coalesce(p_anticipo, 0) > 0.004 THEN 30
              ELSE 7 END;
$function$;

CREATE OR REPLACE FUNCTION public.reserva_plazos(OUT dias_pagada integer, OUT dias_apartado integer, OUT horas_sin_foto integer, OUT horas_receta_sin_revisar integer, OUT horas_para_preparar integer, OUT dias_saldo_favor integer, OUT dias_sin_pagar integer, OUT dias_prorroga integer, OUT dias_encargo integer)
 RETURNS record LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN v THEN 90 ELSE 7 END, CASE WHEN v THEN 30 ELSE 7 END, 24, 24, 24,
         public.saldo_favor_dias(), CASE WHEN v THEN 7 ELSE 3 END, CASE WHEN v THEN 0 ELSE 7 END,
         CASE WHEN v THEN 90 ELSE 7 END
    FROM (SELECT public.reservas_v2_rige() AS v) x;
$function$;

CREATE OR REPLACE FUNCTION public.reserva_plazos(p_en timestamp with time zone, OUT dias_pagada integer, OUT dias_apartado integer, OUT horas_sin_foto integer, OUT horas_receta_sin_revisar integer, OUT horas_para_preparar integer, OUT dias_saldo_favor integer, OUT dias_sin_pagar integer, OUT dias_prorroga integer, OUT dias_encargo integer)
 RETURNS record LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN v THEN 90 ELSE 7 END, CASE WHEN v THEN 30 ELSE 7 END, 24, 24, 24,
         public.saldo_favor_dias(), CASE WHEN v THEN 7 ELSE 3 END, CASE WHEN v THEN 0 ELSE 7 END,
         CASE WHEN v THEN 90 ELSE 7 END
    FROM (SELECT public.reservas_v2_rige(p_en) AS v) x;
$function$;

-- `prorroga_dias` en reglas = 0 sigue queriendo decir «no hay prórroga
-- automática»; la v2 es por solicitud y sus días los pone quien la pide.
CREATE OR REPLACE FUNCTION public.reserva_reglas()
 RETURNS json LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT json_build_object(
    'v2', v, 'desde', public.reglas_v2_desde(),
    'dias_sin_pago', CASE WHEN v THEN 7 ELSE 3 END,
    'dias_anticipo', CASE WHEN v THEN 30 ELSE 7 END,
    'dias_pagada', CASE WHEN v THEN 90 ELSE 7 END,
    'dias_encargo', CASE WHEN v THEN 90 ELSE 7 END,
    'dias_saldo_favor', public.saldo_favor_dias(),
    'prorroga_dias', CASE WHEN v THEN 0 ELSE 7 END,
    'prorroga_por_solicitud', v)
  FROM (SELECT public.reservas_v2_rige() AS v) x;
$function$;

-- ─── 2 · Prórroga por solicitud ──────────────────────────────────────────
ALTER TABLE public.app_reservas ADD COLUMN IF NOT EXISTS prorroga_dias integer;
ALTER TABLE public.app_encargos ADD COLUMN IF NOT EXISTS prorroga_dias integer;

CREATE TABLE IF NOT EXISTS public.prorrogas_retiro (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reserva_id bigint REFERENCES public.app_reservas(id) ON DELETE CASCADE,
  encargo_id bigint REFERENCES public.app_encargos(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL,
  branch_id bigint NOT NULL,
  dias integer NOT NULL CHECK (dias BETWEEN 1 AND 365),
  motivo text NOT NULL,
  origen text NOT NULL CHECK (origen IN ('sala', 'app')),
  pedida_por uuid,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'autorizada', 'negada', 'sin_efecto')),
  dias_autorizados integer,
  decidida_por uuid,
  decidida_at timestamptz,
  nota text,
  vence_antes date,
  vence_despues date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(reserva_id, encargo_id) = 1)
);
COMMENT ON TABLE public.prorrogas_retiro IS
  'Solicitudes de prórroga del plazo para retirar (Reglamento de reservas v2, cl. 6.4). Se escriben sólo por prorroga_pedir* / prorroga_decidir.';
CREATE INDEX IF NOT EXISTS prorrogas_retiro_reserva_idx ON public.prorrogas_retiro (reserva_id);
CREATE INDEX IF NOT EXISTS prorrogas_retiro_encargo_idx ON public.prorrogas_retiro (encargo_id);
CREATE INDEX IF NOT EXISTS prorrogas_retiro_customer_idx ON public.prorrogas_retiro (customer_id);
CREATE INDEX IF NOT EXISTS prorrogas_retiro_pendientes_idx ON public.prorrogas_retiro (created_at) WHERE estado = 'pendiente';
CREATE UNIQUE INDEX IF NOT EXISTS prorrogas_retiro_una_pendiente_reserva ON public.prorrogas_retiro (reserva_id) WHERE estado = 'pendiente' AND reserva_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS prorrogas_retiro_una_pendiente_encargo ON public.prorrogas_retiro (encargo_id) WHERE estado = 'pendiente' AND encargo_id IS NOT NULL;

ALTER TABLE public.prorrogas_retiro ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prorrogas_retiro_select ON public.prorrogas_retiro;
CREATE POLICY prorrogas_retiro_select ON public.prorrogas_retiro FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('dash_reservas_prorroga', 'can_view'))
         OR public.reserva_puede_manejar(branch_id));
REVOKE ALL ON public.prorrogas_retiro FROM anon;
GRANT SELECT ON public.prorrogas_retiro TO authenticated;

INSERT INTO public.role_permissions (role_id, module_key, can_view)
SELECT r.id, 'dash_reservas_prorroga', true FROM public.roles r WHERE r.id IN (11, 13)
ON CONFLICT (role_id, module_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.prorroga_pendiente(p_tipo text, p_id bigint)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.prorrogas_retiro p
                  WHERE p.estado = 'pendiente'
                    AND CASE WHEN p_tipo = 'encargo' THEN p.encargo_id = p_id ELSE p.reserva_id = p_id END);
$function$;

-- La última solicitud de una reserva o encargo, para pintarla en las listas.
-- INVOKER a propósito: la ve quien el RLS de prorrogas_retiro deja ver.
CREATE OR REPLACE FUNCTION public.prorroga_de(p_tipo text, p_id bigint)
 RETURNS json LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT json_build_object('id', p.id, 'estado', p.estado, 'dias', p.dias, 'dias_autorizados', p.dias_autorizados,
                           'motivo', p.motivo, 'origen', p.origen, 'nota', p.nota, 'pedida_at', p.created_at,
                           'decidida_at', p.decidida_at, 'vence_despues', p.vence_despues)
    FROM public.prorrogas_retiro p
   WHERE CASE WHEN p_tipo = 'encargo' THEN p.encargo_id = p_id ELSE p.reserva_id = p_id END
   ORDER BY p.id DESC LIMIT 1;
$function$;

-- Fecha límite de hoy (día de El Salvador) de una reserva lista o un encargo listo.
CREATE OR REPLACE FUNCTION public.prorroga_vence_hoy(p_tipo text, p_id bigint)
 RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN p_tipo = 'encargo'
    THEN (SELECT public.encargo_retirar_hasta(e) FROM public.app_encargos e WHERE e.id = p_id)
    ELSE (SELECT (r.vence_at AT TIME ZONE 'America/El_Salvador')::date FROM public.app_reservas r WHERE r.id = p_id) END;
$function$;

CREATE OR REPLACE FUNCTION public.prorroga_aprobadores()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
  SELECT array_agg(DISTINCT e.id)
    FROM public.employees e
    JOIN public.role_permissions rp ON rp.role_id IN (e.role_id, e.secondary_role_id)
     AND rp.module_key = 'dash_reservas_prorroga' AND (rp.can_view OR rp.can_edit)
   WHERE e.status = 'ACTIVO';
$function$;

-- El cuerpo común de las dos puertas (sala y app). No se expone.
CREATE OR REPLACE FUNCTION public.prorroga_registrar(p_tipo text, p_id bigint, p_customer bigint, p_dias integer,
                                                     p_motivo text, p_origen text, p_empleado uuid)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_branch bigint; v_customer bigint; v_producto text; v_vence date; v_codigo text; v_id bigint;
  v_dest uuid[]; v_cliente text; v_sala text; v_v2 boolean;
BEGIN
  IF p_tipo NOT IN ('reserva', 'encargo') THEN RAISE EXCEPTION 'Tipo inválido.'; END IF;
  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 365 THEN
    RAISE EXCEPTION 'Indica cuántos días de prórroga (de 1 a 365).' USING ERRCODE = 'P0001';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Escribe el motivo de la prórroga.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'reserva' THEN
    SELECT r.branch_id, r.customer_id, r.producto_nombre, public.reservas_v2_rige(r.lista_at),
           coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'))
      INTO v_branch, v_customer, v_producto, v_v2, v_codigo
      FROM public.app_reservas r
     WHERE r.id = p_id AND r.estado = 'lista' AND r.vence_at IS NOT NULL
       AND (p_customer IS NULL OR r.customer_id = p_customer)
       FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sólo se pide prórroga de una reserva lista para retirar.' USING ERRCODE = 'P0001'; END IF;
    IF EXISTS (SELECT 1 FROM public.app_reservas WHERE id = p_id AND prorrogada_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Esta reserva ya tuvo su prórroga: no admite otra.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT e.branch_id, e.customer_id, e.producto_nombre, public.reservas_v2_rige(e.listo_at),
           'E-' || lpad(e.id::text, 6, '0')
      INTO v_branch, v_customer, v_producto, v_v2, v_codigo
      FROM public.app_encargos e
     WHERE e.id = p_id AND e.estado = 'listo'
       AND (p_customer IS NULL OR e.customer_id = p_customer)
       FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sólo se pide prórroga de un encargo que ya llegó.' USING ERRCODE = 'P0001'; END IF;
    IF EXISTS (SELECT 1 FROM public.app_encargos WHERE id = p_id AND prorrogado_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Este encargo ya tuvo su prórroga: no admite otra.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NOT v_v2 THEN
    RAISE EXCEPTION 'Esta reserva se rige por las condiciones anteriores: usa «Prorrogar».' USING ERRCODE = 'P0001';
  END IF;
  IF public.prorroga_pendiente(p_tipo, p_id) THEN
    RAISE EXCEPTION 'Ya hay una prórroga pedida: la están revisando.' USING ERRCODE = 'P0001';
  END IF;

  v_vence := public.prorroga_vence_hoy(p_tipo, p_id);
  INSERT INTO public.prorrogas_retiro (reserva_id, encargo_id, customer_id, branch_id, dias, motivo, origen, pedida_por, vence_antes)
  VALUES (CASE WHEN p_tipo = 'reserva' THEN p_id END, CASE WHEN p_tipo = 'encargo' THEN p_id END,
          v_customer, v_branch, p_dias, left(v_motivo, 300), p_origen, p_empleado, v_vence)
  RETURNING id INTO v_id;

  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = v_customer;
  SELECT name INTO v_sala FROM public.branches WHERE id = v_branch;
  v_dest := public.prorroga_aprobadores();
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Prórroga por autorizar · ' || v_codigo,
      format('%s pide %s día%s más para %s (%s): %s',
             CASE WHEN p_origen = 'app' THEN coalesce(v_cliente, 'El cliente') || ', desde la app,' ELSE coalesce(v_sala, 'Una sala') END,
             p_dias, CASE WHEN p_dias = 1 THEN '' ELSE 's' END, coalesce(v_producto, 'retirar'),
             coalesce(v_cliente, 'cliente'), left(v_motivo, 160)),
      '/reservas', jsonb_build_object('codigo', v_codigo, 'prorroga_id', v_id, 'check_key', 'prorroga_pedida:' || v_id),
      true, v_branch::integer);
  END IF;
  IF p_origen = 'app' THEN
    v_dest := public.destinatarios_de_reservas(v_branch);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'El cliente pidió prórroga · ' || v_codigo,
        format('%s pidió %s día%s más desde la app. Sigue separada mientras se decide.', coalesce(v_cliente, 'El cliente'),
               p_dias, CASE WHEN p_dias = 1 THEN '' ELSE 's' END),
        '/reservas', jsonb_build_object('codigo', v_codigo, 'check_key', 'prorroga_pedida_sala:' || v_id), false, v_branch::integer);
    END IF;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (p_empleado, 'PRORROGA_PEDIDA', v_codigo,
          jsonb_build_object('prorroga_id', v_id, 'tipo', p_tipo, 'id', p_id, 'dias', p_dias, 'motivo', v_motivo, 'origen', p_origen),
          v_branch, CASE WHEN p_origen = 'app' THEN 'SYSTEM' ELSE 'ADMIN_PANEL' END);
  RETURN json_build_object('ok', true, 'id', v_id, 'vence', v_vence);
END $function$;
REVOKE EXECUTE ON FUNCTION public.prorroga_registrar(text, bigint, bigint, integer, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prorroga_registrar(text, bigint, bigint, integer, text, text, uuid) TO service_role;

-- Puerta de la sala (portal y app del personal).
CREATE OR REPLACE FUNCTION public.prorroga_pedir(p_tipo text, p_id bigint, p_dias integer, p_motivo text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_branch bigint;
BEGIN
  IF p_tipo = 'encargo' THEN
    SELECT branch_id INTO v_branch FROM public.app_encargos WHERE id = p_id;
    IF v_branch IS NULL OR NOT public.encargo_puede_manejar(v_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  ELSE
    SELECT branch_id INTO v_branch FROM public.app_reservas WHERE id = p_id;
    IF v_branch IS NULL OR NOT public.reserva_puede_manejar(v_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN public.prorroga_registrar(p_tipo, p_id, NULL, p_dias, p_motivo, 'sala', public.auth_employee_id());
END $function$;
REVOKE EXECUTE ON FUNCTION public.prorroga_pedir(text, bigint, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prorroga_pedir(text, bigint, integer, text) TO authenticated, service_role;

-- Puerta del cliente: la llama `app-clientes` con la llave del servidor y el
-- cliente de la sesión. Devuelve {ok, mensaje} en vez de lanzar, como las
-- demás acciones de la app.
CREATE OR REPLACE FUNCTION public.prorroga_pedir_por_cliente(p_tipo text, p_id bigint, p_customer bigint, p_dias integer, p_motivo text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_customer IS NULL THEN RETURN json_build_object('ok', false, 'mensaje', 'Inicia sesión para pedir más plazo.'); END IF;
  RETURN public.prorroga_registrar(p_tipo, p_id, p_customer, p_dias, p_motivo, 'app', NULL);
EXCEPTION WHEN raise_exception OR check_violation OR unique_violation THEN
  RETURN json_build_object('ok', false, 'mensaje', SQLERRM);
END $function$;
REVOKE EXECUTE ON FUNCTION public.prorroga_pedir_por_cliente(text, bigint, bigint, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prorroga_pedir_por_cliente(text, bigint, bigint, integer, text) TO service_role;

-- Autorizar o negar. `p_dias` permite autorizar otro número de días; NULL =
-- los que se pidieron.
CREATE OR REPLACE FUNCTION public.prorroga_decidir(p_id bigint, p_autorizar boolean, p_nota text, p_dias integer DEFAULT NULL)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  p public.prorrogas_retiro; v_emp uuid := public.auth_employee_id();
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_dias integer; v_vence date; v_codigo text; v_producto text; v_vence_at timestamptz; v_dest uuid[];
  e public.app_encargos;
BEGIN
  IF NOT public.auth_has_module_permission('dash_reservas_prorroga', 'can_view') THEN
    RAISE EXCEPTION 'No tienes permiso para decidir prórrogas.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.prorrogas_retiro WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR p.estado <> 'pendiente' THEN RAISE EXCEPTION 'Esa prórroga ya no está pendiente.' USING ERRCODE = 'P0001'; END IF;
  IF NOT p_autorizar AND (v_nota IS NULL OR length(v_nota) < 3) THEN
    RAISE EXCEPTION 'Escribe el motivo: es lo que se le dice al cliente.' USING ERRCODE = 'P0001';
  END IF;
  v_dias := coalesce(p_dias, p.dias);
  IF p_autorizar AND (v_dias < 1 OR v_dias > 365) THEN RAISE EXCEPTION 'Los días van de 1 a 365.' USING ERRCODE = 'P0001'; END IF;

  IF p.reserva_id IS NOT NULL THEN
    SELECT coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')), r.producto_nombre INTO v_codigo, v_producto
      FROM public.app_reservas r WHERE r.id = p.reserva_id;
  ELSE
    SELECT 'E-' || lpad(x.id::text, 6, '0'), x.producto_nombre INTO v_codigo, v_producto
      FROM public.app_encargos x WHERE x.id = p.encargo_id;
  END IF;

  IF p_autorizar THEN
    IF p.reserva_id IS NOT NULL THEN
      UPDATE public.app_reservas
         SET vence_at = vence_at + make_interval(days => v_dias), prorroga_dias = v_dias,
             prorrogada_at = now(), prorrogada_por = v_emp, updated_at = now()
       WHERE id = p.reserva_id AND estado = 'lista'
      RETURNING vence_at INTO v_vence_at;
      IF NOT FOUND THEN RAISE EXCEPTION 'La reserva ya no está lista para retirar.' USING ERRCODE = 'P0001'; END IF;
      v_vence := (v_vence_at AT TIME ZONE 'America/El_Salvador')::date;
    ELSE
      UPDATE public.app_encargos
         SET prorroga_dias = v_dias, prorrogado_at = now(), prorrogado_por = v_emp,
             aviso_sin_retirar_at = NULL, updated_at = now()
       WHERE id = p.encargo_id AND estado = 'listo'
      RETURNING * INTO e;
      IF NOT FOUND THEN RAISE EXCEPTION 'El encargo ya no está para retirar.' USING ERRCODE = 'P0001'; END IF;
      v_vence := public.encargo_retirar_hasta(e);
    END IF;
  END IF;

  UPDATE public.prorrogas_retiro
     SET estado = CASE WHEN p_autorizar THEN 'autorizada' ELSE 'negada' END,
         dias_autorizados = CASE WHEN p_autorizar THEN v_dias END,
         decidida_por = v_emp, decidida_at = now(), nota = left(v_nota, 300), vence_despues = v_vence
   WHERE id = p_id;

  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (p.customer_id, 'reserva', 'base:prorroga_v2:' || p_id,
          CASE WHEN p_autorizar THEN 'Tu reserva tiene más plazo' ELSE 'Tu prórroga no se autorizó' END,
          CASE WHEN p_autorizar
               THEN 'Puedes retirar ' || coalesce(v_producto, 'tu reserva') || ' hasta el ' || to_char(v_vence, 'DD/MM/YYYY') || ', todo el día.'
               ELSE 'Puedes retirar ' || coalesce(v_producto, 'tu reserva') || ' hasta el ' || to_char(p.vence_antes, 'DD/MM/YYYY')
                    || '. Motivo: ' || left(v_nota, 160) END,
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;

  v_dest := public.destinatarios_de_reservas(p.branch_id);
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
      CASE WHEN p_autorizar THEN 'Prórroga autorizada · ' ELSE 'Prórroga negada · ' END || v_codigo,
      CASE WHEN p_autorizar
           THEN format('Retira hasta el %s (%s día%s más). Si el cliente no usa la app, avísale.', to_char(v_vence, 'DD/MM/YYYY'),
                       v_dias, CASE WHEN v_dias = 1 THEN '' ELSE 's' END)
           ELSE format('El plazo sigue al %s: %s. Si el cliente no usa la app, avísale.', to_char(p.vence_antes, 'DD/MM/YYYY'), left(v_nota, 160)) END,
      '/reservas', jsonb_build_object('codigo', v_codigo, 'check_key', 'prorroga_decidida:' || p_id), true, p.branch_id::integer);
  END IF;

  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, CASE WHEN p_autorizar THEN 'PRORROGA_AUTORIZADA' ELSE 'PRORROGA_NEGADA' END, v_codigo,
          jsonb_build_object('prorroga_id', p_id, 'dias', v_dias, 'pedidos', p.dias, 'nota', v_nota, 'antes', p.vence_antes, 'ahora', v_vence),
          p.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'vence', v_vence);
END $function$;
REVOKE EXECUTE ON FUNCTION public.prorroga_decidir(bigint, boolean, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prorroga_decidir(bigint, boolean, text, integer) TO authenticated, service_role;

-- Bandeja de quien autoriza.
CREATE OR REPLACE FUNCTION public.prorrogas_pendientes()
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('dash_reservas_prorroga', 'can_view') THEN RETURN '[]'::json; END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', p.id, 'tipo', CASE WHEN p.reserva_id IS NOT NULL THEN 'reserva' ELSE 'encargo' END,
      'reserva_id', p.reserva_id, 'encargo_id', p.encargo_id,
      'codigo', CASE WHEN p.reserva_id IS NOT NULL THEN coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'))
                     ELSE 'E-' || lpad(p.encargo_id::text, 6, '0') END,
      'producto', coalesce(r.producto_nombre, e.producto_nombre), 'cliente', c.name, 'customer_id', p.customer_id,
      'sala', b.name, 'branch_id', p.branch_id, 'dias', p.dias, 'motivo', p.motivo, 'origen', p.origen,
      'pedida_por', p.pedida_por, 'pedida_at', p.created_at, 'vence', p.vence_antes,
      'pagado', CASE WHEN p.reserva_id IS NOT NULL THEN r.pago_estado ELSE e.pago_estado END) ORDER BY p.created_at)
      FROM public.prorrogas_retiro p
      LEFT JOIN public.app_reservas r ON r.id = p.reserva_id
      LEFT JOIN public.app_encargos e ON e.id = p.encargo_id
      JOIN public.customers c ON c.id = p.customer_id
      JOIN public.branches b ON b.id = p.branch_id
     WHERE p.estado = 'pendiente'), '[]'::json);
END $function$;
REVOKE EXECUTE ON FUNCTION public.prorrogas_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prorrogas_pendientes() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.prorroga_pendiente(text, bigint), public.prorroga_de(text, bigint),
  public.prorroga_vence_hoy(text, bigint), public.prorroga_aprobadores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prorroga_pendiente(text, bigint), public.prorroga_de(text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prorroga_vence_hoy(text, bigint), public.prorroga_aprobadores() TO service_role;

-- Si la reserva o el encargo se cierra con la solicitud pendiente, queda sin efecto.
CREATE OR REPLACE FUNCTION public.prorroga_sin_efecto_al_cerrar()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'app_reservas' THEN
    IF NEW.estado <> 'lista' AND OLD.estado = 'lista' THEN
      UPDATE public.prorrogas_retiro SET estado = 'sin_efecto', decidida_at = now()
       WHERE reserva_id = NEW.id AND estado = 'pendiente';
    END IF;
  ELSIF NEW.estado <> 'listo' AND OLD.estado = 'listo' THEN
    UPDATE public.prorrogas_retiro SET estado = 'sin_efecto', decidida_at = now()
     WHERE encargo_id = NEW.id AND estado = 'pendiente';
  END IF;
  RETURN NULL;
END $function$;
REVOKE EXECUTE ON FUNCTION public.prorroga_sin_efecto_al_cerrar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS prorroga_sin_efecto ON public.app_reservas;
CREATE TRIGGER prorroga_sin_efecto AFTER UPDATE OF estado ON public.app_reservas
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.prorroga_sin_efecto_al_cerrar();
DROP TRIGGER IF EXISTS prorroga_sin_efecto ON public.app_encargos;
CREATE TRIGGER prorroga_sin_efecto AFTER UPDATE OF estado ON public.app_encargos
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.prorroga_sin_efecto_al_cerrar();

-- El encargo cuenta los días autorizados.
CREATE OR REPLACE FUNCTION public.encargo_retirar_hasta(e app_encargos)
 RETURNS date LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN e.estado = 'listo' AND e.listo_at IS NOT NULL THEN
    ((e.listo_at AT TIME ZONE 'America/El_Salvador')::date
      + CASE WHEN public.reservas_v2_rige(e.listo_at) THEN 90 + coalesce(e.prorroga_dias, 0)
             ELSE 7 + CASE WHEN e.prorrogado_at IS NOT NULL THEN 7 ELSE 0 END END) END;
$function$;

-- La guarda de plazos conserva los días de prórroga cuando el pago baja.
SELECT pg_temp.parchar('public.app_reservas_guardas()'::regprocedure,
  $x$                        + make_interval(days => v_dias);$x$,
  $x$                        + make_interval(days => v_dias + coalesce(NEW.prorroga_dias, 0));$x$);

-- Mientras hay una prórroga pendiente, el plazo no vence.
SELECT pg_temp.parchar('public.reservas_vencer()'::regprocedure,
  $x$OR (r.estado = 'lista' AND (r.vence_at AT TIME ZONE 'America/El_Salvador')::date < v_hoy))$x$,
  $x$OR (r.estado = 'lista' AND (r.vence_at AT TIME ZONE 'America/El_Salvador')::date < v_hoy
                AND NOT public.prorroga_pendiente('reserva', r.id)))$x$, 2);
SELECT pg_temp.parchar('public.reservas_vigilar()'::regprocedure,
  $x$       AND public.encargo_retirar_hasta(e) < v_hoy$x$,
  $x$       AND public.encargo_retirar_hasta(e) < v_hoy AND NOT public.prorroga_pendiente('encargo', e.id)$x$);

-- Las listas traen la última solicitud.
SELECT pg_temp.parchar('public.reservas_de_sucursal(bigint,boolean)'::regprocedure,
  $x$'prorrogada_at', r.prorrogada_at,$x$,
  $x$'prorrogada_at', r.prorrogada_at, 'prorroga', public.prorroga_de('reserva', r.id),$x$);
SELECT pg_temp.parchar('public.encargos_de_sucursal(bigint,boolean)'::regprocedure,
  $x$'prorrogado_at', e.prorrogado_at,$x$,
  $x$'prorrogado_at', e.prorrogado_at, 'prorroga', public.prorroga_de('encargo', e.id),$x$);

-- ─── 3 · Canje: mínimo a pagar US$0.05 desde el reglamento v2 ──────────────
CREATE OR REPLACE FUNCTION public.puntos_minimo_a_pagar(p_dia date)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN p_dia >= public.reglas_v2_desde() THEN 0.05 ELSE 0.01 END;
$function$;
REVOKE EXECUTE ON FUNCTION public.puntos_minimo_a_pagar(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_minimo_a_pagar(date) TO authenticated, service_role;

SELECT pg_temp.parchar('public.puntos_barrer_canjes(date,date,boolean,integer)'::regprocedure,
  $x$    IF coalesce(v_total, 0) <= 0 THEN$x$,
  $x$    IF coalesce(v_total, 0) < public.puntos_minimo_a_pagar((SELECT fecha FROM public.sales_invoices WHERE id = r.id)) THEN$x$);
SELECT pg_temp.parchar('public.puntos_barrer_canjes(date,date,boolean,integer)'::regprocedure,
  $x$'documento', v_doc, 'puntos'$x$,
  $x$'documento', v_doc, 'total', coalesce(v_total, 0), 'puntos'$x$);
SELECT pg_temp.parchar('public.puntos_panel_avisos()'::regprocedure,
  $x$WHERE s.tipo = 'canje' AND s.revertida_at IS NULL AND si.total <= 0$x$,
  $x$WHERE s.tipo = 'canje' AND s.revertida_at IS NULL AND si.total < public.puntos_minimo_a_pagar(si.fecha)$x$);
