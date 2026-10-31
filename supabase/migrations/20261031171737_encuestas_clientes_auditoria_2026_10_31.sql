-- Encuestas a clientes — correcciones de la auditoría del 2026-10-31.
--
-- 1. Dimensión «Experiencia en la app»: la encuesta de la app medía `app` y
--    `general`, que no existían, y por eso no se podía enviar a revisión.
-- 2. La tablet tiene su PROPIO token (`token_tablet`). Antes el modo lo decía
--    el navegador con `?modo=tablet`: cualquiera con el QR se saltaba el tope
--    de 3 respuestas por día. Ahora el canal sale del token que entró.
-- 3. Una respuesta se envía con una referencia (`ref`) que genera quien la
--    contesta: reintentar después de un corte de red devuelve la misma
--    respuesta en vez de guardar otra.
-- 4. El respiro de la tablet baja a 5 s: todos los clientes de la sala
--    comparten el mismo dispositivo.
-- 5. La revisión previa caza tres encuestas que nadie podía contestar bien:
--    opciones con texto vacío, condiciones que no corresponden a la pregunta
--    que miran, y la app sin puntos (la app siempre los ofrece).
-- 6. El CSV trae la sucursal por id para poder exportar sólo la filtrada.

SET lock_timeout = '5s';

-- ── 1. Dimensión de la app ─────────────────────────────────────────────────
INSERT INTO public.encuesta_cliente_dimensiones (clave, nombre, descripcion, color, activo, orden)
VALUES ('app', 'Experiencia en la app', 'Qué usa y qué le falta a la app de clientes', 'chart-2', true, 8)
ON CONFLICT (clave) DO NOTHING;

-- La pregunta de cierre medía «general», que no es un tema: deja de medir.
UPDATE public.encuestas_cliente e
   SET cuestionario = jsonb_set(e.cuestionario, '{secciones}', (
        SELECT jsonb_agg(jsonb_set(s, '{preguntas}', coalesce((
                   SELECT jsonb_agg(CASE WHEN p ->> 'dimension' = 'general' THEN p - 'dimension' ELSE p END ORDER BY o)
                     FROM jsonb_array_elements(s -> 'preguntas') WITH ORDINALITY x(p, o)), '[]'::jsonb)) ORDER BY so)
          FROM jsonb_array_elements(e.cuestionario -> 'secciones') WITH ORDINALITY y(s, so)))
 WHERE e.estado = 'borrador'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.cuestionario -> 'secciones') s,
                             jsonb_array_elements(s -> 'preguntas') p
                WHERE p ->> 'dimension' = 'general');

-- ── 2 y 3. Columnas ────────────────────────────────────────────────────────
ALTER TABLE public.encuesta_cliente_sucursales
    ADD COLUMN IF NOT EXISTS token_tablet text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
CREATE UNIQUE INDEX IF NOT EXISTS encuesta_cliente_sucursales_token_tablet_key
    ON public.encuesta_cliente_sucursales (token_tablet);

ALTER TABLE public.encuesta_cliente_respuestas ADD COLUMN IF NOT EXISTS ref uuid;
CREATE UNIQUE INDEX IF NOT EXISTS encuesta_cliente_respuestas_ref_key
    ON public.encuesta_cliente_respuestas (encuesta_id, ref) WHERE ref IS NOT NULL;

