-- Reserva de la app sin existencia en la sala (2026-10-22, decisión del usuario).
-- El plazo de 24 h para preparar se DETIENE mientras lo que falta viene en
-- camino (traslado pedido o enviado, o encargo a Bodega): la sala hizo su
-- parte y no debe vencer como «sin preparar». Si el traslado no sale, llega
-- una parte o Bodega da otro precio, la sala tiene otras 24 h desde ese
-- cambio para resolver. Además el traslado y el encargo a Bodega, que eran
-- sólo para reservas de sala, se amarran también a las de la app.
SET lock_timeout = '5s';

ALTER TABLE public.app_reservas ADD COLUMN IF NOT EXISTS traslado_cambio_at timestamptz;
COMMENT ON COLUMN public.app_reservas.traslado_cambio_at IS
  'Último cambio de traslado_estado / traslado_por_llegar: desde ahí corren las 24 h para resolver (reserva_plazo_hasta).';

CREATE OR REPLACE FUNCTION public.app_reservas_marcar_traslado_cambio()
 RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  IF NEW.traslado_estado IS DISTINCT FROM OLD.traslado_estado
     OR NEW.traslado_por_llegar IS DISTINCT FROM OLD.traslado_por_llegar THEN
    NEW.traslado_cambio_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.app_reservas_marcar_traslado_cambio() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS app_reservas_traslado_cambio ON public.app_reservas;
CREATE TRIGGER app_reservas_traslado_cambio BEFORE UPDATE OF traslado_estado, traslado_por_llegar ON public.app_reservas
  FOR EACH ROW EXECUTE FUNCTION public.app_reservas_marcar_traslado_cambio();

-- NULL = sin plazo: `reservas_vencer` compara `< now()` y un NULL no vence.
CREATE OR REPLACE FUNCTION public.reserva_plazo_hasta(r app_reservas)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN r.estado = 'en_revision' AND coalesce(r.receta_estado, 'otra_foto') = 'otra_foto'
      THEN greatest(r.created_at, coalesce(r.receta_revisada_at, r.created_at)) + make_interval(hours => p.horas_sin_foto)
    WHEN r.estado = 'en_revision' AND r.receta_estado = 'pendiente'
      THEN r.receta_subida_at + make_interval(hours => p.horas_receta_sin_revisar)
    -- Viene en camino: el plazo de la sala está detenido.
    WHEN r.estado = 'pendiente' AND r.origen = 'app'
         AND (r.traslado_estado IN ('pedido', 'bodega') OR coalesce(r.traslado_por_llegar, 0) > 0)
      THEN NULL
    -- El traslado no salió, llegó una parte o Bodega dio otro precio: 24 h desde ese cambio.
    WHEN r.estado = 'pendiente' AND r.origen = 'app' AND r.traslado_estado IS NOT NULL
      THEN greatest(coalesce(r.pendiente_at, r.created_at), coalesce(r.traslado_cambio_at, r.updated_at)) + make_interval(hours => p.horas_para_preparar)
    WHEN r.estado = 'pendiente' AND r.origen = 'app'
      THEN coalesce(r.pendiente_at, r.created_at) + make_interval(hours => p.horas_para_preparar)
    WHEN r.estado = 'lista' THEN r.vence_at
  END
  FROM public.reserva_plazos() p;
$function$;

CREATE OR REPLACE FUNCTION public.reserva_seguir_traslado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  m jsonb := coalesce(NEW.metadata, '{}'::jsonb);
  v_links jsonb := '[]'::jsonb; lk jsonb;
  it jsonb; v_i integer; v_id bigint; r public.app_reservas;
  v_origen text := coalesce(nullif(m->>'origen_branch_name', ''), 'la otra sala');
  v_llego boolean; v_cambio boolean; v_disp jsonb := '{}'::jsonb; v_hay numeric;
  v_quiere numeric; v_toma numeric; v_unid integer; v_motivo text;
