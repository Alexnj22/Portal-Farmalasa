-- La reserva «en camino» de punta a punta (2026-10-22, decisiones del usuario).
--
-- La v2.1337.0 dejó apartar pidiendo el producto a otra sala, pero la reserva
-- y el traslado quedaban sueltos: la única liga era un texto en el motivo.
-- Esto los amarra y resuelve lo que puede pasar en el camino:
--
--   · LLEGA entero        → la reserva pasa a lista sola, con su plazo de sala
--                           (7 días), y se avisa a la sala para que avise al
--                           cliente.
--   · LA OTRA SALA NO LO MANDA o MANDA MENOS → la reserva NO se marca lista;
--                           se avisa a la sala con lo que pasó. La sala pide
--                           el resto a otra sala, o a Bodega, o lo resuelve
--                           con el cliente (`reserva_ajustar`).
--   · BODEGA (el resto)   → encargo amarrado a la reserva. Mismo precio: sigue
--                           solo. Otro precio: decide el cliente
--                           (`reserva_precio_de_bodega`). Bodega no lo
--                           consigue: se avisa y la sala resuelve con el
--                           cliente. Cuando llega, cuenta como llegada.
--   · EL CLIENTE DECIDE   → sólo lo que llegó, una alternativa (puede ser
--                           mixto: 2 del original y 2 de otro), o nada
--                           (cancelar: lo pagado queda a su favor, como hoy).
--
-- La regla que hace que todo cierre: `traslado_llegaron` cuenta lo que YA
-- llegó para esta reserva —de traslados y de Bodega— y la reserva pasa a lista
-- cuando llegó su cantidad. Así no importa por cuántos caminos vino.
--
-- Además:
--   · el plazo al marcar lista una reserva de SALA es `dias_apartado` (7 días),
--     no el de las reservas de la app (`puntos_horas_reserva`): con anticipo
--     parcial le daba las horas de la app;
--   · Bodega se entera sola cuando el producto nuevo de un encargo ya entró al
--     catálogo (cron por hora, por parecido del nombre);
--   · la sala se entera cuando Bodega responde un encargo (precio y fecha, o
--     que no se consigue);
--   · devolver un saldo a favor EN EFECTIVO: la sala lo pide con motivo,
--     administración lo autoriza, y la sala lo entrega con un vale de caja
--     (tipo DEVOLUCION) que queda amarrado a la reserva.
SET lock_timeout = '5s';

-- ── Columnas ────────────────────────────────────────────────────────────────
ALTER TABLE public.app_reservas
  ADD COLUMN IF NOT EXISTS traslado_request_id uuid,
  ADD COLUMN IF NOT EXISTS traslado_estado text,
  ADD COLUMN IF NOT EXISTS traslado_nota text,
  ADD COLUMN IF NOT EXISTS traslado_llegaron integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS traslado_por_llegar integer NOT NULL DEFAULT 0,
  -- Sin ON DELETE: una reserva de la que salió una alternativa o un sobrante
  -- ya no se puede borrar deshaciendo su cobro (`apartado_deshacer`), porque
  -- parte de ese dinero vive en la otra fila.
  ADD COLUMN IF NOT EXISTS ajuste_de bigint REFERENCES public.app_reservas(id),
  ADD COLUMN IF NOT EXISTS devolucion_pedida_at timestamptz,
  ADD COLUMN IF NOT EXISTS devolucion_pedida_por uuid,
  ADD COLUMN IF NOT EXISTS devolucion_pedida_motivo text,
  ADD COLUMN IF NOT EXISTS devolucion_movimiento bigint REFERENCES public.caja_movimientos_portal(id),
  ADD COLUMN IF NOT EXISTS devolucion_entregada_at timestamptz;

ALTER TABLE public.app_reservas DROP CONSTRAINT IF EXISTS app_reservas_traslado_estado_check;
ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_traslado_estado_check CHECK (traslado_estado IS NULL OR traslado_estado IN
  ('pedido', 'enviado', 'parcial', 'rechazado', 'recibido', 'bodega', 'precio', 'sin_existencia'));
ALTER TABLE public.app_reservas DROP CONSTRAINT IF EXISTS app_reservas_traslado_nota_check;
ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_traslado_nota_check CHECK (traslado_nota IS NULL OR length(traslado_nota) <= 300);
ALTER TABLE public.app_reservas DROP CONSTRAINT IF EXISTS app_reservas_devolucion_motivo_check;
ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_devolucion_motivo_check CHECK (devolucion_pedida_motivo IS NULL OR length(devolucion_pedida_motivo) BETWEEN 3 AND 300);

CREATE INDEX IF NOT EXISTS app_reservas_traslado_request ON public.app_reservas (traslado_request_id) WHERE traslado_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_reservas_ajuste_de ON public.app_reservas (ajuste_de) WHERE ajuste_de IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_reservas_devolucion_movimiento ON public.app_reservas (devolucion_movimiento) WHERE devolucion_movimiento IS NOT NULL;

ALTER TABLE public.app_encargos
  ADD COLUMN IF NOT EXISTS reserva_id bigint REFERENCES public.app_reservas(id),
  -- Sin FK a `products` a propósito: es tabla caliente (sync cada minuto) y
  -- una FK nueva le toma un candado. Es una SUGERENCIA, no un dato.
  ADD COLUMN IF NOT EXISTS sugerido_product_id integer,
  ADD COLUMN IF NOT EXISTS sugerido_at timestamptz;
CREATE INDEX IF NOT EXISTS app_encargos_reserva ON public.app_encargos (reserva_id) WHERE reserva_id IS NOT NULL;

-- ── 1. El plazo de una reserva de sala ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserva_horas_al_preparar(r app_reservas)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN r.pago_estado = 'pagado' THEN (SELECT p.dias_pagada * 24 FROM public.reserva_plazos() p)
              -- Apartado en sala (2026-10-22): sus 7 días, no las horas de la app.
              WHEN r.origen = 'sucursal' THEN (SELECT p.dias_apartado * 24 FROM public.reserva_plazos() p)
              ELSE public.puntos_horas_reserva(r.customer_id) END;
$function$;

