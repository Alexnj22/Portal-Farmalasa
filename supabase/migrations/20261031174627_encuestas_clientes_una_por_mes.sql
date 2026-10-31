-- Encuestas a clientes: una respuesta por cliente, encuesta y MES (2026-10-31).
--
-- Decisión del usuario: «que se limite a 1 encuesta al mes de ese cliente en
-- esa encuesta». Hasta hoy era una por encuesta PARA SIEMPRE (por teléfono, por
-- ficha en la app y por incentivo). El mes es el calendario de El Salvador y
-- vive en una columna `mes` para que los índices únicos lo puedan exigir.
--
-- El cliente se reconoce por su teléfono (QR, tablet, entrevista) o por su
-- cuenta (app); con ficha, el tope vale por cualquier canal. Los puntos siguen
-- exigiendo que el teléfono apunte a UNA sola ficha: si no, quedan pendientes.

SET lock_timeout = '5s';

ALTER TABLE public.encuesta_cliente_respuestas
    ADD COLUMN IF NOT EXISTS mes date NOT NULL DEFAULT date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
UPDATE public.encuesta_cliente_respuestas
   SET mes = date_trunc('month', (created_at AT TIME ZONE 'America/El_Salvador'))::date
 WHERE mes <> date_trunc('month', (created_at AT TIME ZONE 'America/El_Salvador'))::date;
ALTER TABLE public.encuesta_cliente_incentivos
    ADD COLUMN IF NOT EXISTS mes date NOT NULL DEFAULT date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
UPDATE public.encuesta_cliente_incentivos i
   SET mes = r.mes FROM public.encuesta_cliente_respuestas r
 WHERE r.id = i.respuesta_id AND i.mes <> r.mes;

DROP INDEX IF EXISTS public.encuesta_cliente_respuestas_una_por_telefono;
CREATE UNIQUE INDEX encuesta_cliente_respuestas_una_por_telefono
    ON public.encuesta_cliente_respuestas (encuesta_id, telefono_hash, mes) WHERE telefono_hash IS NOT NULL;
DROP INDEX IF EXISTS public.encuesta_cliente_respuestas_app_una_por_cliente;
CREATE UNIQUE INDEX encuesta_cliente_respuestas_app_una_por_cliente
    ON public.encuesta_cliente_respuestas (encuesta_id, customer_id, mes) WHERE canal = 'app';
DROP INDEX IF EXISTS public.encuesta_cliente_incentivos_uno_por_cliente;
CREATE UNIQUE INDEX encuesta_cliente_incentivos_uno_por_cliente
    ON public.encuesta_cliente_incentivos (encuesta_id, customer_id, mes) WHERE estado = 'acreditado';

