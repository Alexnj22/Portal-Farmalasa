-- Encuestas a clientes — fase 3: los incentivos.
-- Plan: docs/PLAN-ENCUESTAS-A-CLIENTES-2026-10-01.md
--
-- Decisiones del usuario (2026-10-01): el incentivo es configurable (puntos o
-- muestra médica); sólo lo recibe quien deja su TELÉFONO con consentimiento,
-- una vez por encuesta (lo garantiza el índice único de `telefono_hash`); los
-- puntos se acreditan solos en la cuenta; la muestra la entrega quien
-- acompaña la entrevista.
--
-- Los puntos entran al libro de Puntos como un lote de origen `ajuste` con el
-- motivo «Encuesta a clientes: …» y `creado_por` NULL. Tres razones:
--   · el historial del cliente ya sabe mostrar un ajuste con su motivo, sin
--     tocar las funciones ni las pantallas de Puntos;
--   · el aviso de movimientos raros vigila los ajustes A MANO (`creado_por`
--     con valor): uno automático por encuesta no es un ajuste de nadie;
--   · quién entrevistó queda en la respuesta, no en el lote.
-- La escritura del lote replica la rama positiva de `puntos_ajustar` (cuenta,
-- fila tomada, lote, saldo). Si esa función cambia cómo suma, cambia acá.
SET lock_timeout = '5s';