-- ── Avisar a la sala de una reserva ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserva_avisar_sala(p_id bigint, p_titulo text, p_cuerpo text, p_clave text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_branch bigint; v_dest uuid[]; v_codigo text := 'R-' || lpad(p_id::text, 6, '0');
BEGIN
  SELECT branch_id INTO v_branch FROM public.app_reservas WHERE id = p_id;
  v_dest := public.destinatarios_de_reservas(v_branch);
  IF v_dest IS NULL THEN RETURN; END IF;
  PERFORM public.notify_employees(v_dest, 'RESERVA_APP', p_titulo || ' · ' || v_codigo, p_cuerpo, '/reservas',
    jsonb_build_object('codigo', v_codigo, 'check_key', p_clave || ':' || p_id), true, v_branch::integer);
END $function$;

-- ── Lo que llegó para una reserva ───────────────────────────────────────────
-- Suma unidades llegadas (de un traslado o de Bodega). Con su cantidad
-- completa pasa a lista sola, con el plazo de sala.
CREATE OR REPLACE FUNCTION public.reserva_sumar_llegada(p_id bigint, p_unidades integer, p_de text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_cliente text;
BEGIN
  IF coalesce(p_unidades, 0) <= 0 THEN RETURN; END IF;
  UPDATE public.app_reservas
     SET traslado_llegaron = traslado_llegaron + p_unidades,
         traslado_por_llegar = greatest(traslado_por_llegar - p_unidades, 0), updated_at = now()
   WHERE id = p_id AND estado = 'pendiente'
  RETURNING * INTO r;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = r.customer_id;
  IF r.traslado_llegaron >= r.cantidad THEN
    UPDATE public.app_reservas
       SET estado = 'lista', lista_at = now(), vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(r)),
           traslado_estado = 'recibido', traslado_nota = 'Llegó de ' || coalesce(p_de, 'otra sala') || '.', updated_at = now()
     WHERE id = p_id;
    PERFORM public.reserva_avisar_sala(p_id, 'Llegó y quedó apartada',
      format('%s × %s para %s llegó de %s. Ya está lista: avísale al cliente.', r.cantidad, r.producto_nombre,
             coalesce(v_cliente, 'el cliente'), coalesce(p_de, 'otra sala')), 'reserva_llego');
  ELSE
    UPDATE public.app_reservas
       SET traslado_nota = format('Llegaron %s de %s.', r.traslado_llegaron, r.cantidad), updated_at = now()
     WHERE id = p_id;
    PERFORM public.reserva_avisar_sala(p_id, 'Llegó una parte',
      format('De %s × %s para %s llegaron %s. Pide el resto a otra sala o a Bodega, o habla con el cliente.',
             r.cantidad, r.producto_nombre, coalesce(v_cliente, 'el cliente'), r.traslado_llegaron), 'reserva_parte');
  END IF;
END $function$;

-- ── El traslado de una reserva ──────────────────────────────────────────────
-- Cuánto sale del renglón 0 de una solicitud: entero, salvo que el despacho
-- parcial diga otra cosa (`erp_traslado.parcial`, el mismo que lee
-- `notificar_resolucion_traslado`).
CREATE OR REPLACE FUNCTION public.traslado_enviada_del_renglon(p_meta jsonb, p_i integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN p_meta->'erp_traslado'->'parcial' IS NULL THEN coalesce((p_meta->'items'->p_i->>'cantidad')::numeric, 0)
    ELSE coalesce((
      SELECT CASE WHEN x->>'enviada' ~ '^[0-9]+(\.[0-9]+)?$' THEN (x->>'enviada')::numeric ELSE 0 END
        FROM (SELECT jsonb_array_elements(coalesce(p_meta->'erp_traslado'->'parcial'->'ajustados', '[]'::jsonb)) x
              UNION ALL
              SELECT jsonb_array_elements(coalesce(p_meta->'erp_traslado'->'parcial'->'fuera', '[]'::jsonb))) t
       WHERE x->>'i' = p_i::text LIMIT 1),
      (p_meta->'items'->p_i->>'cantidad')::numeric, 0) END;
$function$;

CREATE OR REPLACE FUNCTION public.reserva_seguir_traslado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  m jsonb := coalesce(NEW.metadata, '{}'::jsonb);
  it jsonb := m->'items'->0;
  v_id bigint;
  r public.app_reservas;
  v_origen text := coalesce(nullif(m->>'origen_branch_name', ''), 'la otra sala');
  v_pedida numeric; v_enviada numeric; v_unid integer; v_motivo text;
BEGIN
  v_id := CASE WHEN m->>'reserva_id' ~ '^[0-9]{1,12}$' THEN (m->>'reserva_id')::bigint END;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  -- Un fallo acá nunca puede trabar el traslado: es su consecuencia, no su condición.
  BEGIN
    SELECT * INTO r FROM public.app_reservas WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR r.origen <> 'sucursal' OR r.branch_id::text IS DISTINCT FROM (m->>'branch_id')
       OR (it->>'erp_product_id') IS DISTINCT FROM r.producto_id::text THEN
      RETURN NULL;
    END IF;
    -- Unidades de la reserva (su presentación) que trae N del renglón.
    v_pedida := coalesce((it->>'cantidad')::numeric, 0);

    IF TG_OP = 'INSERT' THEN
      IF r.estado = 'pendiente' THEN
        UPDATE public.app_reservas
           SET traslado_request_id = NEW.id, traslado_estado = 'pedido',
               traslado_desde = coalesce(nullif(m->>'origen_branch_id', '')::bigint, traslado_desde),
               traslado_nota = left(format('Pedida a %s.', v_origen), 300), updated_at = now()
         WHERE id = v_id;
      END IF;
      RETURN NULL;
    END IF;

    -- Llegó: cuenta aunque ya no sea el traslado vigente — lo que llega, llegó.
    IF (NEW.metadata ? 'erp_recibido') AND NOT (coalesce(OLD.metadata, '{}'::jsonb) ? 'erp_recibido') AND NEW.status = 'APPROVED' THEN
      v_enviada := public.traslado_enviada_del_renglon(m, 0);
      v_unid := floor(v_enviada * greatest(coalesce((it->>'factor')::numeric, 1), 1) / greatest(r.factor, 1));
      PERFORM public.reserva_sumar_llegada(v_id, v_unid, v_origen);
      RETURN NULL;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.id = r.traslado_request_id AND r.estado = 'pendiente' THEN
      IF NEW.status = 'APPROVED' THEN
        v_enviada := public.traslado_enviada_del_renglon(m, 0);
        v_unid := floor(v_enviada * greatest(coalesce((it->>'factor')::numeric, 1), 1) / greatest(r.factor, 1));
        IF v_enviada <= 0 THEN
          UPDATE public.app_reservas SET traslado_estado = 'rechazado',
                 traslado_nota = left(format('%s no tenía para mandar.', v_origen), 300), updated_at = now() WHERE id = v_id;
          PERFORM public.reserva_avisar_sala(v_id, 'El traslado no sale',
            format('%s no tenía %s para mandar. Pídelo a otra sala o a Bodega, o habla con el cliente.', v_origen, r.producto_nombre), 'reserva_sin_traslado');
        ELSIF v_enviada < v_pedida THEN
          UPDATE public.app_reservas SET traslado_estado = 'parcial', traslado_por_llegar = traslado_por_llegar + v_unid,
                 traslado_nota = left(format('%s manda %s de %s.', v_origen, v_enviada, v_pedida), 300), updated_at = now() WHERE id = v_id;
          PERFORM public.reserva_avisar_sala(v_id, 'Viene sólo una parte',
            format('%s manda %s de %s × %s. Pide el resto a otra sala o a Bodega, o habla con el cliente.', v_origen, v_enviada, v_pedida, r.producto_nombre),
            'reserva_parcial');
        ELSE
          UPDATE public.app_reservas SET traslado_estado = 'enviado', traslado_por_llegar = traslado_por_llegar + v_unid,
                 traslado_nota = left(format('%s lo mandó.', v_origen), 300), updated_at = now() WHERE id = v_id;
        END IF;
      ELSIF NEW.status IN ('REJECTED', 'CANCELLED') THEN
        v_motivo := nullif(btrim(coalesce(m->>'rejection_reason', NEW.approver_note, '')), '');
        UPDATE public.app_reservas SET traslado_estado = 'rechazado',
               traslado_nota = left(format('%s no lo manda%s.', v_origen, coalesce(': ' || lower(v_motivo), '')), 300), updated_at = now()
         WHERE id = v_id;
        PERFORM public.reserva_avisar_sala(v_id, 'El traslado no sale',
          format('%s no manda %s%s. Pídelo a otra sala o a Bodega, o habla con el cliente.', v_origen, r.producto_nombre,
                 coalesce(' (' || lower(v_motivo) || ')', '')), 'reserva_sin_traslado');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'reserva_seguir_traslado: solicitud % reserva % (%)', NEW.id, v_id, SQLERRM;
  END;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS reserva_seguir_traslado ON public.approval_requests;
CREATE TRIGGER reserva_seguir_traslado
  AFTER INSERT OR UPDATE OF status, metadata ON public.approval_requests
  FOR EACH ROW WHEN (NEW.type = 'INVENTORY_TRANSFER_REQUEST' AND NEW.metadata ? 'reserva_id')
  EXECUTE FUNCTION public.reserva_seguir_traslado();

-- ── El resto, a Bodega ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserva_encargar_a_bodega(p_id bigint, p_nota text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_falta integer; v_enc bigint;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF r.origen <> 'sucursal' OR r.estado <> 'pendiente' THEN RAISE EXCEPTION 'Sólo una reserva de sala que espera producto se encarga a Bodega.'; END IF;
  IF EXISTS (SELECT 1 FROM public.app_encargos e WHERE e.reserva_id = p_id AND e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')) THEN
    RAISE EXCEPTION 'Ya hay un encargo a Bodega para esta reserva.';
  END IF;
  v_falta := r.cantidad - r.traslado_llegaron - r.traslado_por_llegar;
  IF v_falta <= 0 THEN RAISE EXCEPTION 'Ya viene todo lo de esta reserva.'; END IF;
  IF v_falta > 20 THEN RAISE EXCEPTION 'Bodega encarga hasta 20 por pedido y faltan %.', v_falta; END IF;
  INSERT INTO public.app_encargos (customer_id, branch_id, product_id, producto_nombre, factor, cantidad, nota_cliente, estado, pago_estado, reserva_id)
  VALUES (r.customer_id, r.branch_id, r.producto_id, r.producto_nombre, r.factor, v_falta,
          left(coalesce(nullif(btrim(p_nota), '') || ' · ', '') || 'Para la reserva R-' || lpad(p_id::text, 6, '0')
               || format(' (reservado a $%s c/u)', to_char(r.precio_unitario, 'FM999990.00')), 300),
          'solicitado', 'pendiente', p_id)
  RETURNING id INTO v_enc;
  UPDATE public.app_reservas SET traslado_estado = 'bodega',
         traslado_nota = format('Encargado a Bodega: %s (E-%s).', v_falta, lpad(v_enc::text, 6, '0')), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'RESERVA_A_BODEGA', p_id::text, jsonb_build_object('encargo', v_enc, 'cantidad', v_falta), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'encargo', v_enc, 'codigo', 'E-' || lpad(v_enc::text, 6, '0'), 'cantidad', v_falta);
END $function$;

-- ── El encargo sigue a su reserva, y la sala se entera de lo que responde Bodega ──
CREATE OR REPLACE FUNCTION public.app_encargos_seguir()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_dest uuid[]; v_cod text := 'E-' || lpad(NEW.id::text, 6, '0'); v_cliente text;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN RETURN NULL; END IF;
  BEGIN
    IF NEW.reserva_id IS NOT NULL THEN
      SELECT * INTO r FROM public.app_reservas WHERE id = NEW.reserva_id FOR UPDATE;
      IF NOT FOUND OR r.estado <> 'pendiente' THEN RETURN NULL; END IF;
      IF NEW.estado = 'confirmado' THEN
        IF round(NEW.precio_unitario, 2) = round(r.precio_unitario, 2) THEN
          -- Mismo precio: no hay nada que preguntarle al cliente.
          UPDATE public.app_encargos SET estado = 'aceptado', updated_at = now() WHERE id = NEW.id;
          UPDATE public.app_reservas SET traslado_estado = 'bodega',
                 traslado_nota = format('Bodega lo consigue para el %s (%s).', to_char(NEW.fecha_estimada, 'DD/MM'), v_cod), updated_at = now()
           WHERE id = r.id;
          PERFORM public.reserva_avisar_sala(r.id, 'Bodega lo consigue',
            format('%s × %s llega aprox. el %s, al mismo precio. Avísale al cliente.', NEW.cantidad, NEW.producto_nombre,
                   to_char(NEW.fecha_estimada, 'DD/MM')), 'reserva_bodega_si');
        ELSE
          UPDATE public.app_reservas SET traslado_estado = 'precio',
                 traslado_nota = left(format('Bodega lo consigue a $%s c/u (reservado a $%s), para el %s. Pregúntale al cliente.',
                   to_char(NEW.precio_unitario, 'FM999990.00'), to_char(r.precio_unitario, 'FM999990.00'), to_char(NEW.fecha_estimada, 'DD/MM')), 300),
                 updated_at = now()
           WHERE id = r.id;
          PERFORM public.reserva_avisar_sala(r.id, 'Bodega lo consigue a otro precio',
            format('%s × %s: $%s c/u en vez de $%s, para el %s. Pregúntale al cliente si lo acepta.', NEW.cantidad, NEW.producto_nombre,
                   to_char(NEW.precio_unitario, 'FM999990.00'), to_char(r.precio_unitario, 'FM999990.00'), to_char(NEW.fecha_estimada, 'DD/MM')),
            'reserva_bodega_precio');
        END IF;
      ELSIF NEW.estado = 'rechazado' THEN
        UPDATE public.app_reservas SET traslado_estado = 'sin_existencia',
               traslado_nota = left('Bodega no lo consigue: ' || coalesce(NEW.nota_sucursal, 'sin motivo') || '.', 300), updated_at = now()
         WHERE id = r.id;
        PERFORM public.reserva_avisar_sala(r.id, 'Bodega no lo consigue',
          format('%s × %s: %s. Habla con el cliente: lo que llegó, una alternativa, o cancelar (lo pagado queda a su favor).',
                 NEW.cantidad, NEW.producto_nombre, coalesce(lower(NEW.nota_sucursal), 'no se consigue')), 'reserva_bodega_no');
      ELSIF NEW.estado = 'listo' THEN
        -- Llegó a la sala: cuenta como llegada y el encargo se cierra (lo cobra la reserva).
        UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now() WHERE id = NEW.id;
        PERFORM public.reserva_sumar_llegada(r.id, floor(NEW.cantidad * greatest(NEW.factor, 1)::numeric / greatest(r.factor, 1))::integer, 'Bodega');
      END IF;
      RETURN NULL;
    END IF;

    -- Encargo suelto: la sala se entera de lo que respondió Bodega.
    IF NEW.estado IN ('confirmado', 'rechazado') AND OLD.estado = 'solicitado' THEN
      v_dest := public.destinatarios_de_reservas(NEW.branch_id);
      IF v_dest IS NULL THEN RETURN NULL; END IF;
      SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = NEW.customer_id;
      PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
        CASE NEW.estado WHEN 'confirmado' THEN 'Bodega confirmó el encargo · ' ELSE 'Bodega no consigue el encargo · ' END || v_cod,
        CASE NEW.estado
          WHEN 'confirmado' THEN format('%s × %s para %s: $%s c/u, llega aprox. el %s. Avísale al cliente; se cobra en «Por cobrar».',
                                        NEW.cantidad, NEW.producto_nombre, coalesce(v_cliente, 'el cliente'),
                                        to_char(NEW.precio_unitario, 'FM999990.00'), to_char(NEW.fecha_estimada, 'DD/MM'))
          ELSE format('%s × %s para %s: %s. Avísale al cliente.', NEW.cantidad, NEW.producto_nombre,
                      coalesce(v_cliente, 'el cliente'), coalesce(lower(NEW.nota_sucursal), 'no se puede conseguir'))
        END,
        '/', jsonb_build_object('encargo', NEW.id, 'check_key', 'encargo_resp:' || NEW.id), true, NEW.branch_id::integer);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_encargos_seguir: encargo % (%)', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS app_encargos_seguir ON public.app_encargos;
CREATE TRIGGER app_encargos_seguir AFTER UPDATE OF estado ON public.app_encargos
  FOR EACH ROW EXECUTE FUNCTION public.app_encargos_seguir();

-- La reserva se cerró (cancelada o vencida): lo que nadie pidió todavía a
-- Bodega se cancela; lo que Bodega ya pidió se le avisa, porque va a llegar
-- sin cliente.
CREATE OR REPLACE FUNCTION public.app_reservas_cerrar_encargo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE e record; v_dest uuid[];
BEGIN
  IF OLD.estado IS NOT DISTINCT FROM NEW.estado THEN RETURN NULL; END IF;
  UPDATE public.app_encargos SET estado = 'cancelado', cerrado_at = now(), updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || 'La reserva se cerró.', 300)
   WHERE reserva_id = NEW.id AND estado IN ('solicitado', 'confirmado');
  FOR e IN SELECT id, cantidad, producto_nombre FROM public.app_encargos WHERE reserva_id = NEW.id AND estado IN ('aceptado', 'pedido') LOOP
    SELECT array_agg(em.id) INTO v_dest FROM public.employees em
     WHERE em.status = 'ACTIVO' AND em.branch_id IN (SELECT id FROM public.branches WHERE type = 'BODEGA');
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'ENCARGO_APP', 'La reserva se cerró · E-' || lpad(e.id::text, 6, '0'),
        format('%s × %s era para la reserva R-%s, que se %s. Si todavía se puede, no lo pidan.', e.cantidad, e.producto_nombre,
               lpad(NEW.id::text, 6, '0'), CASE NEW.estado WHEN 'vencida' THEN 'venció' ELSE 'canceló' END),
        '/', jsonb_build_object('encargo', e.id, 'check_key', 'encargo_sin_reserva:' || e.id), true, NEW.branch_id::integer);
    END IF;
  END LOOP;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS app_reservas_cerrar_encargo ON public.app_reservas;