CREATE OR REPLACE FUNCTION public.encuesta_cliente_registrar(p_enc encuestas_cliente, p_branch integer, p_canal text, p_respuestas jsonb, p_contacto jsonb, p_dispositivo text, p_duracion integer, p_entrevistador uuid, p_ref uuid DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_mes      date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
    v_limpias  jsonb;
    v_tel      text;
    v_hash     text;
    v_nombre   text;
    v_consiente boolean := coalesce((p_contacto ->> 'consiente')::boolean, false);
    v_cliente  bigint;
    v_nps      smallint;
    v_id       uuid;
    v_recientes integer;
    v_cerrada  boolean := false;
    v_inc      uuid;
    v_inc_estado text;
    v_previa   public.encuesta_cliente_respuestas;
    v_inc_prev public.encuesta_cliente_incentivos;
BEGIN
    -- Un reintento de la MISMA respuesta (se cortó la red después de que
    -- entró) devuelve lo que ya se guardó. Va antes de todo: la encuesta pudo
    -- cerrarse justo con esa respuesta.
    IF p_ref IS NOT NULL THEN
        SELECT * INTO v_previa FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_enc.id AND ref = p_ref;
        IF FOUND THEN
            SELECT * INTO v_inc_prev FROM public.encuesta_cliente_incentivos WHERE respuesta_id = v_previa.id LIMIT 1;
            RETURN json_build_object('id', v_previa.id, 'cerrada', p_enc.estado = 'cerrada', 'repetida', true,
                'incentivo', CASE WHEN v_inc_prev.id IS NOT NULL THEN json_build_object(
                    'tipo', v_inc_prev.tipo, 'estado', v_inc_prev.estado,
                    'puntos', v_inc_prev.puntos, 'descripcion', v_inc_prev.descripcion) END);
        END IF;
    END IF;

    IF p_enc.estado <> 'publicada' THEN RAISE EXCEPTION 'Esta encuesta ya no está recibiendo respuestas'; END IF;
    IF p_enc.fecha_inicio IS NOT NULL AND v_hoy < p_enc.fecha_inicio THEN RAISE EXCEPTION 'Esta encuesta todavía no empieza'; END IF;
    IF p_enc.fecha_fin IS NOT NULL AND v_hoy > p_enc.fecha_fin THEN RAISE EXCEPTION 'Esta encuesta ya cerró'; END IF;
    IF NOT p_canal = ANY (p_enc.canales) THEN RAISE EXCEPTION 'Esta encuesta no se aplica por este medio'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.encuesta_cliente_sucursales WHERE encuesta_id = p_enc.id AND branch_id = p_branch) THEN
        RAISE EXCEPTION 'Esta encuesta no se aplica en esa sucursal';
    END IF;

    -- Freno contra el envío repetido desde el mismo dispositivo. La tablet de
    -- sala responde muchas veces al día a propósito y la comparten todos los
    -- clientes: sólo se le pide un respiro corto.
    IF p_canal IN ('qr','kiosco') THEN
        IF coalesce(length(p_dispositivo), 0) NOT BETWEEN 8 AND 64 THEN RAISE EXCEPTION 'Dispositivo no reconocido'; END IF;
        SELECT count(*) INTO v_recientes FROM public.encuesta_cliente_respuestas
         WHERE encuesta_id = p_enc.id AND dispositivo = p_dispositivo
           AND created_at > now() - CASE WHEN p_canal = 'kiosco' THEN interval '5 seconds' ELSE interval '20 seconds' END;
        IF v_recientes > 0 THEN RAISE EXCEPTION 'Espera unos segundos antes de enviar otra respuesta'; END IF;
        IF p_canal = 'qr' THEN
            SELECT count(*) INTO v_recientes FROM public.encuesta_cliente_respuestas
             WHERE encuesta_id = p_enc.id AND dispositivo = p_dispositivo AND created_at > now() - interval '1 day';
            IF v_recientes >= 3 THEN RAISE EXCEPTION 'Ya respondiste esta encuesta desde este teléfono. ¡Gracias!'; END IF;
        END IF;
    END IF;

    v_limpias := public.encuesta_cliente_limpiar(p_enc.cuestionario, p_respuestas);
    IF v_limpias = '{}'::jsonb THEN RAISE EXCEPTION 'La respuesta está vacía'; END IF;

    -- El contacto sólo con consentimiento; sin él, la respuesta es anónima
    -- aunque el navegador haya mandado un número.
    IF v_consiente THEN
        v_tel := right(regexp_replace(coalesce(p_contacto ->> 'telefono', ''), '\D', '', 'g'), 8);
        IF v_tel = '' THEN v_tel := NULL; END IF;
        IF v_tel IS NOT NULL AND v_tel !~ '^[267][0-9]{7}$' THEN
            RAISE EXCEPTION 'El teléfono debe tener 8 dígitos';
        END IF;
        v_nombre := nullif(left(btrim(coalesce(p_contacto ->> 'nombre', '')), 120), '');
        IF v_tel IS NOT NULL THEN
            v_hash := encode(extensions.digest(v_tel, 'sha256'), 'hex');
            IF EXISTS (SELECT 1 FROM public.encuesta_cliente_respuestas
                        WHERE encuesta_id = p_enc.id AND telefono_hash = v_hash AND mes = v_mes) THEN
                RAISE EXCEPTION 'Ese teléfono ya respondió esta encuesta este mes. Puede volver a responderla el mes que viene.';
            END IF;
            -- La ficha se liga sólo si el número apunta a UNA sola persona.
            SELECT CASE WHEN count(*) = 1 THEN min(c.id) END INTO v_cliente
              FROM public.customers c
             WHERE right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = v_tel
                OR right(regexp_replace(coalesce(c.telefono2, ''), '\D', '', 'g'), 8) = v_tel;
            -- Una por cliente y encuesta al mes, por cualquier canal: con otro
            -- teléfono de la misma ficha, o desde la app, es la misma persona.
            IF v_cliente IS NOT NULL THEN
                PERFORM pg_advisory_xact_lock(hashtext('encuesta_app:' || p_enc.id || ':' || v_cliente));
                IF EXISTS (SELECT 1 FROM public.encuesta_cliente_respuestas
                            WHERE encuesta_id = p_enc.id AND customer_id = v_cliente AND mes = v_mes) THEN
                    RAISE EXCEPTION 'Este cliente ya respondió esta encuesta este mes. Puede volver a responderla el mes que viene.';
                END IF;
            END IF;
        END IF;
        IF v_tel IS NULL AND v_nombre IS NULL THEN v_consiente := false; END IF;
    END IF;

    -- El NPS de la encuesta es la PRIMERA pregunta de ese tipo que se contestó.
    SELECT (v_limpias ->> (p ->> 'id'))::smallint INTO v_nps
      FROM jsonb_array_elements(coalesce(p_enc.cuestionario -> 'secciones', '[]')) s,
           jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
     WHERE p ->> 'tipo' = 'nps' AND v_limpias ? (p ->> 'id')
     LIMIT 1;

    INSERT INTO public.encuesta_cliente_respuestas (
        encuesta_id, branch_id, canal, entrevistador_id, respuestas, nps, consentimiento_at,
        contacto_nombre, telefono, telefono_hash, customer_id, dispositivo, duracion_seg, ref, mes)
    VALUES (
        p_enc.id, p_branch, p_canal, p_entrevistador, v_limpias, v_nps,
        CASE WHEN v_consiente THEN now() END,
        CASE WHEN v_consiente THEN v_nombre END, CASE WHEN v_consiente THEN v_tel END,
        CASE WHEN v_consiente THEN v_hash END, CASE WHEN v_consiente THEN v_cliente END,
        left(p_dispositivo, 64), CASE WHEN p_duracion BETWEEN 0 AND 86400 THEN p_duracion END, p_ref, v_mes)
    RETURNING id INTO v_id;

    -- ── El incentivo (fase 3) ──────────────────────────────────────────────
    -- Sólo con TELÉFONO y consentimiento: es lo que lo hace uno por persona.
    -- La muestra médica, además, sólo en entrevista: alguien tiene que darla.
    IF v_consiente AND v_tel IS NOT NULL THEN
        IF p_enc.incentivo_tipo = 'puntos' AND p_enc.incentivo_puntos > 0 THEN
            INSERT INTO public.encuesta_cliente_incentivos (respuesta_id, encuesta_id, tipo, estado, puntos, mes, motivo)
            VALUES (v_id, p_enc.id, 'puntos', 'pendiente', p_enc.incentivo_puntos, v_mes,
                    CASE WHEN v_cliente IS NULL THEN 'El teléfono no corresponde a una sola ficha' END)
            RETURNING id INTO v_inc;
            v_inc_estado := public.encuesta_cliente_acreditar(v_inc, v_cliente);
        ELSIF p_enc.incentivo_tipo = 'muestra' AND p_canal = 'entrevista' THEN
            INSERT INTO public.encuesta_cliente_incentivos (respuesta_id, encuesta_id, tipo, estado, descripcion, customer_id, mes)
            VALUES (v_id, p_enc.id, 'muestra', 'pendiente', p_enc.incentivo_descripcion, v_cliente, v_mes)
            RETURNING id INTO v_inc;
            v_inc_estado := 'pendiente';
        END IF;
    END IF;

    v_cerrada := public.encuesta_cliente_cerrar_si_llego(p_enc.id);
    RETURN json_build_object('id', v_id, 'cerrada', v_cerrada,
        'incentivo', CASE WHEN v_inc IS NOT NULL THEN json_build_object(
            'tipo', p_enc.incentivo_tipo, 'estado', v_inc_estado,
            'puntos', p_enc.incentivo_puntos, 'descripcion', p_enc.incentivo_descripcion) END);
