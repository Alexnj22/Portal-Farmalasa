SET lock_timeout = '5s';

-- ── Un traslado puede servir a VARIAS reservas, cada una con SUS unidades ──
-- (2026-10-22: «si vienen 5 en un traslado y reservo 1»). Antes la reserva se
-- quedaba con el traslado entero y las otras 4 dejaban de ofrecerse. Ahora el
-- amarre vive en `metadata.reservas` = [{reserva_id, unidades}] (unidades base),
-- y lo que queda libre es lo que viene menos lo tomado por reservas abiertas.
-- `metadata.reserva_id` (el traslado pedido PARA una reserva) sigue tomándolo entero.
CREATE OR REPLACE FUNCTION public.traslados_en_camino_a_sala(p_branch_id bigint, p_producto_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- plpgsql y no sql: con `SET` una sql nace con plan genérico (CLAUDE.md, trampa 4).
  RETURN (SELECT coalesce(json_agg(json_build_object(
           'id', t.id, 'origen', t.origen, 'origen_branch_id', t.origen_branch_id,
           'unidades', t.unidades - t.tomadas, 'total', t.unidades, 'estado', t.estado, 'pedido_at', t.created_at)
           ORDER BY t.created_at), '[]'::json)
    FROM (
      SELECT ar.id, ar.created_at,
             coalesce(nullif(ar.metadata->>'origen_branch_name', ''), 'otra sala') AS origen,
             nullif(ar.metadata->>'origen_branch_id', '')::bigint AS origen_branch_id,
             CASE WHEN ar.status = 'APPROVED' AND ar.metadata ? 'erp_traslado' THEN 'enviado' ELSE 'pedido' END AS estado,
             floor(CASE WHEN ar.status = 'APPROVED' AND ar.metadata ? 'erp_traslado'
                        THEN public.traslado_enviada_del_renglon(ar.metadata, x.n::integer - 1)
                        ELSE coalesce((x.it->>'cantidad')::numeric, 0) END
                   * greatest(coalesce((x.it->>'factor')::numeric, 1), 1)) AS unidades,
             -- Lo tomado por reservas abiertas: las amarradas con sus unidades
             -- y, si lo pidió una reserva, todo.
             CASE WHEN EXISTS (SELECT 1 FROM public.app_reservas r
                                WHERE r.id::text = ar.metadata->>'reserva_id' AND r.estado IN ('en_revision', 'pendiente', 'lista'))
                  THEN 1e9
                  ELSE coalesce((SELECT sum((y->>'unidades')::numeric)
                                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ar.metadata->'reservas') = 'array'
                                                                  THEN ar.metadata->'reservas' ELSE '[]'::jsonb END) y
                                   JOIN public.app_reservas r ON r.id = (y->>'reserva_id')::bigint
                                  WHERE r.producto_id = p_producto_id AND r.estado IN ('en_revision', 'pendiente', 'lista')), 0) END AS tomadas
        FROM public.approval_requests ar
        CROSS JOIN LATERAL (
          SELECT it, n FROM jsonb_array_elements(coalesce(ar.metadata->'items', '[]'::jsonb)) WITH ORDINALITY AS e(it, n)
           WHERE it->>'erp_product_id' = p_producto_id::text ORDER BY n LIMIT 1) x
       WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
         AND ar.status IN ('PENDING', 'APPROVED')
         AND ar.metadata->>'branch_id' = p_branch_id::text
         AND NOT (ar.metadata ? 'erp_recibido')
         AND ar.created_at > now() - interval '30 days'
    ) t
   WHERE t.unidades - t.tomadas > 0);
END $function$;