CREATE TRIGGER app_reservas_cerrar_encargo AFTER UPDATE OF estado ON public.app_reservas
  FOR EACH ROW WHEN (NEW.estado IN ('cancelada', 'vencida')) EXECUTE FUNCTION public.app_reservas_cerrar_encargo();
REVOKE EXECUTE ON FUNCTION public.app_reservas_cerrar_encargo() FROM PUBLIC, anon, authenticated;

-- El aviso de alta: el resto de una reserva no es «de la app».
CREATE OR REPLACE FUNCTION public.app_encargos_avisar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_dest uuid[]; v_cliente text;
BEGIN
  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO' AND (e.branch_id = NEW.branch_id OR e.branch_id IN (SELECT id FROM public.branches WHERE type = 'BODEGA'));
  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = NEW.customer_id;
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
      CASE WHEN NEW.producto_nuevo THEN 'Producto que no tenemos · E-'
           WHEN NEW.reserva_id IS NOT NULL THEN 'El resto de una reserva · E-'
           ELSE 'Encargo · E-' END || lpad(NEW.id::text, 6, '0'),
      CASE WHEN NEW.producto_nuevo
        THEN format('%s pide %s × %s, que no está en el catálogo%s. Consulten si se puede conseguir, el precio y para cuándo.',
                    coalesce(v_cliente, 'Un cliente'), NEW.cantidad, NEW.producto_nombre,
                    CASE WHEN NEW.srs IS NULL THEN ' ni en el SRS' ELSE '' END)
        WHEN NEW.reserva_id IS NOT NULL
        THEN format('%s tiene apartado %s × %s y no hay en las salas. Confirmen el precio y para cuándo; si es el mismo precio, sigue solo.',
                    coalesce(v_cliente, 'Un cliente'), NEW.cantidad, NEW.producto_nombre)
        ELSE format('%s pide %s × %s. Confirmen si se puede conseguir, el precio y para cuándo.', coalesce(v_cliente, 'Un cliente'), NEW.cantidad, NEW.producto_nombre)
      END,
      '/', jsonb_build_object('encargo', NEW.id, 'check_key', 'encargo_app:' || NEW.id), true, NEW.branch_id::integer);
  END IF;
  RETURN NULL;
