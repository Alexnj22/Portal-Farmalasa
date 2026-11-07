-- Encuestas a clientes: canal «En campo» con ubicación (pedido del usuario
-- 2026-11-07). Un encuestador (p. ej. un practicante) aplica la encuesta fuera
-- de las sucursales: la respuesta no tiene sala (branch_id NULL), lleva el
-- lugar que escribió y las coordenadas del teléfono, y en Resultados «Campo»
-- es una fila más (branch_id -1 en los filtros: 0 ya significa «todas» en los
-- resúmenes).
--
-- Las funciones que sólo cambian un filtro se reescriben desde su definición
-- VIVA (pg_get_functiondef + replace, y falla si el reemplazo no encontró el
-- texto): así no se pisa nada que otra sesión haya cambiado.
-- jsonb-agg: registrar conserva el agregado de ids de opciones de la definición viva (un puñado).
SET lock_timeout = '5s';

-- ── La forma ───────────────────────────────────────────────────────────────
ALTER TABLE public.encuestas_cliente DROP CONSTRAINT encuestas_cliente_canales_check;
ALTER TABLE public.encuestas_cliente ADD CONSTRAINT encuestas_cliente_canales_check
    CHECK (canales <@ ARRAY['qr','entrevista','kiosco','app','campo']);

ALTER TABLE public.encuesta_cliente_respuestas DROP CONSTRAINT encuesta_cliente_respuestas_canal_check;
ALTER TABLE public.encuesta_cliente_respuestas ADD CONSTRAINT encuesta_cliente_respuestas_canal_check
    CHECK (canal = ANY (ARRAY['qr','entrevista','kiosco','app','campo']));
ALTER TABLE public.encuesta_cliente_respuestas ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE public.encuesta_cliente_respuestas
    ADD COLUMN lugar text,
    ADD COLUMN lat double precision,
    ADD COLUMN lng double precision,
    ADD COLUMN precision_m integer;
COMMENT ON COLUMN public.encuesta_cliente_respuestas.lugar IS 'Campo: el lugar que escribió el encuestador («Mercado de Soyapango»).';
COMMENT ON COLUMN public.encuesta_cliente_respuestas.lat IS 'Campo: latitud del teléfono del encuestador al guardar.';
-- Sin sala si y sólo si es de campo; y una de campo dice dónde se hizo.
ALTER TABLE public.encuesta_cliente_respuestas ADD CONSTRAINT encuesta_cliente_respuestas_sala_o_campo
    CHECK ((canal = 'campo') = (branch_id IS NULL));
ALTER TABLE public.encuesta_cliente_respuestas ADD CONSTRAINT encuesta_cliente_respuestas_campo_donde
    CHECK (canal <> 'campo' OR lugar IS NOT NULL OR lat IS NOT NULL);
ALTER TABLE public.encuesta_cliente_respuestas ADD CONSTRAINT encuesta_cliente_respuestas_coordenadas
    CHECK ((lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)));
ALTER TABLE public.encuesta_cliente_respuestas ADD CONSTRAINT encuesta_cliente_respuestas_lugar_largo
    CHECK (lugar IS NULL OR length(lugar) BETWEEN 1 AND 120);

-- ── Registrar: recibe la ubicación ─────────────────────────────────────────
-- Cambia la firma (un parámetro al final, con default): se borra la vieja
-- para no dejar una sobrecarga con sus permisos. Los tres que la llaman la
-- invocan por posición con 8-9 argumentos y siguen igual.
DROP FUNCTION public.encuesta_cliente_registrar(public.encuestas_cliente, integer, text, jsonb, jsonb, text, integer, uuid, uuid);