BEGIN
  IF m->>'reserva_id' ~ '^[0-9]{1,12}$' THEN
    v_links := jsonb_build_array(jsonb_build_object('reserva_id', (m->>'reserva_id')::bigint));
  END IF;
  IF jsonb_typeof(m->'reservas') = 'array' THEN v_links := v_links || (m->'reservas'); END IF;
  IF jsonb_array_length(v_links) = 0 THEN RETURN NULL; END IF;
  v_llego := TG_OP = 'UPDATE' AND (NEW.metadata ? 'erp_recibido') AND NOT (coalesce(OLD.metadata, '{}'::jsonb) ? 'erp_recibido')
             AND NEW.status = 'APPROVED';
  v_cambio := TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status;
  IF TG_OP = 'UPDATE' AND NOT v_llego AND NOT v_cambio THEN RETURN NULL; END IF;

  FOR lk IN SELECT * FROM jsonb_array_elements(v_links) LOOP
    -- Un fallo acá nunca puede trabar el traslado: es su consecuencia, no su condición.
    BEGIN
      v_id := (lk->>'reserva_id')::bigint;
      SELECT * INTO r FROM public.app_reservas WHERE id = v_id FOR UPDATE;
      CONTINUE WHEN NOT FOUND OR r.origen NOT IN ('sucursal', 'app') OR r.branch_id::text IS DISTINCT FROM (m->>'branch_id');
      SELECT x.it, (x.n - 1)::integer INTO it, v_i
        FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS x(it, n)
       WHERE x.it->>'erp_product_id' = r.producto_id::text ORDER BY x.n LIMIT 1;
      CONTINUE WHEN it IS NULL;
      v_quiere := coalesce((lk->>'unidades')::numeric,
                           coalesce((it->>'cantidad')::numeric, 0) * greatest(coalesce((it->>'factor')::numeric, 1), 1));

      IF TG_OP = 'INSERT' THEN
        -- Sólo la reserva que lo pidió: las amarradas llegan con el traslado ya hecho.
        IF NOT (lk ? 'unidades') AND r.estado = 'pendiente' THEN
          UPDATE public.app_reservas
             SET traslado_request_id = NEW.id, traslado_estado = 'pedido',
                 traslado_desde = coalesce(nullif(m->>'origen_branch_id', '')::bigint, traslado_desde),
                 traslado_nota = left(format('Pedida a %s.', v_origen), 300), updated_at = now()
           WHERE id = v_id;
        END IF;
        CONTINUE;
      END IF;

      IF v_llego OR NEW.status = 'APPROVED' THEN
        v_hay := coalesce((v_disp->>v_i::text)::numeric,
                          public.traslado_enviada_del_renglon(m, v_i) * greatest(coalesce((it->>'factor')::numeric, 1), 1));
        v_toma := greatest(least(v_quiere, v_hay), 0);
        v_disp := v_disp || jsonb_build_object(v_i::text, v_hay - v_toma);
        v_unid := floor(v_toma / greatest(r.factor, 1));
      END IF;

      -- Llegó: cuenta aunque ya no sea el traslado vigente — lo que llega, llegó.
      IF v_llego THEN
        PERFORM public.reserva_sumar_llegada(v_id, v_unid, v_origen);
        CONTINUE;
      END IF;

      CONTINUE WHEN r.estado <> 'pendiente';
      IF NEW.status = 'APPROVED' THEN
        IF v_toma <= 0 THEN
          UPDATE public.app_reservas SET traslado_estado = 'rechazado',
                 traslado_nota = left(format('%s no tenía para mandar.', v_origen), 300), updated_at = now() WHERE id = v_id;
          PERFORM public.reserva_avisar_sala(v_id, 'El traslado no sale',
            format('%s no tenía %s para mandar. Pídelo a otra sala o a Bodega, o habla con el cliente.', v_origen, r.producto_nombre), 'reserva_sin_traslado');
        ELSIF v_toma < v_quiere THEN
          UPDATE public.app_reservas SET traslado_estado = 'parcial', traslado_por_llegar = traslado_por_llegar + v_unid,
                 traslado_nota = left(format('%s manda %s de %s.', v_origen, v_unid, floor(v_quiere / greatest(r.factor, 1))), 300),
                 updated_at = now() WHERE id = v_id;
          PERFORM public.reserva_avisar_sala(v_id, 'Viene sólo una parte',
            format('%s manda %s de %s × %s. Pide el resto a otra sala o a Bodega, o habla con el cliente.', v_origen, v_unid,
                   floor(v_quiere / greatest(r.factor, 1)), r.producto_nombre), 'reserva_parcial');
        ELSE
          -- Con el resto encargado a Bodega, la reserva sigue esperando a Bodega.
          UPDATE public.app_reservas SET traslado_estado = CASE WHEN traslado_estado = 'bodega' THEN 'bodega' ELSE 'enviado' END,
                 traslado_por_llegar = traslado_por_llegar + v_unid,
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
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'reserva_seguir_traslado: solicitud % reserva % (%)', NEW.id, v_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.reserva_encargar_a_bodega(p_id bigint, p_nota text DEFAULT NULL::text)
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
  IF r.origen NOT IN ('sucursal', 'app') OR r.estado <> 'pendiente' THEN RAISE EXCEPTION 'Sólo una reserva que espera producto se encarga a Bodega.'; END IF;
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
  -- Pagada en línea a su precio (2026-10-22): otro precio no se cobra acá.
  IF p_acepta AND r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado' AND round(e.precio_unitario, 2) <> round(r.precio_unitario, 2) THEN
    RAISE EXCEPTION 'Esta reserva se pagó en línea a otro precio: cancélala (lo pagado queda a su favor) y apártala de nuevo al precio de Bodega.';
  END IF;
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
      VALUES (r.customer_id, r.branch_id, r.origen, r.producto_id, r.producto_nombre, r.cantidad - v_ya, r.factor,
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
    UPDATE public.app_encargos SET estado = 'aceptado', updated_at = now() WHERE id = e.id;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), CASE WHEN p_acepta THEN 'RESERVA_PRECIO_ACEPTADO' ELSE 'RESERVA_PRECIO_RECHAZADO' END, p_id::text,
          jsonb_build_object('encargo', e.id, 'precio', e.precio_unitario, 'antes', r.precio_unitario, 'nueva', v_nueva), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'nueva', v_nueva, 'codigo_nueva', CASE WHEN v_nueva IS NOT NULL THEN 'R-' || lpad(v_nueva::text, 6, '0') END);
END $function$;