END $function$;

-- ── El cliente decide el precio de Bodega ───────────────────────────────────
-- Acepta: el resto queda a ese precio. Si ya llegó una parte, la reserva se
-- parte en dos —lo que llegó al precio de antes, el resto al nuevo— porque una
-- fila tiene un solo precio. No acepta: el encargo se cancela y la sala
-- resuelve con el cliente (`reserva_ajustar` o cancelar).
CREATE OR REPLACE FUNCTION public.reserva_precio_de_bodega(p_id bigint, p_acepta boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; e public.app_encargos; k record; v_ya integer; v_nueva bigint; v_a1 numeric; v_t1 numeric; v_t2 numeric;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.app_encargos WHERE reserva_id = p_id AND estado = 'confirmado' FOR UPDATE;
  IF NOT FOUND OR r.estado <> 'pendiente' THEN RAISE EXCEPTION 'Esa reserva no espera una respuesta del cliente.'; END IF;
  IF NOT p_acepta THEN
    UPDATE public.app_encargos SET estado = 'cancelado', cerrado_at = now(), updated_at = now(),
           nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || 'El cliente no aceptó el precio.', 300) WHERE id = e.id;
    UPDATE public.app_reservas SET traslado_estado = 'sin_existencia',
           traslado_nota = format('El cliente no aceptó $%s.', to_char(e.precio_unitario, 'FM999990.00')), updated_at = now() WHERE id = p_id;
  ELSE
    v_ya := r.traslado_llegaron + r.traslado_por_llegar;
    IF v_ya <= 0 THEN
      UPDATE public.app_reservas SET precio_unitario = round(e.precio_unitario, 2), traslado_estado = 'bodega',
             traslado_nota = format('El cliente aceptó $%s c/u. Llega aprox. el %s.', to_char(e.precio_unitario, 'FM999990.00'), to_char(e.fecha_estimada, 'DD/MM')),
             pago_estado = CASE WHEN coalesce(anticipo, 0) >= round(e.precio_unitario * cantidad, 2) - 0.004 AND coalesce(anticipo, 0) > 0 THEN 'pagado'
                                WHEN coalesce(anticipo, 0) > 0 THEN 'anticipo' ELSE pago_estado END,
             updated_at = now()
       WHERE id = p_id;
    ELSE
      -- Partir: lo que ya viene se queda; el resto nace como reserva propia, amarrada.
      SELECT * INTO k FROM public.reserva_cuenta(p_id);
      v_t1 := round(r.precio_unitario * v_ya, 2);
      v_a1 := least(k.pagado, v_t1);
      v_t2 := round(e.precio_unitario * (r.cantidad - v_ya), 2);
      INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
          precio_unitario, precio_normal, estado, terminos_version, anticipo, pendiente_at, pago_estado, pago_metodo, pagado_at,
          ajuste_de, traslado_estado, traslado_nota, traslado_desde)
      VALUES (r.customer_id, r.branch_id, 'sucursal', r.producto_id, r.producto_nombre, r.cantidad - v_ya, r.factor,
          round(e.precio_unitario, 2), r.precio_normal, 'pendiente', r.terminos_version, round(least(k.pagado - v_a1, v_t2), 2), now(),
          CASE WHEN k.pagado - v_a1 >= v_t2 - 0.004 AND k.pagado - v_a1 > 0 THEN 'pagado' WHEN k.pagado - v_a1 > 0 THEN 'anticipo' ELSE 'pendiente' END,
          CASE WHEN k.pagado - v_a1 > 0 THEN r.pago_metodo ELSE 'al_retirar' END, CASE WHEN k.pagado - v_a1 > 0 THEN now() END,
          p_id, 'bodega', format('Resto de R-%s, a $%s c/u. Llega aprox. el %s.', lpad(p_id::text, 6, '0'),
                                 to_char(e.precio_unitario, 'FM999990.00'), to_char(e.fecha_estimada, 'DD/MM')), r.traslado_desde)
      RETURNING id INTO v_nueva;
      UPDATE public.app_reservas SET cantidad = v_ya, anticipo = v_a1,
             pago_estado = CASE WHEN v_a1 >= v_t1 - 0.004 AND v_a1 > 0 THEN 'pagado' WHEN v_a1 > 0 THEN 'anticipo' ELSE pago_estado END,
             traslado_estado = CASE WHEN traslado_por_llegar > 0 THEN 'parcial' ELSE traslado_estado END,
             traslado_nota = format('El resto va en R-%s.', lpad(v_nueva::text, 6, '0')), updated_at = now()
       WHERE id = p_id;
      UPDATE public.app_encargos SET reserva_id = v_nueva WHERE id = e.id;
      -- Si lo que ya había llegado alcanza para lo que queda, está lista.
      IF r.traslado_llegaron >= v_ya THEN
        UPDATE public.app_reservas x SET estado = 'lista', lista_at = now(),
               vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(x)), traslado_estado = 'recibido', updated_at = now()
         WHERE x.id = p_id AND x.estado = 'pendiente';
      END IF;
    END IF;
    -- `aceptado` con la reserva ya amarrada: el aviso de «mismo precio» no corre (estado ya no es 'confirmado' → 'confirmado').
    UPDATE public.app_encargos SET estado = 'aceptado', updated_at = now() WHERE id = e.id;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), CASE WHEN p_acepta THEN 'RESERVA_PRECIO_ACEPTADO' ELSE 'RESERVA_PRECIO_RECHAZADO' END, p_id::text,
          jsonb_build_object('encargo', e.id, 'precio', e.precio_unitario, 'antes', r.precio_unitario, 'nueva', v_nueva), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'nueva', v_nueva, 'codigo_nueva', CASE WHEN v_nueva IS NOT NULL THEN 'R-' || lpad(v_nueva::text, 6, '0') END);