CREATE FUNCTION public.encuesta_cliente_registrar(p_enc encuestas_cliente, p_branch integer, p_canal text, p_respuestas jsonb, p_contacto jsonb, p_dispositivo text, p_duracion integer, p_entrevistador uuid, p_ref uuid DEFAULT NULL::uuid, p_ubicacion jsonb DEFAULT NULL::jsonb)
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
    v_lugar    text;
    v_lat      double precision;
    v_lng      double precision;
    v_prec     integer;
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
    IF p_canal = 'campo' THEN
        -- En campo no hay sala: dónde se hizo lo dicen el lugar y las coordenadas.
        IF p_branch IS NOT NULL THEN RAISE EXCEPTION 'Una encuesta de campo no lleva sucursal'; END IF;
        v_lugar := nullif(left(regexp_replace(btrim(coalesce(p_ubicacion ->> 'lugar', '')), '\s+', ' ', 'g'), 120), '');
        IF jsonb_typeof(p_ubicacion -> 'lat') = 'number' AND jsonb_typeof(p_ubicacion -> 'lng') = 'number'
           AND (p_ubicacion ->> 'lat')::double precision BETWEEN -90 AND 90
           AND (p_ubicacion ->> 'lng')::double precision BETWEEN -180 AND 180 THEN
            v_lat := (p_ubicacion ->> 'lat')::double precision;
            v_lng := (p_ubicacion ->> 'lng')::double precision;
            IF jsonb_typeof(p_ubicacion -> 'precision') = 'number' THEN
                v_prec := least(greatest(round((p_ubicacion ->> 'precision')::numeric), 0), 100000)::integer;
            END IF;
        END IF;
        IF v_lugar IS NULL AND v_lat IS NULL THEN
            RAISE EXCEPTION 'Escribe el lugar donde estás haciendo la encuesta';
        END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.encuesta_cliente_sucursales WHERE encuesta_id = p_enc.id AND branch_id = p_branch) THEN
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
        contacto_nombre, telefono, telefono_hash, customer_id, dispositivo, duracion_seg, ref, mes,
        lugar, lat, lng, precision_m)
    VALUES (
        p_enc.id, p_branch, p_canal, p_entrevistador, v_limpias, v_nps,
        CASE WHEN v_consiente THEN now() END,
        CASE WHEN v_consiente THEN v_nombre END, CASE WHEN v_consiente THEN v_tel END,
        CASE WHEN v_consiente THEN v_hash END, CASE WHEN v_consiente THEN v_cliente END,
        left(p_dispositivo, 64), CASE WHEN p_duracion BETWEEN 0 AND 86400 THEN p_duracion END, p_ref, v_mes,
        v_lugar, v_lat, v_lng, v_prec)
    RETURNING id INTO v_id;

    -- ── El incentivo (fase 3) ──────────────────────────────────────────────
    -- Sólo con TELÉFONO y consentimiento: es lo que lo hace uno por persona.
    -- La muestra médica, además, sólo en persona (entrevista o campo): alguien tiene que darla.
    IF v_consiente AND v_tel IS NOT NULL THEN
        IF p_enc.incentivo_tipo = 'puntos' AND p_enc.incentivo_puntos > 0 THEN
            INSERT INTO public.encuesta_cliente_incentivos (respuesta_id, encuesta_id, tipo, estado, puntos, mes, motivo)
            VALUES (v_id, p_enc.id, 'puntos', 'pendiente', p_enc.incentivo_puntos, v_mes,
                    CASE WHEN v_cliente IS NULL THEN 'El teléfono no corresponde a una sola ficha' END)
            RETURNING id INTO v_inc;
            v_inc_estado := public.encuesta_cliente_acreditar(v_inc, v_cliente);
        ELSIF p_enc.incentivo_tipo = 'muestra' AND p_canal IN ('entrevista','campo') THEN
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
REVOKE ALL ON FUNCTION public.encuesta_cliente_registrar(public.encuestas_cliente, integer, text, jsonb, jsonb, text, integer, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_registrar(public.encuestas_cliente, integer, text, jsonb, jsonb, text, integer, uuid, uuid, jsonb) TO service_role;

-- ── Entrevistar en campo ───────────────────────────────────────────────────
-- La misma guarda que `encuesta_cliente_entrevistar`; quien entrevista lo
-- firma la base.
CREATE FUNCTION public.encuesta_cliente_entrevistar_campo(p_id uuid, p_respuestas jsonb, p_ubicacion jsonb, p_contacto jsonb DEFAULT NULL::jsonb, p_duracion integer DEFAULT NULL::integer, p_ref uuid DEFAULT NULL::uuid)
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
    RETURN public.encuesta_cliente_registrar(v_enc, NULL, 'campo',
        p_respuestas, p_contacto, NULL, p_duracion, public.auth_employee_id(), p_ref, p_ubicacion);
END $function$;
REVOKE ALL ON FUNCTION public.encuesta_cliente_entrevistar_campo(uuid, jsonb, jsonb, jsonb, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_entrevistar_campo(uuid, jsonb, jsonb, jsonb, integer, uuid) TO authenticated, service_role;

-- ── Dónde se hizo: puntos y lugares ────────────────────────────────────────
CREATE FUNCTION public.encuesta_cliente_ubicaciones(p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN json_build_object(
        'puntos', (SELECT coalesce(json_agg(json_build_object(
                       'lat', r.lat, 'lng', r.lng, 'precision_m', r.precision_m, 'lugar', r.lugar,
                       'nps', r.nps, 'fecha', r.created_at) ORDER BY r.created_at), '[]'::json)
                     FROM public.encuesta_cliente_respuestas r
                    WHERE r.encuesta_id = p_id AND r.canal = 'campo' AND r.lat IS NOT NULL),
        -- Por lugar escrito, sin distinguir mayúsculas ni espacios de sobra.
        'por_lugar', (SELECT coalesce(json_agg(json_build_object(
                          'lugar', x.lugar, 'respuestas', x.n, 'con_nps', x.con_nps, 'nps', x.nps,
                          'lat', x.lat, 'lng', x.lng, 'desde', x.desde, 'hasta', x.hasta) ORDER BY x.n DESC), '[]'::json)
                        FROM (SELECT coalesce((array_agg(r.lugar ORDER BY r.created_at))[1], 'Sin nombre') lugar, count(*) n, count(r.nps) con_nps,
                                     CASE WHEN count(r.nps) > 0 THEN round((count(*) FILTER (WHERE r.nps >= 9)
                                          - count(*) FILTER (WHERE r.nps <= 6)) * 100.0 / count(r.nps)) END nps,
                                     avg(r.lat) lat, avg(r.lng) lng, min(r.created_at) desde, max(r.created_at) hasta
                                FROM public.encuesta_cliente_respuestas r
                               WHERE r.encuesta_id = p_id AND r.canal = 'campo'
                               GROUP BY lower(regexp_replace(btrim(coalesce(r.lugar, '')), '\s+', ' ', 'g'))) x)
    );
END $function$;
REVOKE ALL ON FUNCTION public.encuesta_cliente_ubicaciones(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_ubicaciones(uuid) TO authenticated, service_role;

-- ── Las que sólo cambian un filtro: desde la definición viva ──────────────
DO $migracion$
DECLARE
    d text; n text;
    -- [función, buscar, reemplazar]
    c text[];
    cambios text[][] := ARRAY[
        ['public.encuesta_cliente_resultados(uuid,integer)',
         '(p_branch IS NULL OR branch_id = p_branch)',
         '(p_branch IS NULL OR branch_id IS NOT DISTINCT FROM nullif(p_branch, -1))'],
        ['public.encuesta_cliente_resultados(uuid,integer)',
         'json_build_object(''branch_id'', x.branch_id, ''nombre'', b.name,',
         'json_build_object(''branch_id'', coalesce(x.branch_id, -1), ''nombre'', coalesce(b.name, ''Campo''),'],
        ['public.encuesta_cliente_resultados(uuid,integer)',
         'JOIN public.branches b ON b.id = x.branch_id)',
         'LEFT JOIN public.branches b ON b.id = x.branch_id)'],
        ['public.encuesta_cliente_comentarios(uuid,integer)',
         'r.branch_id = p_branch', 'r.branch_id IS NOT DISTINCT FROM nullif(p_branch, -1)'],
        ['public.encuesta_cliente_con_texto(uuid,integer,timestamp with time zone)',
         'r.branch_id = p_branch', 'r.branch_id IS NOT DISTINCT FROM nullif(p_branch, -1)'],
        ['public.encuesta_cliente_respuestas_para_exportar(uuid)',
         'JOIN public.branches b ON b.id = r.branch_id', 'LEFT JOIN public.branches b ON b.id = r.branch_id'],
        ['public.encuesta_cliente_respuestas_para_exportar(uuid)',
         '''sucursal'', b.name, ''canal'', r.canal,',
         '''sucursal'', coalesce(b.name, ''Campo''), ''canal'', r.canal, ''lugar'', r.lugar, ''lat'', r.lat, ''lng'', r.lng,'],
        ['public.encuesta_cliente_avance(uuid)',
         '''ultima'', (SELECT max(created_at)',
         '''campo'', (SELECT count(*) FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id AND branch_id IS NULL),
        ''ultima'', (SELECT max(created_at)'],
        ['public.encuesta_cliente_avisar_detractor()',
         'r.branch_id = NEW.branch_id', 'r.branch_id IS NOT DISTINCT FROM NEW.branch_id'],
        ['public.encuesta_cliente_avisar_detractor()',
         'coalesce(v_sala, ''sala'')',
         'coalesce(v_sala, CASE WHEN NEW.canal = ''campo'' THEN ''campo'' || coalesce('' · '' || NEW.lugar, '''') END, ''sala'')'],
        ['public.encuesta_cliente_problemas_de(encuestas_cliente)',
         'IF v_suc = 0 THEN', 'IF v_suc = 0 AND NOT (p_enc.canales <@ ARRAY[''campo'']) THEN'],
        ['public.encuesta_cliente_problemas_de(encuestas_cliente)',
         'NOT (''entrevista'' = ANY (p_enc.canales))', 'NOT (p_enc.canales && ARRAY[''entrevista'',''campo''])'],
        ['public.encuesta_cliente_problemas_de(encuestas_cliente)',
         'La muestra médica sólo se entrega en entrevista', 'La muestra médica sólo se entrega en persona (entrevista o campo)'],
        ['public.encuesta_cliente_problemas_de(encuestas_cliente)',
         '(QR, entrevista o tablet)', '(QR, entrevista, tablet o campo)']
    ];
    actual text := '';
BEGIN
    FOREACH c SLICE 1 IN ARRAY cambios LOOP
        IF c[1] <> actual THEN
            IF actual <> '' THEN EXECUTE d; END IF;
            actual := c[1];
            d := pg_get_functiondef(actual::regprocedure);
        END IF;
        n := replace(d, c[2], c[3]);
        IF n = d THEN RAISE EXCEPTION '% no tiene el texto esperado: %', actual, c[2]; END IF;
        d := n;
    END LOOP;
    EXECUTE d;
END $migracion$;