CREATE TABLE public.encuesta_cliente_incentivos (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    respuesta_id uuid NOT NULL UNIQUE REFERENCES public.encuesta_cliente_respuestas(id) ON DELETE CASCADE,
    encuesta_id  uuid NOT NULL REFERENCES public.encuestas_cliente(id) ON DELETE CASCADE,
    tipo         text NOT NULL CHECK (tipo IN ('puntos','muestra')),
    -- acreditado: los puntos están en la cuenta · entregado: la muestra se dio
    -- pendiente: falta (ficha por confirmar, o muestra por entregar)
    -- no_aplica: la ficha no acumula puntos (genéricas como «Consumidor final»)
    estado       text NOT NULL CHECK (estado IN ('acreditado','entregado','pendiente','no_aplica')),
    puntos       integer CHECK (puntos > 0),
    descripcion  text,
    customer_id  bigint REFERENCES public.customers(id) ON DELETE SET NULL,
    lote_id      bigint REFERENCES public.puntos_lote(id) ON DELETE SET NULL,
    motivo       text,
    resuelto_por uuid REFERENCES public.employees(id),
    resuelto_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (tipo <> 'puntos' OR puntos IS NOT NULL),
    CHECK (estado <> 'acreditado' OR (tipo = 'puntos' AND lote_id IS NOT NULL AND customer_id IS NOT NULL)),
    CHECK (estado <> 'entregado' OR tipo = 'muestra')
);
CREATE INDEX encuesta_cliente_incentivos_encuesta_idx ON public.encuesta_cliente_incentivos (encuesta_id, estado);
CREATE INDEX encuesta_cliente_incentivos_customer_idx ON public.encuesta_cliente_incentivos (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX encuesta_cliente_incentivos_lote_idx ON public.encuesta_cliente_incentivos (lote_id) WHERE lote_id IS NOT NULL;

ALTER TABLE public.encuesta_cliente_incentivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.encuesta_cliente_incentivos FROM anon, authenticated;
GRANT SELECT ON public.encuesta_cliente_incentivos TO authenticated;
GRANT ALL ON public.encuesta_cliente_incentivos TO service_role;
CREATE POLICY encuesta_cliente_incentivos_select ON public.encuesta_cliente_incentivos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_view')));

-- ── Acreditar los puntos de un incentivo ───────────────────────────────────
-- Devuelve el estado en que quedó. Interna: la llaman el registro de la
-- respuesta y la asignación manual.
CREATE FUNCTION public.encuesta_cliente_acreditar(p_inc uuid, p_customer bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_inc   public.encuesta_cliente_incentivos;
    v_nom   text;
    v_lote  bigint;
    v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
    SELECT * INTO v_inc FROM public.encuesta_cliente_incentivos WHERE id = p_inc FOR UPDATE;
    IF NOT FOUND OR v_inc.tipo <> 'puntos' OR v_inc.estado = 'acreditado' THEN RETURN v_inc.estado; END IF;
    IF p_customer IS NULL THEN RETURN 'pendiente'; END IF;
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
END $$;

-- ── El registro de la respuesta, ahora con su incentivo ────────────────────
-- Partido de la definición viva (fase 2); lo nuevo es el bloque del final.
CREATE OR REPLACE FUNCTION public.encuesta_cliente_registrar(
    p_enc public.encuestas_cliente, p_branch integer, p_canal text, p_respuestas jsonb,
    p_contacto jsonb, p_dispositivo text, p_duracion integer, p_entrevistador uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
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
BEGIN
    IF p_enc.estado <> 'publicada' THEN RAISE EXCEPTION 'Esta encuesta ya no está recibiendo respuestas'; END IF;
    IF p_enc.fecha_inicio IS NOT NULL AND v_hoy < p_enc.fecha_inicio THEN RAISE EXCEPTION 'Esta encuesta todavía no empieza'; END IF;
    IF p_enc.fecha_fin IS NOT NULL AND v_hoy > p_enc.fecha_fin THEN RAISE EXCEPTION 'Esta encuesta ya cerró'; END IF;
    IF NOT p_canal = ANY (p_enc.canales) THEN RAISE EXCEPTION 'Esta encuesta no se aplica por este medio'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.encuesta_cliente_sucursales WHERE encuesta_id = p_enc.id AND branch_id = p_branch) THEN
        RAISE EXCEPTION 'Esta encuesta no se aplica en esa sucursal';
    END IF;

    -- Freno contra el envío repetido desde el mismo dispositivo. La tablet de
    -- sala responde muchas veces al día a propósito: sólo se le pide un respiro.
    IF p_canal IN ('qr','kiosco') THEN
        IF coalesce(length(p_dispositivo), 0) NOT BETWEEN 8 AND 64 THEN RAISE EXCEPTION 'Dispositivo no reconocido'; END IF;
        SELECT count(*) INTO v_recientes FROM public.encuesta_cliente_respuestas
         WHERE encuesta_id = p_enc.id AND dispositivo = p_dispositivo AND created_at > now() - interval '20 seconds';
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
            IF EXISTS (SELECT 1 FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_enc.id AND telefono_hash = v_hash) THEN
                RAISE EXCEPTION 'Ese teléfono ya respondió esta encuesta. ¡Gracias!';
            END IF;
            -- La ficha se liga sólo si el número apunta a UNA sola persona.
            SELECT CASE WHEN count(*) = 1 THEN min(c.id) END INTO v_cliente
              FROM public.customers c
             WHERE right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = v_tel
                OR right(regexp_replace(coalesce(c.telefono2, ''), '\D', '', 'g'), 8) = v_tel;
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
        contacto_nombre, telefono, telefono_hash, customer_id, dispositivo, duracion_seg)
    VALUES (
        p_enc.id, p_branch, p_canal, p_entrevistador, v_limpias, v_nps,
        CASE WHEN v_consiente THEN now() END,
        CASE WHEN v_consiente THEN v_nombre END, CASE WHEN v_consiente THEN v_tel END,
        CASE WHEN v_consiente THEN v_hash END, CASE WHEN v_consiente THEN v_cliente END,
        left(p_dispositivo, 64), CASE WHEN p_duracion BETWEEN 0 AND 86400 THEN p_duracion END)
    RETURNING id INTO v_id;

    -- ── El incentivo (fase 3) ──────────────────────────────────────────────
    -- Sólo con TELÉFONO y consentimiento: es lo que lo hace uno por persona.
    -- La muestra médica, además, sólo en entrevista: alguien tiene que darla.
    IF v_consiente AND v_tel IS NOT NULL THEN
        IF p_enc.incentivo_tipo = 'puntos' AND p_enc.incentivo_puntos > 0 THEN
            INSERT INTO public.encuesta_cliente_incentivos (respuesta_id, encuesta_id, tipo, estado, puntos, motivo)
            VALUES (v_id, p_enc.id, 'puntos', 'pendiente', p_enc.incentivo_puntos,
                    CASE WHEN v_cliente IS NULL THEN 'El teléfono no corresponde a una sola ficha' END)
            RETURNING id INTO v_inc;
            v_inc_estado := public.encuesta_cliente_acreditar(v_inc, v_cliente);
        ELSIF p_enc.incentivo_tipo = 'muestra' AND p_canal = 'entrevista' THEN
            INSERT INTO public.encuesta_cliente_incentivos (respuesta_id, encuesta_id, tipo, estado, descripcion, customer_id)
            VALUES (v_id, p_enc.id, 'muestra', 'pendiente', p_enc.incentivo_descripcion, v_cliente)
            RETURNING id INTO v_inc;
            v_inc_estado := 'pendiente';
        END IF;
    END IF;

    v_cerrada := public.encuesta_cliente_cerrar_si_llego(p_enc.id);
    RETURN json_build_object('id', v_id, 'cerrada', v_cerrada,
        'incentivo', CASE WHEN v_inc IS NOT NULL THEN json_build_object(
            'tipo', p_enc.incentivo_tipo, 'estado', v_inc_estado,
            'puntos', p_enc.incentivo_puntos, 'descripcion', p_enc.incentivo_descripcion) END);
END $$;

-- ── La muestra se entregó ──────────────────────────────────────────────────
CREATE FUNCTION public.encuesta_cliente_muestra_entregada(p_respuesta uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_n integer;
BEGIN
    IF NOT (public.auth_has_module_permission('encuestas_aplicar','can_view')
            OR public.auth_has_module_permission('encuestas_clientes','can_edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    UPDATE public.encuesta_cliente_incentivos
       SET estado = 'entregado', resuelto_por = public.auth_employee_id(), resuelto_at = now()
     WHERE respuesta_id = p_respuesta AND tipo = 'muestra' AND estado = 'pendiente';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'No hay una muestra pendiente de entregar para esa respuesta'; END IF;
    RETURN json_build_object('estado', 'entregado');
END $$;

-- ── Asignar a mano la ficha de unos puntos pendientes ──────────────────────
-- Cuando el teléfono no apunta a una sola ficha, quien administra la busca y
-- la confirma. Queda en la respuesta también: es la misma persona.
CREATE FUNCTION public.encuesta_cliente_asignar_incentivo(p_inc uuid, p_customer bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_inc public.encuesta_cliente_incentivos;
    v_estado text;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_edit') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO v_inc FROM public.encuesta_cliente_incentivos WHERE id = p_inc FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El incentivo no existe'; END IF;
    IF v_inc.tipo <> 'puntos' OR v_inc.estado NOT IN ('pendiente','no_aplica') THEN
        RAISE EXCEPTION 'Sólo se asignan puntos pendientes';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer) THEN RAISE EXCEPTION 'No existe el cliente'; END IF;
    UPDATE public.encuesta_cliente_incentivos SET estado = 'pendiente' WHERE id = p_inc;
    v_estado := public.encuesta_cliente_acreditar(p_inc, p_customer);
    UPDATE public.encuesta_cliente_respuestas SET customer_id = p_customer WHERE id = v_inc.respuesta_id;
    RETURN json_build_object('estado', v_estado);
END $$;

-- ── Los incentivos de una encuesta (para el módulo) ────────────────────────
CREATE FUNCTION public.encuesta_cliente_incentivos_de(p_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'id', i.id, 'tipo', i.tipo, 'estado', i.estado, 'puntos', i.puntos, 'descripcion', i.descripcion,
                   'motivo', i.motivo, 'customer_id', i.customer_id, 'cliente', c.name,
                   'telefono', r.telefono, 'contacto_nombre', r.contacto_nombre, 'canal', r.canal,
                   'sucursal', b.name, 'entrevistador_id', r.entrevistador_id,
                   'resuelto_por', i.resuelto_por, 'resuelto_at', i.resuelto_at, 'created_at', i.created_at)
                 ORDER BY (i.estado = 'pendiente') DESC, i.created_at DESC), '[]'::json)
          FROM public.encuesta_cliente_incentivos i
          JOIN public.encuesta_cliente_respuestas r ON r.id = i.respuesta_id
          JOIN public.branches b ON b.id = r.branch_id
          LEFT JOIN public.customers c ON c.id = i.customer_id
         WHERE i.encuesta_id = p_id
    );
END $$;

-- ── El juez: la muestra médica pide ENTREVISTA, no tablet ──────────────────
-- La tablet de sala corre sin sesión: no hay quién firme la entrega. Partido
-- de la definición viva (fase 1); cambia sólo esa regla.
CREATE OR REPLACE FUNCTION public.encuesta_cliente_problemas_de(p_enc public.encuestas_cliente)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $$
DECLARE
    v_out    text[] := '{}';
    v_sec    jsonb;
    v_pre    jsonb;
    v_ids    text[] := '{}';
    v_n      integer := 0;
    v_ns     integer := 0;
    v_tipo   text;
    v_cond   jsonb;
    v_ops    integer;
    v_suc    integer;
    v_sinmeta integer;
    v_tipos  text[] := ARRAY['nps','csat','likert','unica','multiple','si_no','ranking','numero','texto'];
BEGIN
    IF btrim(coalesce(p_enc.nombre, '')) = '' THEN v_out := v_out || 'Falta el nombre de la encuesta'::text; END IF;

    FOR v_sec IN SELECT * FROM jsonb_array_elements(coalesce(p_enc.cuestionario -> 'secciones', '[]')) LOOP
        v_ns := v_ns + 1;
        FOR v_pre IN SELECT * FROM jsonb_array_elements(coalesce(v_sec -> 'preguntas', '[]')) LOOP
            v_n := v_n + 1;
            v_tipo := v_pre ->> 'tipo';
            IF coalesce(v_pre ->> 'id', '') = '' OR (v_pre ->> 'id') = ANY (v_ids) THEN
                v_out := v_out || format('La pregunta %s no tiene un identificador único', v_n);
            END IF;
            IF btrim(coalesce(v_pre ->> 'texto', '')) = '' THEN
                v_out := v_out || format('La pregunta %s no tiene texto', v_n);
            END IF;
            IF v_tipo IS NULL OR NOT v_tipo = ANY (v_tipos) THEN
                v_out := v_out || format('La pregunta %s no tiene un tipo válido', v_n);
            END IF;
            IF v_tipo IN ('unica','multiple','ranking') THEN
                SELECT count(*) INTO v_ops FROM jsonb_array_elements(coalesce(v_pre -> 'opciones', '[]')) o
                 WHERE btrim(coalesce(o ->> 'texto', '')) <> '';
                IF v_ops < 2 THEN
                    v_out := v_out || format('La pregunta %s necesita al menos dos opciones', v_n);
                END IF;
            END IF;
            IF v_pre ? 'dimension' AND nullif(v_pre ->> 'dimension', '') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.encuesta_cliente_dimensiones WHERE clave = v_pre ->> 'dimension') THEN
                v_out := v_out || format('La pregunta %s mide una dimensión que no existe', v_n);
            END IF;
            -- Una condición sólo puede mirar una pregunta ANTERIOR: mirar una
            -- posterior es una pregunta que nunca se muestra.
            v_cond := v_pre -> 'condicion';
            IF v_cond IS NOT NULL AND jsonb_typeof(v_cond) = 'object'
               AND NOT ((v_cond ->> 'pregunta') = ANY (v_ids)) THEN
                v_out := v_out || format('La pregunta %s depende de una pregunta que no está antes', v_n);
            END IF;
            v_ids := v_ids || coalesce(v_pre ->> 'id', '');
        END LOOP;
    END LOOP;
    IF v_n = 0 THEN v_out := v_out || 'La encuesta no tiene preguntas'::text; END IF;

    IF p_enc.es_plantilla THEN RETURN v_out; END IF;

    IF coalesce(array_length(p_enc.canales, 1), 0) = 0 THEN
        v_out := v_out || 'Elige al menos una forma de aplicarla (QR, entrevista o tablet)'::text;
    END IF;
    SELECT count(*), count(*) FILTER (WHERE meta IS NULL) INTO v_suc, v_sinmeta
      FROM public.encuesta_cliente_sucursales WHERE encuesta_id = p_enc.id;
    IF v_suc = 0 THEN v_out := v_out || 'Elige al menos una sucursal'::text; END IF;
    IF p_enc.alcance = 'sucursales' AND v_sinmeta > 0 THEN
        v_out := v_out || 'Cada sucursal necesita su meta de respuestas'::text;
    END IF;
    -- Se cierra por tiempo o por muestra: sin ninguna de las dos no termina nunca.
    IF p_enc.fecha_fin IS NULL AND p_enc.meta_total IS NULL AND p_enc.alcance = 'general' THEN
        v_out := v_out || 'Define una fecha de cierre o una meta de respuestas'::text;
    END IF;
    IF p_enc.fecha_fin IS NOT NULL AND p_enc.fecha_fin < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
        v_out := v_out || 'La fecha de cierre ya pasó'::text;
    END IF;
    IF p_enc.incentivo_tipo = 'puntos' AND coalesce(p_enc.incentivo_puntos, 0) <= 0 THEN
        v_out := v_out || 'Indica cuántos puntos se dan por responder'::text;
    END IF;
    -- La muestra médica la entrega quien entrevista: la tablet corre sin
    -- sesión y no hay quién firme la entrega.
    IF p_enc.incentivo_tipo = 'muestra' AND NOT ('entrevista' = ANY (p_enc.canales)) THEN
        v_out := v_out || 'La muestra médica sólo se entrega en entrevista'::text;
    END IF;
    IF p_enc.incentivo_tipo = 'muestra' AND btrim(coalesce(p_enc.incentivo_descripcion, '')) = '' THEN
        v_out := v_out || 'Describe qué muestra médica se entrega'::text;
    END IF;
    RETURN v_out;
END $$;

REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_acreditar(uuid, bigint)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_muestra_entregada(uuid)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_asignar_incentivo(uuid, bigint)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_incentivos_de(uuid)              FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_acreditar(uuid, bigint)          TO service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_muestra_entregada(uuid)          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_asignar_incentivo(uuid, bigint)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_incentivos_de(uuid)              TO authenticated, service_role;