END $function$;

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

    -- Uno por cliente, encuesta y MES, sin importar el canal (H12, 2026-10-23;
    -- por mes desde el 2026-10-31).
    -- La misma llave que toma `encuesta_app_responder`: la app y el QR se
    -- esperan entre sí en vez de acreditar los dos.
    PERFORM pg_advisory_xact_lock(hashtext('encuesta_app:' || v_inc.encuesta_id || ':' || p_customer));
    IF EXISTS (SELECT 1 FROM public.encuesta_cliente_incentivos i
                WHERE i.encuesta_id = v_inc.encuesta_id AND i.customer_id = p_customer
                  AND i.mes = v_inc.mes AND i.estado = 'acreditado' AND i.id <> p_inc) THEN
        UPDATE public.encuesta_cliente_incentivos
           SET estado = 'no_aplica', customer_id = p_customer, motivo = 'Ya recibió el incentivo de esta encuesta este mes'
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

CREATE OR REPLACE FUNCTION public.encuesta_app_disponibles(p_customer bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(json_build_object(
      'id', e.id, 'nombre', e.nombre, 'cuestionario', e.cuestionario,
      'bienvenida', e.mensaje_bienvenida, 'cierre', e.mensaje_cierre,
      'puntos', public.encuesta_app_puntos(e), 'hasta', e.fecha_fin) ORDER BY e.publicada_at DESC), '[]'::json)
    FROM public.encuestas_cliente e
   WHERE NOT e.es_plantilla AND e.estado = 'publicada' AND 'app' = ANY (e.canales)
     AND (e.fecha_inicio IS NULL OR e.fecha_inicio <= (now() AT TIME ZONE 'America/El_Salvador')::date)
     AND (e.fecha_fin IS NULL OR e.fecha_fin >= (now() AT TIME ZONE 'America/El_Salvador')::date)
     AND NOT EXISTS (SELECT 1 FROM public.encuesta_cliente_respuestas r
                      WHERE r.encuesta_id = e.id AND r.customer_id = p_customer
                        AND r.mes = date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date);