END $function$;

-- ── El cliente decide: lo que llegó, una alternativa (puede ser mixto), o nada ──
-- `p_cantidad` es cuánto se queda del producto original (0 = nada).
-- `p_alternativa` = {producto_id, producto_nombre, factor, cantidad, precio}:
-- se valida igual que un apartado nuevo (precio del catálogo, existencia EN
-- ESTA SALA, no insumo) y nace lista.
-- El dinero: lo pagado cubre primero lo que se queda, después la alternativa;
-- lo que sobre queda a su favor (60 días, se usa en cualquier sala).
CREATE OR REPLACE FUNCTION public.reserva_ajustar(p_id bigint, p_cantidad integer, p_alternativa jsonb DEFAULT NULL, p_motivo text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas; k record; x public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_t1 numeric; v_a1 numeric; v_resto numeric; v_cot json; v_t2 numeric := 0; v_a2 numeric := 0; v_sobra numeric;
  v_alt bigint; v_sobrante bigint;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF r.origen <> 'sucursal' OR r.estado NOT IN ('pendiente', 'lista') THEN RAISE EXCEPTION 'Sólo se ajusta una reserva de sala abierta.'; END IF;
  IF r.pago_metodo = 'en_linea' OR coalesce(r.pago_prueba, false) THEN RAISE EXCEPTION 'Esta reserva se pagó en línea: no se ajusta acá.'; END IF;
  IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
    RAISE EXCEPTION 'El anticipo de esta reserva ya se aplicó a una factura.';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe qué decidió el cliente.'; END IF;
  IF p_cantidad IS NULL OR p_cantidad < 0 OR p_cantidad > r.cantidad THEN RAISE EXCEPTION 'Del producto original se queda de 0 a %.', r.cantidad; END IF;
  IF p_cantidad = r.cantidad AND p_alternativa IS NULL THEN RAISE EXCEPTION 'Así no cambia nada.'; END IF;
  IF p_cantidad = 0 AND p_alternativa IS NULL THEN RAISE EXCEPTION 'Si no se lleva nada, cancela la reserva: lo pagado queda a su favor.'; END IF;
  IF EXISTS (SELECT 1 FROM public.app_encargos e WHERE e.reserva_id = p_id AND e.estado IN ('aceptado', 'pedido', 'listo')) THEN
    RAISE EXCEPTION 'Bodega ya pidió el resto de esta reserva: espera que llegue o habla con Bodega.';
  END IF;

  SELECT * INTO k FROM public.reserva_cuenta(p_id);
  v_t1 := round(coalesce(r.precio_unitario, 0) * p_cantidad, 2);
  v_a1 := least(k.pagado, v_t1);
  v_resto := round(k.pagado - v_a1, 2);

  IF p_alternativa IS NOT NULL THEN
    IF (p_alternativa->>'producto_id')::bigint = r.producto_id THEN RAISE EXCEPTION 'La alternativa tiene que ser otro producto.'; END IF;
    v_cot := public.apartado_cotizar(r.branch_id, jsonb_build_object('modo', 'nueva', 'customer_id', r.customer_id,
      'producto_id', p_alternativa->'producto_id', 'producto_nombre', p_alternativa->>'producto_nombre',
      'factor', p_alternativa->'factor', 'cantidad', p_alternativa->'cantidad', 'precio', p_alternativa->'precio'));
    v_t2 := (v_cot->>'total')::numeric;
    v_a2 := least(v_resto, v_t2);
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, preparada_por,
        pago_estado, pago_metodo, pagado_at, ajuste_de)
    VALUES (r.customer_id, r.branch_id, 'sucursal', (p_alternativa->>'producto_id')::bigint, left(btrim(p_alternativa->>'producto_nombre'), 200),
        (p_alternativa->>'cantidad')::integer, greatest(coalesce((p_alternativa->>'factor')::integer, 1), 1),
        round((p_alternativa->>'precio')::numeric, 2), round((p_alternativa->>'precio')::numeric, 2), 'lista', r.terminos_version, v_a2, now(), v_emp,
        CASE WHEN v_a2 > 0 AND v_a2 >= v_t2 - 0.004 THEN 'pagado' WHEN v_a2 > 0 THEN 'anticipo' ELSE 'pendiente' END,
        CASE WHEN v_a2 > 0 THEN r.pago_metodo ELSE 'al_retirar' END, CASE WHEN v_a2 > 0 THEN now() END, p_id)
    RETURNING * INTO x;
    v_alt := x.id;
    UPDATE public.app_reservas SET vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(x)) WHERE id = v_alt;
  END IF;
  v_sobra := round(v_resto - v_a2, 2);

  -- Lo que quedó del encargo a Bodega sin pedir ya no hace falta.
  UPDATE public.app_encargos SET estado = 'cancelado', cerrado_at = now(), updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || 'El cliente decidió otra cosa.', 300)
   WHERE reserva_id = p_id AND estado IN ('solicitado', 'confirmado');

  IF p_cantidad = 0 THEN
    -- Cerrada: lo que sobre queda a su favor en ESTA fila (ya no se mueve más).
    UPDATE public.app_reservas
       SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           -- Lo que pasó a la alternativa ya no es de esta fila; lo que sobra sí.
           anticipo = v_sobra, pago_estado = CASE WHEN v_sobra > 0 THEN 'anticipo' ELSE 'pendiente' END,
           traslado_nota = left(format('El cliente cambió todo%s.', CASE WHEN v_alt IS NOT NULL THEN ' por R-' || lpad(v_alt::text, 6, '0') ELSE '' END), 300),
           saldo_favor = CASE WHEN v_sobra > 0 THEN v_sobra END,
           saldo_favor_vence = CASE WHEN v_sobra > 0 THEN v_hoy + public.saldo_favor_dias() END,
           saldo_favor_origen = CASE WHEN v_sobra > 0 THEN 'anticipo' END
     WHERE id = p_id;
  ELSE
    UPDATE public.app_reservas
       SET cantidad = p_cantidad, anticipo = v_a1,
           pago_estado = CASE WHEN v_a1 > 0 AND v_a1 >= v_t1 - 0.004 THEN 'pagado' WHEN v_a1 > 0 THEN 'anticipo' ELSE 'pendiente' END,
           traslado_nota = left(format('El cliente se queda con %s de %s%s.', p_cantidad, r.cantidad,
             CASE WHEN v_alt IS NOT NULL THEN ' y lleva R-' || lpad(v_alt::text, 6, '0') ELSE '' END), 300),
           updated_at = now()
     WHERE id = p_id
    RETURNING * INTO x;
    -- Lo que ya llegó alcanza: lista.
    IF x.estado = 'pendiente' AND x.traslado_llegaron >= x.cantidad THEN
      UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), preparada_por = v_emp, traslado_estado = 'recibido',
             vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(x)), updated_at = now()
       WHERE id = p_id;
    END IF;
    IF v_sobra > 0 THEN
      -- La fila sigue abierta: el sobrante va en una fila propia, cerrada, para
      -- que usarlo o devolverlo funcione igual que cualquier saldo a favor.
      INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
          precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
          cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen, ajuste_de)
      VALUES (r.customer_id, r.branch_id, 'sucursal', r.producto_id, left('Sobrante de R-' || lpad(p_id::text, 6, '0') || ' · ' || r.producto_nombre, 200),
          1, r.factor, 0, 0, 'cancelada', r.terminos_version, v_sobra, 'anticipo', r.pago_metodo, now(),
          now(), v_emp, v_sobra, v_hoy + public.saldo_favor_dias(), 'anticipo', p_id)
      RETURNING id INTO v_sobrante;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'RESERVA_AJUSTADA', p_id::text,
          jsonb_build_object('antes', r.cantidad, 'queda', p_cantidad, 'alternativa', p_alternativa, 'nueva', v_alt,
                             'pagado', k.pagado, 'queda_pagado', v_a1, 'pasa_a_alternativa', v_a2, 'a_favor', v_sobra, 'motivo', v_motivo),
          r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'alternativa', CASE WHEN v_alt IS NOT NULL THEN 'R-' || lpad(v_alt::text, 6, '0') END,
                           'a_favor', v_sobra, 'cancelada', p_cantidad = 0);
