-- segunda-a1-05 · Encuestas a clientes: tope al canal público y un incentivo
-- por cliente (H11, H12)
-- H11: tope EN LA BASE por encuesta + sala + canal (15 QR / 30 tablet en 10 min)
--      y aviso de detractor agrupado.
-- H12: un incentivo acreditado por (encuesta, cliente), con lock e índice único parcial.
SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS encuesta_cliente_incentivos_uno_por_cliente
    ON public.encuesta_cliente_incentivos (encuesta_id, customer_id)
    WHERE estado = 'acreditado';

-- Definición viva del 2026-10-23 + el tope por sala y canal.
CREATE OR REPLACE FUNCTION public.encuesta_publica_responder(p_token text, p_respuestas jsonb, p_contacto jsonb DEFAULT NULL::jsonb, p_dispositivo text DEFAULT NULL::text, p_duracion integer DEFAULT NULL::integer, p_modo text DEFAULT 'qr'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_s     public.encuesta_cliente_sucursales;
    v_enc   public.encuestas_cliente;
    v_canal text := CASE WHEN p_modo = 'tablet' THEN 'kiosco' ELSE 'qr' END;
    v_tope  integer;
BEGIN
    SELECT * INTO v_s FROM public.encuesta_cliente_sucursales WHERE token = p_token;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esta encuesta no existe'; END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = v_s.encuesta_id FOR UPDATE;

    -- Tope por sala y canal (H11, 2026-10-23). El FOR UPDATE de arriba
    -- serializa las respuestas de la encuesta, así que el conteo no se cuela.
    v_tope := CASE WHEN v_canal = 'kiosco' THEN 30 ELSE 15 END;
    IF (SELECT count(*) FROM public.encuesta_cliente_respuestas r
         WHERE r.encuesta_id = v_enc.id AND r.branch_id = v_s.branch_id AND r.canal = v_canal
           AND r.created_at > now() - interval '10 minutes') >= v_tope THEN
        RAISE EXCEPTION 'Recibimos muchas respuestas en este momento. Intenta de nuevo en unos minutos.';
    END IF;

    RETURN public.encuesta_cliente_registrar(v_enc, v_s.branch_id, v_canal,
        p_respuestas, p_contacto, p_dispositivo, p_duracion, NULL);
END $function$;

-- Definición viva del 2026-10-23 + el agrupado de avisos.
CREATE OR REPLACE FUNCTION public.encuesta_cliente_avisar_detractor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_enc  public.encuestas_cliente;
    v_dest uuid[];
    v_sala text;
    v_texto text;
BEGIN
    IF NEW.nps IS NULL OR NEW.nps > 6 THEN RETURN NULL; END IF;
    -- Agrupado (H11, 2026-10-23): más de 3 detractores de la misma encuesta
    -- y sala en la última hora ya no avisan uno por uno.
    IF (SELECT count(*) FROM public.encuesta_cliente_respuestas r
         WHERE r.encuesta_id = NEW.encuesta_id AND r.branch_id = NEW.branch_id
           AND r.nps <= 6 AND r.id <> NEW.id
           AND r.created_at > now() - interval '1 hour') >= 3 THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = NEW.encuesta_id;
    SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;
    SELECT coalesce(array_agg(DISTINCT e.id), '{}') INTO v_dest
      FROM public.employees e
      JOIN public.roles r ON r.id IN (e.role_id, e.secondary_role_id)
     WHERE e.status = 'ACTIVO'
       AND ((r.name = 'Jefe/a de Sala' AND e.branch_id = NEW.branch_id) OR r.name = 'Supervisor/a de Ventas');
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NULL; END IF;
    -- La primera respuesta abierta, si hay: es lo que explica el puntaje.
    SELECT left(NEW.respuestas ->> (p ->> 'id'), 160) INTO v_texto
      FROM jsonb_array_elements(coalesce(v_enc.cuestionario -> 'secciones', '[]')) s,
           jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
     WHERE p ->> 'tipo' = 'texto' AND nullif(btrim(NEW.respuestas ->> (p ->> 'id')), '') IS NOT NULL
     LIMIT 1;
    PERFORM public.notify_employees(v_dest, 'ENCUESTAS',
        'Cliente insatisfecho en ' || coalesce(v_sala, 'sala') || ' (' || NEW.nps || '/10)',
        coalesce('«' || v_texto || '»', 'Sin comentario.')
          || CASE WHEN NEW.telefono IS NOT NULL THEN ' · Dejó su teléfono para seguimiento.' ELSE '' END,
        '/encuestas-clientes?encuesta=' || NEW.encuesta_id || '&vista=resultados',
        jsonb_build_object('encuesta_id', NEW.encuesta_id, 'respuesta_id', NEW.id), true, NEW.branch_id);
    RETURN NULL;
END $function$;

-- Definición viva del 2026-10-23 + un incentivo por cliente y encuesta.
CREATE OR REPLACE FUNCTION public.encuesta_cliente_acreditar(p_inc uuid, p_customer bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_inc   public.encuesta_cliente_incentivos;
    v_nom   text;
    v_lote  bigint;
    v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
    SELECT * INTO v_inc FROM public.encuesta_cliente_incentivos WHERE id = p_inc FOR UPDATE;
    IF NOT FOUND OR v_inc.tipo <> 'puntos' OR v_inc.estado = 'acreditado' THEN RETURN v_inc.estado; END IF;
    IF p_customer IS NULL THEN RETURN 'pendiente'; END IF;

    -- Uno por cliente y encuesta, sin importar el canal (H12, 2026-10-23).
    -- La misma llave que toma `encuesta_app_responder`: la app y el QR se
    -- esperan entre sí en vez de acreditar los dos.
    PERFORM pg_advisory_xact_lock(hashtext('encuesta_app:' || v_inc.encuesta_id || ':' || p_customer));
    IF EXISTS (SELECT 1 FROM public.encuesta_cliente_incentivos i
                WHERE i.encuesta_id = v_inc.encuesta_id AND i.customer_id = p_customer
                  AND i.estado = 'acreditado' AND i.id <> p_inc) THEN
        UPDATE public.encuesta_cliente_incentivos
           SET estado = 'no_aplica', customer_id = p_customer, motivo = 'Ya recibió el incentivo de esta encuesta'
         WHERE id = p_inc;
        RETURN 'no_aplica';
    END IF;

    IF NOT coalesce((SELECT acumula_puntos FROM public.customers WHERE id = p_customer), false) THEN
        UPDATE public.encuesta_cliente_incentivos
           SET estado = 'no_aplica', customer_id = p_customer, motivo = 'La ficha no acumula puntos'
         WHERE id = p_inc;
        RETURN 'no_aplica';
    END IF;
    -- Antes del arranque del programa en el portal el saldo lo pisaría el
    -- cuadre nocturno: se deja pendiente en vez de perderlo.
    IF public.puntos_fuente() <> 'portal' THEN
        UPDATE public.encuesta_cliente_incentivos SET customer_id = p_customer, motivo = 'El programa de puntos todavía no está en el portal'
         WHERE id = p_inc;
        RETURN 'pendiente';
    END IF;
    SELECT nombre INTO v_nom FROM public.encuestas_cliente WHERE id = v_inc.encuesta_id;

    INSERT INTO public.puntos_cuenta (customer_id) VALUES (p_customer) ON CONFLICT (customer_id) DO NOTHING;
    PERFORM 1 FROM public.puntos_cuenta WHERE customer_id = p_customer FOR UPDATE;
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo, creado_por)
    VALUES (p_customer, 'ajuste', v_inc.puntos, v_inc.puntos, v_hoy, public.puntos_vence_el(v_hoy),
            'Encuesta a clientes: ' || v_nom, NULL)
    RETURNING id INTO v_lote;
    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_inc.puntos, ganados = ganados + v_inc.puntos, updated_at = now()
     WHERE customer_id = p_customer;

    UPDATE public.encuesta_cliente_incentivos
       SET estado = 'acreditado', customer_id = p_customer, lote_id = v_lote, motivo = NULL,
           resuelto_at = now(), resuelto_por = public.auth_employee_id()
     WHERE id = p_inc;
    RETURN 'acreditado';
END $function$;