-- Amarra una reserva a traslados que ya venían, tomando de cada uno sólo lo
-- que le falta (en orden). Si no alcanzan y se pidió, el resto se encarga a
-- Bodega con la reserva —el mismo encargo que `reserva_encargar_a_bodega`—.
CREATE OR REPLACE FUNCTION public.reserva_amarrar_traslados(p_reserva bigint, p_requests uuid[], p_resto boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas; v_viene json; v_falta_base numeric; v_toma numeric; v_tomado numeric := 0; v_salieron numeric := 0;
  v_todos_salieron boolean := true; v_origenes text; v_primero uuid; v_primero_desde bigint; v_falta integer; v_enc bigint; v_n integer := 0;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_reserva FOR UPDATE;
  -- Bajo el candado de los traslados: dos ventanillas no pueden tomar lo mismo.
  PERFORM 1 FROM public.approval_requests WHERE id = ANY (p_requests) ORDER BY id FOR UPDATE;
  v_falta_base := r.cantidad * greatest(r.factor, 1);
  FOR v_viene IN SELECT x FROM json_array_elements(public.traslados_en_camino_a_sala(r.branch_id, r.producto_id)) x
                  WHERE (x->>'id')::uuid = ANY (p_requests) LOOP
    v_n := v_n + 1;
    v_toma := least((v_viene->>'unidades')::numeric, v_falta_base);
    CONTINUE WHEN v_toma <= 0;
    v_falta_base := v_falta_base - v_toma; v_tomado := v_tomado + v_toma;
    IF v_viene->>'estado' = 'enviado' THEN v_salieron := v_salieron + v_toma; ELSE v_todos_salieron := false; END IF;
    v_origenes := coalesce(v_origenes || ' y ', '') || (v_viene->>'origen');
    v_primero := coalesce(v_primero, (v_viene->>'id')::uuid);
    v_primero_desde := coalesce(v_primero_desde, (v_viene->>'origen_branch_id')::bigint);
    UPDATE public.approval_requests
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reservas',
             CASE WHEN jsonb_typeof(metadata->'reservas') = 'array' THEN metadata->'reservas' ELSE '[]'::jsonb END
             || jsonb_build_array(jsonb_build_object('reserva_id', p_reserva, 'unidades', v_toma)))
     WHERE id = (v_viene->>'id')::uuid;
  END LOOP;
  IF v_n <> cardinality(p_requests) THEN
    RAISE EXCEPTION 'Uno de esos traslados ya no está en camino para apartar: vuelve a revisarlo.';
  END IF;
  v_falta := r.cantidad - floor(v_tomado / greatest(r.factor, 1))::integer;
  IF v_falta > 0 AND NOT p_resto THEN
    RAISE EXCEPTION 'Vienen % y se piden %: encarga el resto a Bodega o pide menos.', floor(v_tomado / greatest(r.factor, 1)), r.cantidad;
  END IF;
  IF v_falta > 20 THEN RAISE EXCEPTION 'Bodega encarga hasta 20 por pedido y faltan %.', v_falta; END IF;

  UPDATE public.app_reservas
     SET traslado_request_id = v_primero, traslado_desde = coalesce(v_primero_desde, traslado_desde),
         traslado_estado = CASE WHEN v_falta > 0 THEN 'bodega' WHEN v_todos_salieron THEN 'enviado' ELSE 'pedido' END,
         traslado_por_llegar = floor(v_salieron / greatest(r.factor, 1))::integer,
         traslado_nota = left(format('Viene de %s.', v_origenes), 300),
         updated_at = now()
   WHERE id = p_reserva;

  IF v_falta > 0 THEN
    INSERT INTO public.app_encargos (customer_id, branch_id, product_id, producto_nombre, factor, cantidad, nota_cliente, estado, pago_estado, reserva_id)
    VALUES (r.customer_id, r.branch_id, r.producto_id, r.producto_nombre, r.factor, v_falta,
            left('Para la reserva R-' || lpad(p_reserva::text, 6, '0')
                 || format(' (reservado a $%s c/u)', to_char(r.precio_unitario, 'FM999990.00')), 300),
            'solicitado', 'pendiente', p_reserva)
    RETURNING id INTO v_enc;
    UPDATE public.app_reservas
       SET traslado_nota = left(format('Viene de %s; encargado a Bodega: %s (E-%s).', v_origenes, v_falta, lpad(v_enc::text, 6, '0')), 300)
     WHERE id = p_reserva;
  END IF;
END $function$;

-- Sigue un traslado para TODAS las reservas que lo esperan: la que lo pidió
-- (`metadata.reserva_id`, todo) y las amarradas (`metadata.reservas`, cada
-- una con sus unidades). Lo que sale o llega se reparte en ese orden.
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
      CONTINUE WHEN NOT FOUND OR r.origen <> 'sucursal' OR r.branch_id::text IS DISTINCT FROM (m->>'branch_id');
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

DROP TRIGGER reserva_seguir_traslado ON public.approval_requests;
CREATE TRIGGER reserva_seguir_traslado AFTER INSERT OR UPDATE OF status, metadata ON public.approval_requests
  FOR EACH ROW WHEN (((new.type = 'INVENTORY_TRANSFER_REQUEST'::text) AND ((new.metadata ? 'reserva_id'::text) OR (new.metadata ? 'reservas'::text))))
  EXECUTE FUNCTION public.reserva_seguir_traslado();
