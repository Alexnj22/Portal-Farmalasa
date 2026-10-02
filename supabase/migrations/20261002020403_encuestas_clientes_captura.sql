-- Encuestas a clientes — fase 2: la captura de respuestas.
-- Plan: docs/PLAN-ENCUESTAS-A-CLIENTES-2026-10-01.md
--
-- Tres canales, una sola puerta de escritura (`encuesta_cliente_registrar`):
--   · QR / enlace y tablet  → `encuesta_publica_responder`, SIN sesión: la
--     guarda es el token del QR (secreto por encuesta y sucursal).
--   · entrevista            → `encuesta_cliente_entrevistar`, con sesión y el
--     permiso `encuestas_aplicar`.
-- Las respuestas se validan ACÁ contra el cuestionario aprobado —el navegador
-- puede mandar cualquier cosa—, con la misma regla de condiciones que
-- `cumpleCondicion` de `src/utils/encuestasClientes.js` (la verdad es la de
-- JavaScript: ausente, null y '' no cumplen nada). Si una diverge de la otra,
-- el cliente contestaría un recorrido que la base rechaza.
SET lock_timeout = '5s';

-- ── Las respuestas (append-only) ───────────────────────────────────────────
-- El teléfono sólo se guarda con consentimiento (CHECK). `telefono_hash` es lo
-- que hace cumplir «una persona, una respuesta por encuesta» sin depender de
-- que el número esté escrito igual; también es la base del incentivo (fase 3).
CREATE TABLE public.encuesta_cliente_respuestas (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    encuesta_id       uuid NOT NULL REFERENCES public.encuestas_cliente(id) ON DELETE CASCADE,
    branch_id         integer NOT NULL REFERENCES public.branches(id),
    canal             text NOT NULL CHECK (canal IN ('qr','entrevista','kiosco')),
    entrevistador_id  uuid REFERENCES public.employees(id),
    respuestas        jsonb NOT NULL CHECK (jsonb_typeof(respuestas) = 'object'),
    nps               smallint CHECK (nps BETWEEN 0 AND 10),
    consentimiento_at timestamptz,
    contacto_nombre   text,
    telefono          text CHECK (telefono ~ '^[267][0-9]{7}$'),
    telefono_hash     text,
    customer_id       bigint REFERENCES public.customers(id) ON DELETE SET NULL,
    dispositivo       text,
    duracion_seg      integer CHECK (duracion_seg >= 0),
    created_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (telefono IS NULL OR consentimiento_at IS NOT NULL),
    CHECK (contacto_nombre IS NULL OR consentimiento_at IS NOT NULL)
);
CREATE INDEX encuesta_cliente_respuestas_encuesta_idx ON public.encuesta_cliente_respuestas (encuesta_id, created_at);
CREATE INDEX encuesta_cliente_respuestas_branch_idx ON public.encuesta_cliente_respuestas (branch_id);
CREATE INDEX encuesta_cliente_respuestas_entrevistador_idx ON public.encuesta_cliente_respuestas (entrevistador_id) WHERE entrevistador_id IS NOT NULL;
CREATE INDEX encuesta_cliente_respuestas_customer_idx ON public.encuesta_cliente_respuestas (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX encuesta_cliente_respuestas_dispositivo_idx ON public.encuesta_cliente_respuestas (encuesta_id, dispositivo, created_at) WHERE dispositivo IS NOT NULL;
CREATE UNIQUE INDEX encuesta_cliente_respuestas_una_por_telefono ON public.encuesta_cliente_respuestas (encuesta_id, telefono_hash) WHERE telefono_hash IS NOT NULL;

ALTER TABLE public.encuesta_cliente_respuestas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.encuesta_cliente_respuestas FROM anon, authenticated;
GRANT SELECT ON public.encuesta_cliente_respuestas TO authenticated;
GRANT ALL ON public.encuesta_cliente_respuestas TO service_role;
-- Leer las respuestas (con el contacto) es de quien ve el módulo. Escribir,
-- sólo por las funciones de abajo; nadie edita ni borra una respuesta.
CREATE POLICY encuesta_cliente_respuestas_select ON public.encuesta_cliente_respuestas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_view')));

-- ── ¿Se muestra esta pregunta? (gemela de `cumpleCondicion`) ───────────────
CREATE FUNCTION public.encuesta_cliente_cumple(p_cond jsonb, p_r jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, extensions AS $$
DECLARE
    v_r jsonb;
    v_v jsonb;
BEGIN
    IF p_cond IS NULL OR jsonb_typeof(p_cond) <> 'object' OR nullif(p_cond ->> 'pregunta', '') IS NULL THEN
        RETURN true;
    END IF;
    v_r := p_r -> (p_cond ->> 'pregunta');
    IF v_r IS NULL OR jsonb_typeof(v_r) = 'null' OR v_r = '""'::jsonb THEN RETURN false; END IF;
    v_v := p_cond -> 'valor';
    CASE p_cond ->> 'operador'
        WHEN '<=' THEN RETURN jsonb_typeof(v_r) = 'number' AND (v_r #>> '{}')::numeric <= (v_v #>> '{}')::numeric;
        WHEN '>=' THEN RETURN jsonb_typeof(v_r) = 'number' AND (v_r #>> '{}')::numeric >= (v_v #>> '{}')::numeric;
        WHEN '=' THEN
            IF jsonb_typeof(v_v) = 'boolean' THEN RETURN v_r = v_v; END IF;
            RETURN jsonb_typeof(v_r) = 'number' AND (v_r #>> '{}')::numeric = (v_v #>> '{}')::numeric;
        WHEN 'incluye' THEN
            IF jsonb_typeof(v_r) = 'array' THEN RETURN v_r @> jsonb_build_array(v_v); END IF;
            RETURN v_r = v_v;
        ELSE RETURN true;
    END CASE;
END $$;

-- ── Validar y limpiar lo que mandó el navegador ────────────────────────────
-- Devuelve sólo las respuestas de preguntas VISIBLES y bien formadas; lanza si
-- falta una obligatoria visible o si un valor no corresponde a su tipo. Lo que
-- quedó escondido por una condición se descarta: el cliente no lo vio.
CREATE FUNCTION public.encuesta_cliente_limpiar(p_cuestionario jsonb, p_r jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, extensions AS $$
DECLARE
    v_out  jsonb := '{}';
    v_pre  jsonb;
    v_id   text;
    v_tipo text;
    v_val  jsonb;
    v_ops  jsonb;
    v_n    integer := 0;
    v_vacio boolean;
    v_ok    boolean;
BEGIN
    IF p_r IS NULL OR jsonb_typeof(p_r) <> 'object' THEN RAISE EXCEPTION 'Respuestas inválidas'; END IF;
    FOR v_pre IN
        SELECT p FROM jsonb_array_elements(coalesce(p_cuestionario -> 'secciones', '[]')) s,
                      jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
    LOOP
        v_n := v_n + 1;
        v_id := v_pre ->> 'id';
        v_tipo := v_pre ->> 'tipo';
        -- La condición se evalúa con lo ya validado (preguntas anteriores).
        CONTINUE WHEN NOT public.encuesta_cliente_cumple(v_pre -> 'condicion', v_out);
        v_val := p_r -> v_id;
        v_vacio := v_val IS NULL OR jsonb_typeof(v_val) = 'null'
                   OR (jsonb_typeof(v_val) = 'string' AND btrim(v_val #>> '{}') = '')
                   OR (jsonb_typeof(v_val) = 'array' AND jsonb_array_length(v_val) = 0);
        IF v_vacio THEN
            IF coalesce((v_pre ->> 'obligatoria')::boolean, false) THEN
                RAISE EXCEPTION 'Falta contestar la pregunta %', v_n;
            END IF;
            CONTINUE;
        END IF;
        v_ops := coalesce((SELECT jsonb_agg(o -> 'id') FROM jsonb_array_elements(coalesce(v_pre -> 'opciones', '[]')) o
                            WHERE btrim(coalesce(o ->> 'texto', '')) <> ''), '[]');
        v_ok := CASE v_tipo
            WHEN 'nps'      THEN jsonb_typeof(v_val) = 'number' AND (v_val #>> '{}')::numeric IN (0,1,2,3,4,5,6,7,8,9,10)
            WHEN 'csat'     THEN jsonb_typeof(v_val) = 'number' AND (v_val #>> '{}')::numeric IN (1,2,3,4,5)
            WHEN 'likert'   THEN jsonb_typeof(v_val) = 'number' AND (v_val #>> '{}')::numeric IN (1,2,3,4,5)
            WHEN 'si_no'    THEN jsonb_typeof(v_val) = 'boolean'
            WHEN 'numero'   THEN jsonb_typeof(v_val) = 'number' AND abs((v_val #>> '{}')::numeric) < 1e9
            WHEN 'texto'    THEN jsonb_typeof(v_val) = 'string' AND length(v_val #>> '{}') <= 2000
            WHEN 'unica'    THEN jsonb_typeof(v_val) = 'string' AND v_ops @> jsonb_build_array(v_val)
            WHEN 'multiple' THEN jsonb_typeof(v_val) = 'array' AND v_ops @> v_val
                                 AND jsonb_array_length(v_val) = (SELECT count(DISTINCT e) FROM jsonb_array_elements(v_val) e)
            WHEN 'ranking'  THEN jsonb_typeof(v_val) = 'array' AND v_ops @> v_val AND v_val @> v_ops
                                 AND jsonb_array_length(v_val) = jsonb_array_length(v_ops)
            ELSE false END;
        -- En una variable y no en el IF: plpgsql corta la condición de un IF
        -- en el primer THEN, que sería el del primer WHEN.
        IF NOT coalesce(v_ok, false) THEN
            RAISE EXCEPTION 'La respuesta a la pregunta % no es válida', v_n;
        END IF;
        IF v_tipo = 'texto' THEN v_val := to_jsonb(btrim(v_val #>> '{}')); END IF;
        v_out := v_out || jsonb_build_object(v_id, v_val);
    END LOOP;
    RETURN v_out;
END $$;

-- ── La puerta única de escritura ───────────────────────────────────────────
-- No se expone: la llaman las dos de abajo, cada una con su guarda.
CREATE FUNCTION public.encuesta_cliente_registrar(
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

    v_cerrada := public.encuesta_cliente_cerrar_si_llego(p_enc.id);
    RETURN json_build_object('id', v_id, 'cerrada', v_cerrada);
END $$;

-- ── Se cierra sola al llegar a la meta ─────────────────────────────────────
-- General: el total contra `meta_total`. Por sucursal: TODAS sus cuotas.
CREATE FUNCTION public.encuesta_cliente_cerrar_si_llego(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_enc public.encuestas_cliente;
    v_llego boolean;
BEGIN
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v_enc.estado <> 'publicada' THEN RETURN false; END IF;
    IF v_enc.alcance = 'general' THEN
        v_llego := v_enc.meta_total IS NOT NULL
               AND (SELECT count(*) FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id) >= v_enc.meta_total;
    ELSE
        v_llego := NOT EXISTS (
            SELECT 1 FROM public.encuesta_cliente_sucursales s
             WHERE s.encuesta_id = p_id
               AND (s.meta IS NULL OR (SELECT count(*) FROM public.encuesta_cliente_respuestas r
                                        WHERE r.encuesta_id = p_id AND r.branch_id = s.branch_id) < s.meta));
    END IF;
    IF NOT v_llego THEN RETURN false; END IF;
    PERFORM set_config('encuestas.por_funcion', 'si', true);
    UPDATE public.encuestas_cliente
       SET estado = 'cerrada', cerrada_at = now(), cerrada_por = NULL, motivo_cierre = 'Llegó a la meta de respuestas'
     WHERE id = p_id;
    INSERT INTO public.encuesta_cliente_eventos (encuesta_id, tipo, comentario, autor_id)
    VALUES (p_id, 'cerrada', 'Llegó a la meta de respuestas', NULL);
    PERFORM set_config('encuestas.por_funcion', '', true);
    PERFORM public.encuesta_cliente_avisar(ARRAY[v_enc.created_by, v_enc.publicada_por],
        'Encuesta completa: ' || v_enc.nombre, 'Llegó a la meta de respuestas y se cerró sola.', p_id);
    RETURN true;
END $$;

-- ── …y al pasar su fecha (cron diario) ─────────────────────────────────────
CREATE FUNCTION public.encuesta_cliente_cerrar_vencidas()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_enc public.encuestas_cliente;
    v_n   integer := 0;
BEGIN
    FOR v_enc IN SELECT * FROM public.encuestas_cliente
                  WHERE estado = 'publicada' AND fecha_fin IS NOT NULL AND fecha_fin < v_hoy FOR UPDATE LOOP
        PERFORM set_config('encuestas.por_funcion', 'si', true);
        UPDATE public.encuestas_cliente
           SET estado = 'cerrada', cerrada_at = now(), cerrada_por = NULL, motivo_cierre = 'Llegó la fecha de cierre'
         WHERE id = v_enc.id;
        INSERT INTO public.encuesta_cliente_eventos (encuesta_id, tipo, comentario, autor_id)
        VALUES (v_enc.id, 'cerrada', 'Llegó la fecha de cierre', NULL);
        PERFORM set_config('encuestas.por_funcion', '', true);
        PERFORM public.encuesta_cliente_avisar(ARRAY[v_enc.created_by, v_enc.publicada_por],
            'Encuesta cerrada: ' || v_enc.nombre, 'Llegó su fecha de cierre.', v_enc.id);
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END $$;

-- ── Canal público: QR y tablet ─────────────────────────────────────────────
-- Lo que necesita el formulario, y nada más: ni el contacto de nadie ni el
-- avance. Sin una encuesta abierta devuelve sólo el motivo.
CREATE FUNCTION public.encuesta_publica(p_token text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_s   public.encuesta_cliente_sucursales;
    v_enc public.encuestas_cliente;
    v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_estado text;
BEGIN
    SELECT * INTO v_s FROM public.encuesta_cliente_sucursales WHERE token = p_token;
    IF NOT FOUND THEN RETURN json_build_object('estado', 'no_existe'); END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = v_s.encuesta_id;
    v_estado := CASE
        WHEN v_enc.estado = 'cerrada' OR (v_enc.estado = 'publicada' AND v_enc.fecha_fin IS NOT NULL AND v_hoy > v_enc.fecha_fin) THEN 'cerrada'
        WHEN v_enc.estado <> 'publicada' THEN 'no_disponible'
        WHEN v_enc.fecha_inicio IS NOT NULL AND v_hoy < v_enc.fecha_inicio THEN 'aun_no'
        ELSE 'abierta' END;
    IF v_estado <> 'abierta' THEN
        RETURN json_build_object('estado', v_estado, 'nombre', v_enc.nombre, 'mensaje_cierre', v_enc.mensaje_cierre);
    END IF;
    RETURN json_build_object(
        'estado', 'abierta',
        'nombre', v_enc.nombre,
        'sucursal', (SELECT name FROM public.branches WHERE id = v_s.branch_id),
        'canales', v_enc.canales,
        'cuestionario', v_enc.cuestionario,
        'mensaje_bienvenida', v_enc.mensaje_bienvenida,
        'mensaje_cierre', v_enc.mensaje_cierre,
        'texto_consentimiento', v_enc.texto_consentimiento,
        -- La muestra médica la entrega una persona: en el canal público sólo
        -- se anuncia el incentivo de puntos.
        'incentivo_tipo', CASE WHEN v_enc.incentivo_tipo = 'puntos' THEN 'puntos' ELSE 'ninguno' END,
        'incentivo_puntos', CASE WHEN v_enc.incentivo_tipo = 'puntos' THEN v_enc.incentivo_puntos END,
        'incentivo_descripcion', CASE WHEN v_enc.incentivo_tipo = 'puntos' THEN v_enc.incentivo_descripcion END);
END $$;

CREATE FUNCTION public.encuesta_publica_responder(
    p_token text, p_respuestas jsonb, p_contacto jsonb DEFAULT NULL, p_dispositivo text DEFAULT NULL,
    p_duracion integer DEFAULT NULL, p_modo text DEFAULT 'qr')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_s   public.encuesta_cliente_sucursales;
    v_enc public.encuestas_cliente;
BEGIN
    SELECT * INTO v_s FROM public.encuesta_cliente_sucursales WHERE token = p_token;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esta encuesta no existe'; END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = v_s.encuesta_id FOR UPDATE;
    RETURN public.encuesta_cliente_registrar(v_enc, v_s.branch_id,
        CASE WHEN p_modo = 'tablet' THEN 'kiosco' ELSE 'qr' END,
        p_respuestas, p_contacto, p_dispositivo, p_duracion, NULL);
END $$;

-- ── Canal de entrevista ────────────────────────────────────────────────────
CREATE FUNCTION public.encuesta_cliente_entrevistar(
    p_id uuid, p_branch integer, p_respuestas jsonb, p_contacto jsonb DEFAULT NULL, p_duracion integer DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    IF NOT (public.auth_has_module_permission('encuestas_aplicar','can_view')
            OR public.auth_has_module_permission('encuestas_clientes','can_edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN: aplicar encuestas exige el permiso «Aplicar encuestas»';
    END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;
    RETURN public.encuesta_cliente_registrar(v_enc, p_branch, 'entrevista',
        p_respuestas, p_contacto, NULL, p_duracion, public.auth_employee_id());
END $$;

-- Las encuestas que se pueden aplicar HOY, con sus sucursales y el token de
-- cada una (para abrir la tablet). Para quien entrevista, que no ve el módulo.
CREATE FUNCTION public.encuestas_para_aplicar()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
    IF NOT (public.auth_has_module_permission('encuestas_aplicar','can_view')
            OR public.auth_has_module_permission('encuestas_clientes','can_edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'id', e.id, 'nombre', e.nombre, 'objetivo', e.objetivo, 'canales', e.canales,
                   'cuestionario', e.cuestionario, 'mensaje_bienvenida', e.mensaje_bienvenida,
                   'mensaje_cierre', e.mensaje_cierre, 'texto_consentimiento', e.texto_consentimiento,
                   'incentivo_tipo', e.incentivo_tipo, 'incentivo_puntos', e.incentivo_puntos,
                   'incentivo_descripcion', e.incentivo_descripcion, 'fecha_fin', e.fecha_fin,
                   'sucursales', (SELECT coalesce(json_agg(json_build_object(
                                      'branch_id', s.branch_id, 'nombre', b.name, 'token', s.token, 'meta', s.meta,
                                      'respuestas', (SELECT count(*) FROM public.encuesta_cliente_respuestas r
                                                      WHERE r.encuesta_id = e.id AND r.branch_id = s.branch_id))
                                      ORDER BY b.name), '[]'::json)
                                    FROM public.encuesta_cliente_sucursales s JOIN public.branches b ON b.id = s.branch_id
                                   WHERE s.encuesta_id = e.id)
               ) ORDER BY e.publicada_at DESC), '[]'::json)
          FROM public.encuestas_cliente e
         WHERE e.estado = 'publicada'
           AND (e.fecha_inicio IS NULL OR e.fecha_inicio <= v_hoy)
           AND (e.fecha_fin IS NULL OR e.fecha_fin >= v_hoy)
    );
END $$;

-- ── El avance (para el módulo) ─────────────────────────────────────────────
CREATE FUNCTION public.encuesta_cliente_avance(p_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN json_build_object(
        'total', (SELECT count(*) FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id),
        'hoy', (SELECT count(*) FROM public.encuesta_cliente_respuestas
                 WHERE encuesta_id = p_id AND (created_at AT TIME ZONE 'America/El_Salvador')::date = v_hoy),
        'con_contacto', (SELECT count(*) FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id AND consentimiento_at IS NOT NULL),
        'ultima', (SELECT max(created_at) FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id),
        'por_sucursal', (SELECT coalesce(json_agg(json_build_object(
                             'branch_id', s.branch_id, 'nombre', b.name, 'meta', s.meta, 'token', s.token,
                             'respuestas', (SELECT count(*) FROM public.encuesta_cliente_respuestas r
                                             WHERE r.encuesta_id = p_id AND r.branch_id = s.branch_id)) ORDER BY b.name), '[]'::json)
                           FROM public.encuesta_cliente_sucursales s JOIN public.branches b ON b.id = s.branch_id
                          WHERE s.encuesta_id = p_id),
        'por_canal', (SELECT coalesce(json_object_agg(canal, n), '{}'::json)
                        FROM (SELECT canal, count(*) n FROM public.encuesta_cliente_respuestas
                               WHERE encuesta_id = p_id GROUP BY canal) c),
        'por_dia', (SELECT coalesce(json_agg(json_build_object('dia', dia, 'n', n) ORDER BY dia), '[]'::json)
                      FROM (SELECT (created_at AT TIME ZONE 'America/El_Salvador')::date dia, count(*) n
                              FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id GROUP BY 1) d)
    );
END $$;

-- ── Permisos de ejecución ──────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_cumple(jsonb, jsonb)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_limpiar(jsonb, jsonb)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_registrar(public.encuestas_cliente, integer, text, jsonb, jsonb, text, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_cerrar_si_llego(uuid)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_cerrar_vencidas()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_publica(text)                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encuesta_publica_responder(text, jsonb, jsonb, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_entrevistar(uuid, integer, jsonb, jsonb, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuestas_para_aplicar()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_avance(uuid)           FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_cumple(jsonb, jsonb)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_limpiar(jsonb, jsonb)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_registrar(public.encuestas_cliente, integer, text, jsonb, jsonb, text, integer, uuid) TO service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_cerrar_si_llego(uuid)  TO service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_cerrar_vencidas()      TO service_role;
-- Las dos públicas: `anon` A PROPÓSITO. Guarda: el token del QR. Declaradas
-- en `auditoria/superficie-anon.json`.
GRANT  EXECUTE ON FUNCTION public.encuesta_publica(text)                  TO anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_publica_responder(text, jsonb, jsonb, text, integer, text) TO anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_entrevistar(uuid, integer, jsonb, jsonb, integer) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuestas_para_aplicar()                TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_avance(uuid)           TO authenticated, service_role;

-- ── El cron del cierre por fecha ───────────────────────────────────────────
-- 00:10 SV (06:10 UTC): el día de cierre todavía recibe respuestas completo.
SELECT cron.schedule('encuestas-cerrar-vencidas', '10 6 * * *', $c$SELECT public.encuesta_cliente_cerrar_vencidas()$c$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encuestas-cerrar-vencidas');

-- ── Permiso «Aplicar encuestas» ────────────────────────────────────────────
-- Para quien entrevista en sala sin ver el módulo entero. Arranque; se
-- ajusta en Permisos.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'encuestas_aplicar', true, false, false, 'ALL'
  FROM public.roles r
 WHERE r.name IN ('Gerente General', 'Administrador', 'Agente de Atencion de Canales Digitales',
                  'Supervisor/a de Ventas', 'Jefe/a de Sala')
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.module_key = 'encuestas_aplicar');