END $function$;

-- ── Devolver un saldo a favor en efectivo: pedir → autorizar → entregar ─────
CREATE OR REPLACE FUNCTION public.reserva_saldo_pedir_devolucion(p_id bigint, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), ''); v_dest uuid[]; v_cliente text; v_sala text;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe por qué el cliente lo quiere en efectivo.'; END IF;
  IF coalesce(r.saldo_favor, 0) <= 0 OR r.saldo_favor_usado_at IS NOT NULL OR r.saldo_favor_devuelto_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esa reserva no tiene saldo a favor por devolver.';
  END IF;
  IF r.devolucion_pedida_at IS NOT NULL THEN RAISE EXCEPTION 'La devolución ya está pedida: la autoriza administración.'; END IF;
  UPDATE public.app_reservas SET devolucion_pedida_at = now(), devolucion_pedida_por = public.auth_employee_id(),
         devolucion_pedida_motivo = left(v_motivo, 300), updated_at = now() WHERE id = p_id;
  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = r.customer_id;
  SELECT name INTO v_sala FROM public.branches WHERE id = r.branch_id;
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
    JOIN public.role_permissions rp ON rp.role_id IN (e.role_id, e.secondary_role_id)
     AND rp.module_key = 'dash_reservas_devolver_saldo' AND (rp.can_view OR rp.can_edit)
   WHERE e.status = 'ACTIVO';
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Devolución en efectivo por autorizar · R-' || lpad(p_id::text, 6, '0'),
      format('%s pide devolver $%s a %s: %s', coalesce(v_sala, 'Una sala'), to_char(r.saldo_favor, 'FM999990.00'),
             coalesce(v_cliente, 'un cliente'), left(v_motivo, 160)),
      '/reservas', jsonb_build_object('codigo', 'R-' || lpad(p_id::text, 6, '0'), 'check_key', 'devolucion_pedida:' || p_id), true, r.branch_id::integer);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'SALDO_DEVOLUCION_PEDIDA', p_id::text, jsonb_build_object('monto', r.saldo_favor, 'motivo', v_motivo), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true);
END $function$;

-- Administración no la autoriza: vuelve a ser un saldo a favor normal.
CREATE OR REPLACE FUNCTION public.reserva_saldo_negar_devolucion(p_id bigint, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  IF NOT public.auth_has_module_permission('dash_reservas_devolver_saldo', 'can_view') THEN
    RAISE EXCEPTION 'Sólo administración decide una devolución en dinero.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe el motivo: es lo que se le dice al cliente.'; END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.devolucion_pedida_at IS NULL OR r.saldo_favor_devuelto_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esa devolución no está pedida.';
  END IF;
  UPDATE public.app_reservas SET devolucion_pedida_at = NULL, devolucion_pedida_por = NULL, devolucion_pedida_motivo = NULL, updated_at = now()
   WHERE id = p_id;
  PERFORM public.reserva_avisar_sala(p_id, 'Devolución en efectivo no autorizada',
    format('El saldo de $%s sigue a favor del cliente: %s', to_char(r.saldo_favor, 'FM999990.00'), left(v_motivo, 160)), 'devolucion_negada');
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'SALDO_DEVOLUCION_NEGADA', p_id::text, jsonb_build_object('motivo', v_motivo), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true);
END $function$;

-- La autorización de siempre; si la sala la había pedido, ahora le toca entregarla con un vale.
CREATE OR REPLACE FUNCTION public.reserva_saldo_devolver(p_id bigint, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  IF NOT public.auth_has_module_permission('dash_reservas_devolver_saldo', 'can_view') THEN
    RAISE EXCEPTION 'Sólo administración puede autorizar una devolución en dinero.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la devolución.'; END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa reserva'; END IF;
  IF coalesce(r.saldo_favor, 0) <= 0 THEN RAISE EXCEPTION 'Esa reserva no tiene saldo a favor'; END IF;
  IF r.saldo_favor_usado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se usó en una compra'; END IF;
  IF r.saldo_favor_devuelto_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se devolvió'; END IF;
  -- Se devuelve lo que queda (2026-10-21): lo ya usado se convirtió en puntos.
  UPDATE public.app_reservas
     SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor),
         saldo_favor_devuelto_at = now(), saldo_favor_devuelto_por = public.auth_employee_id(),
         saldo_favor_devuelto_monto = r.saldo_favor, saldo_favor_devuelto_motivo = left(v_motivo, 300), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, nota)
  VALUES (p_id, 'devolucion', r.saldo_favor, 0,
          coalesce(public.empleado_sala_de_hoy(NULL, (now() AT TIME ZONE 'America/El_Salvador')::date), public.auth_employee_branch_id()),
          public.auth_employee_id(), left(v_motivo, 300));
  IF r.devolucion_pedida_at IS NOT NULL THEN
    PERFORM public.reserva_avisar_sala(p_id, 'Devolución en efectivo autorizada',
      format('Entrega $%s al cliente desde Reservas («Entregar en efectivo»): sale como vale de caja.', to_char(r.saldo_favor, 'FM999990.00')),
      'devolucion_autorizada');
  END IF;
  RETURN json_build_object('ok', true, 'monto', r.saldo_favor, 'por_vale', r.devolucion_pedida_at IS NOT NULL);
END $function$;

-- La sala entregó el efectivo: el vale (salida DEVOLUCION de su caja) queda amarrado.
CREATE OR REPLACE FUNCTION public.reserva_devolucion_entregada(p_id bigint, p_movimiento bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; m public.caja_movimientos_portal%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF r.devolucion_pedida_at IS NULL OR r.saldo_favor_devuelto_at IS NULL THEN RAISE EXCEPTION 'Esa devolución no está autorizada.'; END IF;
  IF r.devolucion_movimiento IS NOT NULL THEN RAISE EXCEPTION 'Esa devolución ya se entregó.'; END IF;
  SELECT * INTO m FROM public.caja_movimientos_portal WHERE id = p_movimiento;
  IF NOT FOUND OR m.anulado_at IS NOT NULL OR m.tipo_codigo IS DISTINCT FROM 'DEVOLUCION'
     OR abs(m.monto - r.saldo_favor_devuelto_monto) > 0.004
     OR EXISTS (SELECT 1 FROM public.app_reservas o WHERE o.devolucion_movimiento = p_movimiento) THEN
    RAISE EXCEPTION 'Ese vale no corresponde a esta devolución.';
  END IF;
  UPDATE public.app_reservas SET devolucion_movimiento = p_movimiento, devolucion_entregada_at = now(), updated_at = now() WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'SALDO_DEVOLUCION_ENTREGADA', p_id::text, jsonb_build_object('movimiento', p_movimiento, 'monto', m.monto), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true);
END $function$;