$function$;

CREATE OR REPLACE FUNCTION public.encuesta_app_responder(p_customer bigint, p_id uuid, p_respuestas jsonb, p_duracion integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_enc public.encuestas_cliente;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_mes date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
  v_limpias jsonb; v_nps smallint; v_branch integer; v_id uuid; v_inc uuid; v_estado text;
BEGIN
  SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id;
  IF NOT FOUND OR v_enc.es_plantilla OR v_enc.estado <> 'publicada' OR NOT 'app' = ANY (v_enc.canales) THEN RAISE EXCEPTION 'Esta encuesta ya no está recibiendo respuestas'; END IF;
  IF v_enc.fecha_inicio IS NOT NULL AND v_hoy < v_enc.fecha_inicio THEN RAISE EXCEPTION 'Esta encuesta todavía no empieza'; END IF;
  IF v_enc.fecha_fin IS NOT NULL AND v_hoy > v_enc.fecha_fin THEN RAISE EXCEPTION 'Esta encuesta ya cerró'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('encuesta_app:' || p_id || ':' || p_customer));
  IF EXISTS (SELECT 1 FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id AND customer_id = p_customer AND mes = v_mes) THEN
    RAISE EXCEPTION 'Ya respondiste esta encuesta este mes. ¡Gracias! Puedes volver a responderla el mes que viene.';
  END IF;

  v_limpias := public.encuesta_cliente_limpiar(v_enc.cuestionario, p_respuestas);
  IF v_limpias = '{}'::jsonb THEN RAISE EXCEPTION 'La respuesta está vacía'; END IF;
  SELECT (v_limpias ->> (p ->> 'id'))::smallint INTO v_nps
    FROM jsonb_array_elements(coalesce(v_enc.cuestionario -> 'secciones', '[]')) s,
         jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
   WHERE p ->> 'tipo' = 'nps' AND v_limpias ? (p ->> 'id') LIMIT 1;

  -- La sucursal: la de su última compra si la encuesta la incluye; si no, la primera de la encuesta.
  SELECT es.branch_id INTO v_branch
    FROM public.encuesta_cliente_sucursales es
    LEFT JOIN LATERAL (SELECT max(si.fecha) f FROM public.sales_invoices si
                        WHERE si.customer_id = p_customer AND si.branch_id = es.branch_id
                          AND si.fecha >= v_hoy - 365) u ON true
   WHERE es.encuesta_id = p_id
   ORDER BY u.f DESC NULLS LAST, es.branch_id LIMIT 1;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Esta encuesta no tiene sucursales'; END IF;

  INSERT INTO public.encuesta_cliente_respuestas (encuesta_id, branch_id, canal, respuestas, nps, consentimiento_at,
      customer_id, dispositivo, duracion_seg, mes)
  VALUES (p_id, v_branch, 'app', v_limpias, v_nps, now(), p_customer, 'app',
      CASE WHEN p_duracion BETWEEN 0 AND 86400 THEN p_duracion END, v_mes)
  RETURNING id INTO v_id;

  INSERT INTO public.encuesta_cliente_incentivos (respuesta_id, encuesta_id, tipo, estado, puntos, mes)
  VALUES (v_id, p_id, 'puntos', 'pendiente', public.encuesta_app_puntos(v_enc), v_mes)
  RETURNING id INTO v_inc;
  v_estado := public.encuesta_cliente_acreditar(v_inc, p_customer);
  PERFORM public.encuesta_cliente_cerrar_si_llego(p_id);
  RETURN json_build_object('ok', true, 'puntos', public.encuesta_app_puntos(v_enc), 'estado', v_estado, 'cierre', v_enc.mensaje_cierre);
END $function$;