-- ── La encuesta pública: el canal lo decide el token ───────────────────────
CREATE OR REPLACE FUNCTION public.encuesta_publica(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_s   public.encuesta_cliente_sucursales;
    v_enc public.encuestas_cliente;
    v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_estado text;
    v_modo text;
BEGIN
    SELECT * INTO v_s FROM public.encuesta_cliente_sucursales WHERE token = p_token;
    IF FOUND THEN
        v_modo := 'qr';
    ELSE
        SELECT * INTO v_s FROM public.encuesta_cliente_sucursales WHERE token_tablet = p_token;
        IF NOT FOUND THEN RETURN json_build_object('estado', 'no_existe'); END IF;
        v_modo := 'tablet';
    END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = v_s.encuesta_id;
    v_estado := CASE
        WHEN v_enc.estado = 'cerrada' OR (v_enc.estado = 'publicada' AND v_enc.fecha_fin IS NOT NULL AND v_hoy > v_enc.fecha_fin) THEN 'cerrada'
        WHEN v_enc.estado <> 'publicada' THEN 'no_disponible'
        WHEN v_enc.fecha_inicio IS NOT NULL AND v_hoy < v_enc.fecha_inicio THEN 'aun_no'
        -- El token de la tablet sólo abre si la encuesta se aplica en tablet.
        WHEN NOT ((CASE v_modo WHEN 'tablet' THEN 'kiosco' ELSE 'qr' END) = ANY (v_enc.canales)) THEN 'no_disponible'
        ELSE 'abierta' END;
    IF v_estado <> 'abierta' THEN
        RETURN json_build_object('estado', v_estado, 'modo', v_modo, 'nombre', v_enc.nombre, 'mensaje_cierre', v_enc.mensaje_cierre);
    END IF;
    RETURN json_build_object(
        'estado', 'abierta',
        'modo', v_modo,
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
END $function$;

-- ── El registro común, con la referencia ───────────────────────────────────
DROP FUNCTION IF EXISTS public.encuesta_publica_responder(text, jsonb, jsonb, text, integer, text);
DROP FUNCTION IF EXISTS public.encuesta_cliente_entrevistar(uuid, integer, jsonb, jsonb, integer);
DROP FUNCTION IF EXISTS public.encuesta_cliente_registrar(public.encuestas_cliente, integer, text, jsonb, jsonb, text, integer, uuid);

CREATE FUNCTION public.encuesta_cliente_registrar(p_enc encuestas_cliente, p_branch integer, p_canal text, p_respuestas jsonb, p_contacto jsonb, p_dispositivo text, p_duracion integer, p_entrevistador uuid, p_ref uuid DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
        contacto_nombre, telefono, telefono_hash, customer_id, dispositivo, duracion_seg, ref)
    VALUES (
        p_enc.id, p_branch, p_canal, p_entrevistador, v_limpias, v_nps,
        CASE WHEN v_consiente THEN now() END,
        CASE WHEN v_consiente THEN v_nombre END, CASE WHEN v_consiente THEN v_tel END,
        CASE WHEN v_consiente THEN v_hash END, CASE WHEN v_consiente THEN v_cliente END,
        left(p_dispositivo, 64), CASE WHEN p_duracion BETWEEN 0 AND 86400 THEN p_duracion END, p_ref)
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
END $function$;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_registrar(encuestas_cliente, integer, text, jsonb, jsonb, text, integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_registrar(encuestas_cliente, integer, text, jsonb, jsonb, text, integer, uuid, uuid) TO service_role;

-- `p_modo` se conserva en la firma para no romper a quien todavía lo manda,
-- pero ya no decide nada: el canal sale del token.
CREATE FUNCTION public.encuesta_publica_responder(p_token text, p_respuestas jsonb, p_contacto jsonb DEFAULT NULL::jsonb, p_dispositivo text DEFAULT NULL::text, p_duracion integer DEFAULT NULL::integer, p_modo text DEFAULT NULL::text, p_ref uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_s     public.encuesta_cliente_sucursales;
    v_enc   public.encuestas_cliente;
    v_canal text;
    v_tope  integer;
BEGIN
    SELECT * INTO v_s FROM public.encuesta_cliente_sucursales WHERE token = p_token;
    IF FOUND THEN
        v_canal := 'qr';
    ELSE
        SELECT * INTO v_s FROM public.encuesta_cliente_sucursales WHERE token_tablet = p_token;
        IF NOT FOUND THEN RAISE EXCEPTION 'Esta encuesta no existe'; END IF;
        v_canal := 'kiosco';
    END IF;
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
        p_respuestas, p_contacto, p_dispositivo, p_duracion, NULL, p_ref);
END $function$;
REVOKE EXECUTE ON FUNCTION public.encuesta_publica_responder(text, jsonb, jsonb, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encuesta_publica_responder(text, jsonb, jsonb, text, integer, text, uuid) TO anon, authenticated, service_role;

CREATE FUNCTION public.encuesta_cliente_entrevistar(p_id uuid, p_branch integer, p_respuestas jsonb, p_contacto jsonb DEFAULT NULL::jsonb, p_duracion integer DEFAULT NULL::integer, p_ref uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    IF NOT (public.auth_has_module_permission('encuestas_aplicar','can_view')
            OR public.auth_has_module_permission('encuestas_clientes','can_edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN: aplicar encuestas exige el permiso «Aplicar encuestas»';
    END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;
    RETURN public.encuesta_cliente_registrar(v_enc, p_branch, 'entrevista',
        p_respuestas, p_contacto, NULL, p_duracion, public.auth_employee_id(), p_ref);
END $function$;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_entrevistar(uuid, integer, jsonb, jsonb, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_entrevistar(uuid, integer, jsonb, jsonb, integer, uuid) TO authenticated, service_role;

-- ── Los enlaces de la tablet en el avance y en «aplicar» ───────────────────
CREATE OR REPLACE FUNCTION public.encuesta_cliente_avance(p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
                             'token_tablet', s.token_tablet,
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
END $function$;

CREATE OR REPLACE FUNCTION public.encuestas_para_aplicar()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
                                      'branch_id', s.branch_id, 'nombre', b.name, 'token', s.token,
                                      'token_tablet', s.token_tablet, 'meta', s.meta,
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
END $function$;

-- ── El CSV con la sucursal por id ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.encuesta_cliente_respuestas_para_exportar(p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'fecha', r.created_at, 'branch_id', r.branch_id, 'sucursal', b.name, 'canal', r.canal, 'nps', r.nps,
                   'respuestas', r.respuestas, 'contacto_nombre', r.contacto_nombre, 'telefono', r.telefono,
                   'entrevistador', e.name, 'duracion_seg', r.duracion_seg) ORDER BY r.created_at), '[]'::json)
          FROM public.encuesta_cliente_respuestas r
          JOIN public.branches b ON b.id = r.branch_id
          LEFT JOIN public.employees e ON e.id = r.entrevistador_id
         WHERE r.encuesta_id = p_id
    );
END $function$;

-- ── 5. La revisión previa ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.encuesta_cliente_problemas_de(p_enc encuestas_cliente)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_out    text[] := '{}';
    v_sec    jsonb;
    v_pre    jsonb;
    v_ids    text[] := '{}';
    v_vistas jsonb := '{}';   -- id → pregunta, de las ANTERIORES
    v_n      integer := 0;
    v_ns     integer := 0;
    v_tipo   text;
    v_cond   jsonb;
    v_mira   jsonb;
    v_mtipo  text;
    v_op     text;
    v_val    jsonb;
    v_ok     boolean;
    v_ops    integer;
    v_vacias integer;
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
                SELECT count(*) FILTER (WHERE btrim(coalesce(o ->> 'texto', '')) <> ''),
                       count(*) FILTER (WHERE btrim(coalesce(o ->> 'texto', '')) = '')
                  INTO v_ops, v_vacias
                  FROM jsonb_array_elements(coalesce(v_pre -> 'opciones', '[]')) o;
                IF v_ops < 2 THEN
                    v_out := v_out || format('La pregunta %s necesita al menos dos opciones', v_n);
                END IF;
                -- Una opción en blanco no se muestra, pero el ordenar la exige
                -- y la rechazaría siempre: se escribe o se quita.
                IF v_vacias > 0 THEN
                    v_out := v_out || format('La pregunta %s tiene una opción sin texto', v_n);
                END IF;
            END IF;
            IF v_pre ? 'dimension' AND nullif(v_pre ->> 'dimension', '') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.encuesta_cliente_dimensiones WHERE clave = v_pre ->> 'dimension') THEN
                v_out := v_out || format('La pregunta %s mide una dimensión que no existe', v_n);
            END IF;
            -- Una condición sólo puede mirar una pregunta ANTERIOR: mirar una
            -- posterior es una pregunta que nunca se muestra.
            v_cond := v_pre -> 'condicion';
            IF v_cond IS NOT NULL AND jsonb_typeof(v_cond) = 'object' THEN
                IF NOT ((v_cond ->> 'pregunta') = ANY (v_ids)) THEN
                    v_out := v_out || format('La pregunta %s depende de una pregunta que no está antes', v_n);
                ELSE
                    -- Y tiene que poder cumplirse: el operador y el valor del
                    -- tipo de la pregunta que mira (los mismos de
                    -- `encuesta_cliente_cumple` y de `operadoresPara`).
                    v_mira := v_vistas -> (v_cond ->> 'pregunta');
                    v_mtipo := v_mira ->> 'tipo';
                    v_op := v_cond ->> 'operador';
                    v_val := v_cond -> 'valor';
                    v_ok := CASE
                        WHEN v_mtipo IN ('nps','csat','likert','numero') THEN
                            v_op IN ('<=','>=','=') AND jsonb_typeof(v_val) = 'number'
                        WHEN v_mtipo = 'si_no' THEN v_op = '=' AND jsonb_typeof(v_val) = 'boolean'
                        WHEN v_mtipo IN ('unica','multiple') THEN
                            v_op = 'incluye' AND EXISTS (
                                SELECT 1 FROM jsonb_array_elements(coalesce(v_mira -> 'opciones', '[]')) o
                                 WHERE o -> 'id' = v_val AND btrim(coalesce(o ->> 'texto', '')) <> '')
                        ELSE false END;
                    IF NOT coalesce(v_ok, false) THEN
                        v_out := v_out || format('La condición de la pregunta %s no corresponde a la pregunta que mira', v_n);
                    END IF;
                END IF;
            END IF;
            v_ids := v_ids || coalesce(v_pre ->> 'id', '');
            IF coalesce(v_pre ->> 'id', '') <> '' THEN v_vistas := v_vistas || jsonb_build_object(v_pre ->> 'id', v_pre); END IF;
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
    -- La app de clientes siempre ofrece puntos por contestar: se declaran
    -- acá, no los pone un valor escondido.
    IF 'app' = ANY (p_enc.canales) AND p_enc.incentivo_tipo <> 'puntos' THEN
        v_out := v_out || 'En la app siempre se dan puntos: elige el incentivo «Puntos» e indica cuántos'::text;
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
END $function$;