-- ── Bodega se entera de que el producto nuevo ya está en el catálogo ─────────
CREATE OR REPLACE FUNCTION public.encargos_sugerir_producto()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE e record; v_n integer := 0; v_dest uuid[];
BEGIN
  FOR e IN
    SELECT x.id, x.branch_id, x.producto_nombre, s.id AS prod, s.nombre
      FROM public.app_encargos x
      JOIN LATERAL (
        SELECT p.id, p.nombre
          FROM public.products p
         WHERE p.created_at >= x.created_at - interval '1 day'
           AND public.similarity(p.nombre, x.producto_nombre) >= 0.35
         ORDER BY public.similarity(p.nombre, x.producto_nombre) DESC
         LIMIT 1) s ON true
     WHERE x.producto_nuevo AND x.product_id IS NULL AND x.sugerido_at IS NULL
       AND x.estado IN ('confirmado', 'aceptado', 'pedido')
  LOOP
    UPDATE public.app_encargos SET sugerido_product_id = e.prod, sugerido_at = now() WHERE id = e.id;
    SELECT array_agg(em.id) INTO v_dest FROM public.employees em
     WHERE em.status = 'ACTIVO' AND em.branch_id IN (SELECT id FROM public.branches WHERE type = 'BODEGA');
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'ENCARGO_APP', 'Ya está en el catálogo · E-' || lpad(e.id::text, 6, '0'),
        format('Parece que «%s» ya entró como «%s». Vincúlalo al encargo para poder marcarlo cuando llegue.', e.producto_nombre, e.nombre),
        '/', jsonb_build_object('encargo', e.id, 'check_key', 'encargo_sugerido:' || e.id), true, e.branch_id::integer);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

-- ── El resto de una reserva no se cobra en «Por cobrar» ─────────────────────
CREATE OR REPLACE FUNCTION public.apartado_cotizar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_modo text := p_apartado->>'modo';
  v_cant integer; v_factor integer; v_precio numeric; v_total numeric; v_disp numeric;
  v_desde bigint := nullif(p_apartado->>'traslado_desde', '')::bigint; v_desde_nombre text;
  r public.app_reservas; e public.app_encargos; v_cliente text; k record;
BEGIN
  IF v_modo = 'nueva' THEN
    v_cant := (p_apartado->>'cantidad')::integer;
    v_factor := greatest(coalesce((p_apartado->>'factor')::integer, 1), 1);
    v_precio := round((p_apartado->>'precio')::numeric, 2);
    SELECT name INTO v_cliente FROM public.customers WHERE id = (p_apartado->>'customer_id')::bigint;
    IF v_cliente IS NULL THEN RAISE EXCEPTION 'Elige el cliente del listado.'; END IF;
    IF v_cant IS NULL OR v_cant < 1 OR v_cant > 999 THEN RAISE EXCEPTION 'La cantidad va de 1 a 999.'; END IF;
    -- El precio queda fijo sólo si es el del catálogo para esa presentación.
    IF v_precio IS NULL OR NOT EXISTS (SELECT 1 FROM public.product_precios pp
        WHERE pp.product_id = (p_apartado->>'producto_id')::bigint AND pp.activo AND pp.factor = v_factor
          AND round(pp.vineta, 2) = v_precio) THEN
      RAISE EXCEPTION 'Ese precio no es el del catálogo para esa presentación.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.producto_insumo WHERE product_id = (p_apartado->>'producto_id')::bigint) THEN
      RAISE EXCEPTION 'Es un insumo: se encarga, no se aparta.';
    END IF;
    IF v_desde IS NOT NULL THEN
      -- Viene de otra sala: la existencia que manda es la de ESA sala.
      IF v_desde = p_branch_id THEN RAISE EXCEPTION 'El traslado tiene que venir de otra sala.'; END IF;
      SELECT name INTO v_desde_nombre FROM public.branches WHERE id = v_desde;
      IF v_desde_nombre IS NULL THEN RAISE EXCEPTION 'Esa sala no existe.'; END IF;
      SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
        FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
       WHERE (x->>'branch_id')::bigint = v_desde;
      IF v_disp < v_cant * v_factor THEN
        RAISE EXCEPTION 'En % hay % unidades y se piden %.', v_desde_nombre, v_disp, v_cant * v_factor;
      END IF;
    ELSE
      SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
        FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
       WHERE (x->>'branch_id')::bigint = p_branch_id;
      IF v_disp < v_cant * v_factor THEN
        RAISE EXCEPTION 'En esta sala hay % unidades y se piden %: se encarga, no se aparta.', v_disp, v_cant * v_factor;
      END IF;
    END IF;
    v_total := round(v_precio * v_cant, 2);
    RETURN json_build_object('tipo', 'reserva', 'total', v_total, 'minimo', round(v_total * 0.5, 2), 'maximo', v_total,
      'cliente', v_cliente, 'detalle', (p_apartado->>'producto_nombre'), 'traslado_desde', v_desde_nombre);

  ELSIF v_modo = 'reserva' THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = (p_apartado->>'reserva_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
    IF r.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa reserva es de otra sala.'; END IF;
    -- Una reserva de la app se paga en la app o al retirarla, nunca con un
    -- anticipo de caja: mezclar las dos formas es lo que cobraba dos veces.
    IF r.origen IS DISTINCT FROM 'sucursal' THEN RAISE EXCEPTION 'Esa reserva es de la app: se paga en la app o al retirarla.'; END IF;
    IF r.estado NOT IN ('pendiente', 'lista') THEN RAISE EXCEPTION 'Esa reserva ya no está abierta.'; END IF;
    -- Cuánto falta: lo dice `reserva_cuenta` (descuenta anticipo y pago en línea).
    SELECT * INTO k FROM public.reserva_cuenta(r.id);
    IF k.falta_pagar <= 0.004 THEN RAISE EXCEPTION 'Esa reserva ya está pagada.'; END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = r.customer_id;
    RETURN json_build_object('tipo', 'reserva', 'total', k.total, 'minimo', 0.01,
      'maximo', k.falta_pagar, 'cliente', v_cliente, 'detalle', r.producto_nombre,
      'codigo', 'R-' || lpad(r.id::text, 6, '0'));

  ELSIF v_modo = 'encargo' THEN
    SELECT * INTO e FROM public.app_encargos WHERE id = (p_apartado->>'encargo_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
    IF e.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Ese encargo es de otra sala.'; END IF;
    IF e.estado <> 'confirmado' THEN RAISE EXCEPTION 'Ese encargo todavía no tiene el precio confirmado.'; END IF;
    IF e.pago_estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese encargo ya está pagado.'; END IF;
    -- El resto de una reserva (2026-10-22) se paga con la reserva: cobrarlo acá sería cobrar dos veces.
    IF e.reserva_id IS NOT NULL THEN
      RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se cobra con la reserva.', lpad(e.reserva_id::text, 6, '0');
    END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = e.customer_id;
    -- El encargo se paga completo: lo que no tenemos se pide para esa persona.
    RETURN json_build_object('tipo', 'encargo', 'total', round(e.anticipo, 2), 'minimo', round(e.anticipo, 2),
      'maximo', round(e.anticipo, 2), 'cliente', v_cliente, 'detalle', e.producto_nombre,
      'codigo', 'E-' || lpad(e.id::text, 6, '0'));
  END IF;
  RAISE EXCEPTION 'No se sabe qué se está apartando.';
END $function$;

-- ── Lo que leen las pantallas ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reservas_de_sucursal(p_branch_id bigint, p_abiertas boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
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
      'id', r.id, 'estado', r.estado, 'origen', r.origen, 'pedido', r.pedido,
      'documento', r.documento, 'datos_fiscales', r.datos_fiscales,
      'branch_id', r.branch_id, 'sala', b.name,
      'cliente', c.name, 'telefono', c.phone,
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = r.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'producto_id', r.producto_id, 'producto', r.producto_nombre, 'cantidad', r.cantidad,
      'precio', r.precio_unitario, 'precio_normal', r.precio_normal,
      -- Mayoreo (2026-10-19): la lista con que se cobró al reservar, para facturar igual.
      'lista_precio', r.lista_precio,
      'oferta', r.oferta_titulo, 'oferta_fin', r.oferta_fin,
      'creada', r.created_at, 'lista_at', r.lista_at, 'vence_at', r.vence_at,
      'avisado_via', r.avisado_via, 'avisado_at', r.avisado_at, 'cerrada_at', r.cerrada_at,
      'pago_estado', r.pago_estado, 'pago_metodo', r.pago_metodo, 'pago_prueba', r.pago_prueba, 'entrega', r.entrega,
      'direccion_entrega', r.direccion_entrega, 'costo_envio', r.costo_envio, 'anticipo', r.anticipo,
      'saldo_favor', r.saldo_favor, 'saldo_favor_vence', r.saldo_favor_vence, 'saldo_favor_origen', r.saldo_favor_origen,
      'saldo_favor_usado_at', r.saldo_favor_usado_at, 'saldo_favor_devuelto_at', r.saldo_favor_devuelto_at,
      'vencida_motivo', r.vencida_motivo, 'pendiente_at', r.pendiente_at,
      'bajo_receta', r.bajo_receta, 'puede_revisar_receta', public.receta_app_puede_aprobar(r.branch_id),
      'receta_ruta', r.receta_ruta, 'receta_estado', r.receta_estado, 'receta_motivo', r.receta_motivo,
      'receta_subida_at', r.receta_subida_at, 'receta_fotos', r.receta_fotos,
      'receta_revisada_at', r.receta_revisada_at)::jsonb
      -- La preventa (2026-10-21): en qué quedó, su número en la caja y la factura.
      || jsonb_build_object(
      'preventa_id', pv.id, 'preventa_estado', pv.estado, 'preventa_ref', pv.externo_ref,
      'preventa_at', pv.enviada_at, 'preventa_por', pv.enviada_por, 'factura', si.correlativo,
      -- Los plazos los dice el servidor (2026-10-21): hasta cuándo vale el
      -- estado actual y, si está por prepararse, cuántas horas quedará lista.
      'plazo_hasta', public.reserva_plazo_hasta(r),
      'horas_al_preparar', CASE WHEN r.estado = 'pendiente' THEN public.reserva_horas_al_preparar(r) END)
      -- En camino (2026-10-22): de dónde viene, en qué va, y lo que pide decidir.
      || jsonb_build_object(
      'factor', r.factor, 'traslado_desde', r.traslado_desde, 'traslado_sala', bt.name,
      'traslado_estado', r.traslado_estado, 'traslado_nota', r.traslado_nota,
      'traslado_llegaron', r.traslado_llegaron, 'traslado_por_llegar', r.traslado_por_llegar,
      'ajuste_de', r.ajuste_de, 'saldo_favor_devuelto_monto', r.saldo_favor_devuelto_monto,
      'devolucion_pedida_at', r.devolucion_pedida_at, 'devolucion_pedida_motivo', r.devolucion_pedida_motivo,
      'devolucion_entregada_at', r.devolucion_entregada_at,
      'encargo', (SELECT jsonb_build_object('id', e.id, 'codigo', 'E-' || lpad(e.id::text, 6, '0'), 'estado', e.estado,
                                            'precio', e.precio_unitario, 'fecha', e.fecha_estimada, 'cantidad', e.cantidad)
                    FROM public.app_encargos e WHERE e.reserva_id = r.id ORDER BY e.id DESC LIMIT 1))
      ORDER BY (r.estado = 'en_revision') DESC, (r.estado = 'pendiente') DESC, (r.estado = 'lista') DESC, r.created_at DESC)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
      JOIN public.branches b ON b.id = r.branch_id
      LEFT JOIN public.branches bt ON bt.id = r.traslado_desde
      LEFT JOIN public.preventas pv ON pv.id = r.preventa_id
      LEFT JOIN public.sales_invoices si ON si.id = pv.sales_invoice_id
     WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertas THEN r.estado IN ('en_revision', 'pendiente', 'lista')
                   OR (coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL
                       AND r.saldo_favor_devuelto_at IS NULL AND r.saldo_favor_vence >= v_hoy)
                   -- Autorizada en efectivo y todavía sin entregar: la sala tiene que verla.
                   OR (r.devolucion_pedida_at IS NOT NULL AND r.saldo_favor_devuelto_at IS NOT NULL AND r.devolucion_movimiento IS NULL)
                 ELSE r.created_at > now() - interval '30 days' END)), '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.encargos_de_sucursal(p_branch_id bigint, p_abiertos boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_branch_id IS NOT NULL AND NOT (p_branch_id = public.auth_employee_branch_id()
       OR public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL AND NOT (public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', e.id, 'codigo', 'E-' || lpad(e.id::text, 6, '0'), 'estado', e.estado, 'pago_estado', e.pago_estado,
      'branch_id', e.branch_id, 'sala', b.name, 'cliente', c.name, 'telefono', c.phone,
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = e.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'product_id', e.product_id, 'producto', e.producto_nombre, 'cantidad', e.cantidad, 'nota_cliente', e.nota_cliente,
      'precio_unitario', e.precio_unitario, 'anticipo', e.anticipo, 'fecha_estimada', e.fecha_estimada, 'nota_sucursal', e.nota_sucursal,
      'devolutivo', p.devolutivo,
      'vendido_antes', e.product_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sales_invoice_items ii WHERE ii.erp_product_id = e.product_id LIMIT 1),
      'producto_nuevo', e.producto_nuevo, 'srs', e.srs, 'foto_url', e.foto_url,
      'producto_catalogo', p.nombre, 'vinculado_at', e.vinculado_at,
      -- El resto de una reserva (2026-10-22) se cobra con la reserva, nunca en «Por cobrar».
      'reserva_id', e.reserva_id, 'reserva', CASE WHEN e.reserva_id IS NOT NULL THEN 'R-' || lpad(e.reserva_id::text, 6, '0') END,
      'sugerido_product_id', e.sugerido_product_id, 'sugerido', ps.nombre,
      'creado', e.created_at)
      ORDER BY (e.estado = 'solicitado') DESC, (e.estado = 'aceptado') DESC, e.created_at DESC)
      FROM public.app_encargos e
      JOIN public.branches b ON b.id = e.branch_id
      JOIN public.customers c ON c.id = e.customer_id
      LEFT JOIN public.products p ON p.id = e.product_id
      LEFT JOIN public.products ps ON ps.id = e.sugerido_product_id AND e.product_id IS NULL
     WHERE (p_branch_id IS NULL OR e.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertos THEN e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                 ELSE e.created_at > now() - interval '30 days' END)), '[]'::json);
END $function$;

-- ── Permisos ────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.reserva_avisar_sala(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserva_sumar_llegada(bigint, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserva_seguir_traslado() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_encargos_seguir() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encargos_sugerir_producto() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.traslado_enviada_del_renglon(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_avisar_sala(bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserva_sumar_llegada(bigint, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.encargos_sugerir_producto() TO service_role;
GRANT EXECUTE ON FUNCTION public.traslado_enviada_del_renglon(jsonb, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.reserva_encargar_a_bodega(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reserva_precio_de_bodega(bigint, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reserva_ajustar(bigint, integer, jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reserva_saldo_pedir_devolucion(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reserva_saldo_negar_devolucion(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reserva_devolucion_entregada(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_encargar_a_bodega(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserva_precio_de_bodega(bigint, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserva_ajustar(bigint, integer, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserva_saldo_pedir_devolucion(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserva_saldo_negar_devolucion(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserva_devolucion_entregada(bigint, bigint) TO authenticated, service_role;

-- ── El cron de la sugerencia (sólo si no existe: un branch nuevo lo replica) ──
SELECT cron.schedule('encargos-sugerir-producto', '23 * * * *', 'SELECT public.encargos_sugerir_producto()')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encargos-sugerir-producto');
