-- Encuestas a clientes — fase 1: el diseño y el ciclo de aprobación.
-- Plan: docs/PLAN-ENCUESTAS-A-CLIENTES-2026-10-01.md
--
-- Permisos del módulo `encuestas_clientes`:
--   can_view    ver encuestas, resultados y el historial
--   can_edit    diseñar borradores, enviarlos a revisión, publicar, cerrar
--   can_approve aprobar o rechazar (arranca sólo con Gerente General)
--
-- El cuestionario vive en UN jsonb y no en tablas de preguntas: una encuesta
-- publicada no se edita nunca (se saca una versión nueva), así que nadie
-- necesita actualizar una pregunta suelta, y guardarlo entero hace que el
-- constructor escriba de una sola vez lo que el revisor aprobó. Su forma la
-- juzga `encuesta_cliente_problemas` —el mismo juez que consulta la pantalla
-- y el que frena el envío a revisión—.
--
-- No se reutilizan `surveys`/`survey_responses`: son de clima laboral y
-- `survey_responses.employee_id` es obligatorio.
SET lock_timeout = '5s';

-- ── Dimensiones: lo que se mide ────────────────────────────────────────────
-- Se guardan por CLAVE (como `marketing_redes`): el rótulo es libre. El
-- color es un acento vigente (chart-1/3/4/6/8/9; DESIGN.md §6).
CREATE TABLE public.encuesta_cliente_dimensiones (
    clave       text PRIMARY KEY CHECK (clave ~ '^[a-z][a-z0-9_]*$'),
    nombre      text NOT NULL CHECK (btrim(nombre) <> ''),
    descripcion text,
    color       text NOT NULL DEFAULT 'chart-1',
    activo      boolean NOT NULL DEFAULT true,
    orden       smallint NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.encuesta_cliente_dimensiones (clave, nombre, descripcion, color, orden) VALUES
    ('recomendacion', 'Recomendación',       'Si nos recomendaría (NPS)',                         'chart-1', 1),
    ('atencion',      'Atención',            'Trato, amabilidad y asesoría del personal',         'chart-3', 2),
    ('marca',         'Percepción de marca', 'Confianza, imagen y lo que representa la empresa',  'chart-4', 3),
    ('precio',        'Precio',              'Percepción de precios y promociones',               'chart-6', 4),
    ('surtido',       'Surtido',             'Encontrar lo que buscaba',                          'chart-8', 5),
    ('espera',        'Tiempo de espera',    'Rapidez en la atención y en caja',                  'chart-9', 6),
    ('instalaciones', 'Instalaciones',       'Limpieza, orden y comodidad de la sala',            'chart-1', 7);

-- ── La encuesta ────────────────────────────────────────────────────────────
CREATE TABLE public.encuestas_cliente (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                text NOT NULL CHECK (btrim(nombre) <> ''),
    objetivo              text,
    es_plantilla          boolean NOT NULL DEFAULT false,
    estado                text NOT NULL DEFAULT 'borrador'
                          CHECK (estado IN ('borrador','en_revision','aprobada','publicada','cerrada','archivada')),
    version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    origen_id             uuid REFERENCES public.encuestas_cliente(id) ON DELETE SET NULL,
    cuestionario          jsonb NOT NULL DEFAULT '{"secciones":[]}'
                          CHECK (jsonb_typeof(cuestionario -> 'secciones') = 'array'),
    canales               text[] NOT NULL DEFAULT '{qr,entrevista}'
                          CHECK (canales <@ ARRAY['qr','entrevista','kiosco']::text[]),
    alcance               text NOT NULL DEFAULT 'general' CHECK (alcance IN ('general','sucursales')),
    meta_total            integer CHECK (meta_total > 0),
    fecha_inicio          date,
    fecha_fin             date,
    incentivo_tipo        text NOT NULL DEFAULT 'ninguno' CHECK (incentivo_tipo IN ('ninguno','puntos','muestra')),
    incentivo_puntos      integer CHECK (incentivo_puntos > 0),
    incentivo_descripcion text,
    texto_consentimiento  text NOT NULL DEFAULT
        'Acepto que la farmacia guarde mis datos de contacto junto a mis respuestas para dar seguimiento a mi opinión y, si aplica, entregarme el beneficio de esta encuesta.',
    mensaje_bienvenida    text,
    mensaje_cierre        text,
    enviada_at            timestamptz,
    enviada_por           uuid REFERENCES public.employees(id),
    aprobada_at           timestamptz,
    aprobada_por          uuid REFERENCES public.employees(id),
    publicada_at          timestamptz,
    publicada_por         uuid REFERENCES public.employees(id),
    cerrada_at            timestamptz,
    cerrada_por           uuid REFERENCES public.employees(id),
    motivo_cierre         text,
    created_by            uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio),
    CHECK (incentivo_tipo <> 'puntos' OR incentivo_puntos IS NOT NULL)
);
CREATE INDEX encuestas_cliente_estado_idx ON public.encuestas_cliente (estado, updated_at DESC);
CREATE INDEX encuestas_cliente_origen_idx ON public.encuestas_cliente (origen_id) WHERE origen_id IS NOT NULL;

CREATE TRIGGER encuestas_cliente_updated_at BEFORE UPDATE ON public.encuestas_cliente
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Dónde se aplica: una fila por sucursal ─────────────────────────────────
-- Con alcance `general` igual hay filas (las sucursales donde se reparte el
-- QR) pero la meta es `meta_total`; con `sucursales`, cada una lleva su cuota.
-- El `token` es el del QR: viaja en el enlace público y dice de qué sucursal
-- es la respuesta sin preguntarlo.
CREATE TABLE public.encuesta_cliente_sucursales (
    encuesta_id uuid NOT NULL REFERENCES public.encuestas_cliente(id) ON DELETE CASCADE,
    branch_id   integer NOT NULL REFERENCES public.branches(id),
    meta        integer CHECK (meta > 0),
    token       text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (encuesta_id, branch_id)
);
CREATE INDEX encuesta_cliente_sucursales_branch_idx ON public.encuesta_cliente_sucursales (branch_id);

-- ── Historial del ciclo (append-only) ──────────────────────────────────────
CREATE TABLE public.encuesta_cliente_eventos (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    encuesta_id uuid NOT NULL REFERENCES public.encuestas_cliente(id) ON DELETE CASCADE,
    tipo        text NOT NULL CHECK (tipo IN ('creada','enviada','aprobada','rechazada','publicada','cerrada','archivada','duplicada')),
    comentario  text,
    autor_id    uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX encuesta_cliente_eventos_encuesta_idx ON public.encuesta_cliente_eventos (encuesta_id, created_at);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.encuesta_cliente_dimensiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encuestas_cliente            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encuesta_cliente_sucursales  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encuesta_cliente_eventos     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.encuesta_cliente_dimensiones, public.encuestas_cliente,
              public.encuesta_cliente_sucursales, public.encuesta_cliente_eventos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.encuesta_cliente_dimensiones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.encuestas_cliente, public.encuesta_cliente_sucursales TO authenticated;
GRANT SELECT                         ON public.encuesta_cliente_eventos TO authenticated;
GRANT ALL ON public.encuesta_cliente_dimensiones, public.encuestas_cliente,
             public.encuesta_cliente_sucursales, public.encuesta_cliente_eventos TO service_role;

CREATE POLICY encuesta_cliente_dimensiones_select ON public.encuesta_cliente_dimensiones FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_view')));
CREATE POLICY encuesta_cliente_dimensiones_insert ON public.encuesta_cliente_dimensiones FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')));
CREATE POLICY encuesta_cliente_dimensiones_update ON public.encuesta_cliente_dimensiones FOR UPDATE TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')))
    WITH CHECK ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')));

CREATE POLICY encuestas_cliente_select ON public.encuestas_cliente FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_view')));
CREATE POLICY encuestas_cliente_insert ON public.encuestas_cliente FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')));
CREATE POLICY encuestas_cliente_update ON public.encuestas_cliente FOR UPDATE TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')))
    WITH CHECK ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')));
-- Sólo se borra lo que nunca salió de borrador: lo demás tiene historia.
CREATE POLICY encuestas_cliente_delete ON public.encuestas_cliente FOR DELETE TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')) AND estado = 'borrador');

CREATE POLICY encuesta_cliente_sucursales_select ON public.encuesta_cliente_sucursales FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_view')));
CREATE POLICY encuesta_cliente_sucursales_insert ON public.encuesta_cliente_sucursales FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')));
CREATE POLICY encuesta_cliente_sucursales_update ON public.encuesta_cliente_sucursales FOR UPDATE TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')))
    WITH CHECK ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')));
CREATE POLICY encuesta_cliente_sucursales_delete ON public.encuesta_cliente_sucursales FOR DELETE TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_edit')));

CREATE POLICY encuesta_cliente_eventos_select ON public.encuesta_cliente_eventos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_view')));

-- ── El candado: lo aprobado es lo que se aplica ────────────────────────────
-- Fuera de borrador nada se edita con un `update`: el estado y las firmas sólo
-- los mueven las funciones del ciclo (que marcan la transacción con un GUC).
-- Si no, quien diseña podría cambiar una pregunta después de que la aprobaran
-- y el revisor habría firmado otra encuesta.
CREATE FUNCTION public.encuesta_cliente_candado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    IF coalesce(current_setting('encuestas.por_funcion', true), '') = 'si' THEN
        RETURN coalesce(NEW, OLD);
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.estado := 'borrador';
        NEW.enviada_at := NULL;   NEW.enviada_por := NULL;
        NEW.aprobada_at := NULL;  NEW.aprobada_por := NULL;
        NEW.publicada_at := NULL; NEW.publicada_por := NULL;
        NEW.cerrada_at := NULL;   NEW.cerrada_por := NULL; NEW.motivo_cierre := NULL;
        RETURN NEW;
    END IF;
    IF OLD.estado <> 'borrador' THEN
        RAISE EXCEPTION 'La encuesta está %: ya no se edita. Duplícala para sacar una versión nueva.', OLD.estado;
    END IF;
    IF (NEW.estado, NEW.version, NEW.origen_id, NEW.es_plantilla,
        NEW.enviada_at, NEW.enviada_por, NEW.aprobada_at, NEW.aprobada_por,
        NEW.publicada_at, NEW.publicada_por, NEW.cerrada_at, NEW.cerrada_por, NEW.motivo_cierre)
       IS DISTINCT FROM
       (OLD.estado, OLD.version, OLD.origen_id, OLD.es_plantilla,
        OLD.enviada_at, OLD.enviada_por, OLD.aprobada_at, OLD.aprobada_por,
        OLD.publicada_at, OLD.publicada_por, OLD.cerrada_at, OLD.cerrada_por, OLD.motivo_cierre) THEN
        RAISE EXCEPTION 'El estado de la encuesta se cambia enviándola, aprobándola o publicándola';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER encuestas_cliente_candado BEFORE INSERT OR UPDATE ON public.encuestas_cliente
    FOR EACH ROW EXECUTE FUNCTION public.encuesta_cliente_candado();

-- Las sucursales siguen a su encuesta: sólo se tocan en borrador, y el token
-- no lo elige nadie.
CREATE FUNCTION public.encuesta_cliente_sucursal_candado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_estado text;
BEGIN
    IF coalesce(current_setting('encuestas.por_funcion', true), '') = 'si' THEN
        RETURN coalesce(NEW, OLD);
    END IF;
    SELECT estado INTO v_estado FROM public.encuestas_cliente
     WHERE id = coalesce(NEW.encuesta_id, OLD.encuesta_id);
    -- Borrar la encuesta (sólo un borrador puede) arrastra sus sucursales en
    -- cascada: ahí la encuesta ya no está, y no hay nada que proteger.
    IF TG_OP = 'DELETE' AND v_estado IS NULL THEN RETURN OLD; END IF;
    IF v_estado IS DISTINCT FROM 'borrador' THEN
        RAISE EXCEPTION 'Las sucursales de una encuesta % ya no se cambian', coalesce(v_estado, 'inexistente');
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.token := replace(gen_random_uuid()::text, '-', '');
    ELSIF TG_OP = 'UPDATE' THEN
        NEW.token := OLD.token;
    END IF;
    RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER encuesta_cliente_sucursales_candado BEFORE INSERT OR UPDATE OR DELETE ON public.encuesta_cliente_sucursales
    FOR EACH ROW EXECUTE FUNCTION public.encuesta_cliente_sucursal_candado();

-- La creación queda en el historial sola, venga de donde venga.
CREATE FUNCTION public.encuesta_cliente_anotar_creacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    IF coalesce(current_setting('encuestas.por_funcion', true), '') <> 'si' THEN
        INSERT INTO public.encuesta_cliente_eventos (encuesta_id, tipo, autor_id)
        VALUES (NEW.id, 'creada', public.auth_employee_id());
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER encuestas_cliente_creada AFTER INSERT ON public.encuestas_cliente
    FOR EACH ROW EXECUTE FUNCTION public.encuesta_cliente_anotar_creacion();

-- ── El juez: ¿esta encuesta está lista para revisarse? ─────────────────────
-- Devuelve la lista de problemas en palabras del negocio; vacía = lista. La
-- pantalla la muestra mientras se diseña y `encuesta_cliente_enviar` se niega
-- si no está vacía: el aviso y el freno no pueden contestar distinto.
CREATE FUNCTION public.encuesta_cliente_problemas_de(p_enc public.encuestas_cliente)
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
    -- La muestra médica la entrega quien acompaña: sólo existe en presencial.
    IF p_enc.incentivo_tipo = 'muestra' AND NOT (p_enc.canales && ARRAY['entrevista','kiosco']) THEN
        v_out := v_out || 'La muestra médica sólo se entrega en entrevista o tablet acompañada'::text;
    END IF;
    IF p_enc.incentivo_tipo = 'muestra' AND btrim(coalesce(p_enc.incentivo_descripcion, '')) = '' THEN
        v_out := v_out || 'Describe qué muestra médica se entrega'::text;
    END IF;
    RETURN v_out;
END $$;

CREATE FUNCTION public.encuesta_cliente_problemas(p_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id;
    IF NOT FOUND THEN RETURN ARRAY['La encuesta no existe']; END IF;
    RETURN public.encuesta_cliente_problemas_de(v_enc);
END $$;

-- ── A quién se avisa ───────────────────────────────────────────────────────
CREATE FUNCTION public.encuesta_cliente_destinatarios(p_accion text, p_excepto uuid DEFAULT NULL)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
    SELECT coalesce(array_agg(DISTINCT e.id), '{}')
      FROM public.employees e
      JOIN public.role_permissions rp
        ON rp.role_id IN (e.role_id, e.secondary_role_id)
       AND rp.module_key = 'encuestas_clientes'
     WHERE e.status = 'ACTIVO'
       AND e.id IS DISTINCT FROM p_excepto
       AND CASE p_accion WHEN 'can_edit' THEN rp.can_edit
                         WHEN 'can_approve' THEN rp.can_approve
                         ELSE rp.can_view END;
$$;

CREATE FUNCTION public.encuesta_cliente_avisar(p_dest uuid[], p_titulo text, p_cuerpo text, p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_dest uuid[];
BEGIN
    SELECT coalesce(array_agg(DISTINCT d), '{}') INTO v_dest
      FROM unnest(p_dest) d WHERE d IS NOT NULL AND d IS DISTINCT FROM public.auth_employee_id();
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;
    RETURN public.notify_employees(v_dest, 'ENCUESTAS', p_titulo, p_cuerpo,
        '/encuestas-clientes?encuesta=' || p_id,
        jsonb_build_object('encuesta_id', p_id, 'quien_id', public.auth_employee_id()), true, NULL);
END $$;

-- ── El ciclo ───────────────────────────────────────────────────────────────
CREATE FUNCTION public.encuesta_cliente_enviar(p_id uuid, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_enc public.encuestas_cliente;
    v_problemas text[];
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_edit') THEN
        RAISE EXCEPTION 'FORBIDDEN: enviar a revisión exige diseñar encuestas';
    END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;
    IF v_enc.es_plantilla THEN RAISE EXCEPTION 'Una plantilla no se envía: crea una encuesta a partir de ella'; END IF;
    IF v_enc.estado <> 'borrador' THEN RAISE EXCEPTION 'Sólo se envía un borrador (está %)', v_enc.estado; END IF;
    v_problemas := public.encuesta_cliente_problemas_de(v_enc);
    IF coalesce(array_length(v_problemas, 1), 0) > 0 THEN
        RAISE EXCEPTION 'La encuesta no está lista: %', array_to_string(v_problemas, '; ');
    END IF;

    PERFORM set_config('encuestas.por_funcion', 'si', true);
    UPDATE public.encuestas_cliente
       SET estado = 'en_revision', enviada_at = now(), enviada_por = public.auth_employee_id(),
           aprobada_at = NULL, aprobada_por = NULL
     WHERE id = p_id RETURNING * INTO v_enc;
    INSERT INTO public.encuesta_cliente_eventos (encuesta_id, tipo, comentario)
    VALUES (p_id, 'enviada', nullif(btrim(p_nota), ''));
    PERFORM set_config('encuestas.por_funcion', '', true);

    PERFORM public.encuesta_cliente_avisar(public.encuesta_cliente_destinatarios('can_approve'),
        'Encuesta para aprobar: ' || v_enc.nombre,
        coalesce(nullif(btrim(p_nota), ''), 'Revísala y apruébala o devuélvela con comentarios.'), p_id);
    RETURN json_build_object('estado', v_enc.estado);
END $$;

CREATE FUNCTION public.encuesta_cliente_revisar(p_id uuid, p_decision text, p_comentario text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_approve') THEN
        RAISE EXCEPTION 'FORBIDDEN: aprobar encuestas exige el permiso de aprobación';
    END IF;
    IF p_decision NOT IN ('aprobar','rechazar') THEN RAISE EXCEPTION 'Decisión no válida: %', p_decision; END IF;
    IF p_decision = 'rechazar' AND btrim(coalesce(p_comentario, '')) = '' THEN
        RAISE EXCEPTION 'Para devolverla escribe qué hay que cambiar';
    END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;
    IF v_enc.estado <> 'en_revision' THEN RAISE EXCEPTION 'La encuesta no está en revisión (está %)', v_enc.estado; END IF;

    PERFORM set_config('encuestas.por_funcion', 'si', true);
    IF p_decision = 'aprobar' THEN
        UPDATE public.encuestas_cliente
           SET estado = 'aprobada', aprobada_at = now(), aprobada_por = public.auth_employee_id()
         WHERE id = p_id RETURNING * INTO v_enc;
    ELSE
        UPDATE public.encuestas_cliente SET estado = 'borrador' WHERE id = p_id RETURNING * INTO v_enc;
    END IF;
    INSERT INTO public.encuesta_cliente_eventos (encuesta_id, tipo, comentario)
    VALUES (p_id, CASE p_decision WHEN 'aprobar' THEN 'aprobada' ELSE 'rechazada' END, nullif(btrim(p_comentario), ''));
    PERFORM set_config('encuestas.por_funcion', '', true);

    PERFORM public.encuesta_cliente_avisar(ARRAY[v_enc.enviada_por, v_enc.created_by],
        CASE p_decision WHEN 'aprobar' THEN 'Encuesta aprobada: ' ELSE 'Encuesta devuelta con cambios: ' END || v_enc.nombre,
        coalesce(nullif(btrim(p_comentario), ''), 'Ya se puede publicar.'), p_id);
    RETURN json_build_object('estado', v_enc.estado);
END $$;

CREATE FUNCTION public.encuesta_cliente_publicar(p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_enc public.encuestas_cliente;
    v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_edit') THEN
        RAISE EXCEPTION 'FORBIDDEN: publicar exige diseñar encuestas';
    END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;
    IF v_enc.estado <> 'aprobada' THEN RAISE EXCEPTION 'Sólo se publica una encuesta aprobada (está %)', v_enc.estado; END IF;
    IF v_enc.fecha_fin IS NOT NULL AND v_enc.fecha_fin < v_hoy THEN
        RAISE EXCEPTION 'La fecha de cierre ya pasó: duplícala y ajusta las fechas';
    END IF;

    PERFORM set_config('encuestas.por_funcion', 'si', true);
    UPDATE public.encuestas_cliente
       SET estado = 'publicada', publicada_at = now(), publicada_por = public.auth_employee_id(),
           fecha_inicio = greatest(coalesce(fecha_inicio, v_hoy), v_hoy)
     WHERE id = p_id RETURNING * INTO v_enc;
    INSERT INTO public.encuesta_cliente_eventos (encuesta_id, tipo) VALUES (p_id, 'publicada');
    PERFORM set_config('encuestas.por_funcion', '', true);
    RETURN json_build_object('estado', v_enc.estado, 'fecha_inicio', v_enc.fecha_inicio);
END $$;

CREATE FUNCTION public.encuesta_cliente_cerrar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_edit') THEN
        RAISE EXCEPTION 'FORBIDDEN: cerrar exige diseñar encuestas';
    END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;
    IF v_enc.estado <> 'publicada' THEN RAISE EXCEPTION 'Sólo se cierra una encuesta publicada (está %)', v_enc.estado; END IF;

    PERFORM set_config('encuestas.por_funcion', 'si', true);
    UPDATE public.encuestas_cliente
       SET estado = 'cerrada', cerrada_at = now(), cerrada_por = public.auth_employee_id(),
           motivo_cierre = coalesce(nullif(btrim(p_motivo), ''), 'Cerrada a mano')
     WHERE id = p_id RETURNING * INTO v_enc;
    INSERT INTO public.encuesta_cliente_eventos (encuesta_id, tipo, comentario)
    VALUES (p_id, 'cerrada', v_enc.motivo_cierre);
    PERFORM set_config('encuestas.por_funcion', '', true);
    RETURN json_build_object('estado', v_enc.estado);
END $$;

-- Archivar la saca de la lista principal. Un borrador o una devuelta también
-- se pueden archivar (en vez de borrar) cuando se quiere guardar la idea.
CREATE FUNCTION public.encuesta_cliente_archivar(p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_edit') THEN
        RAISE EXCEPTION 'FORBIDDEN: archivar exige diseñar encuestas';
    END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;
    IF v_enc.estado IN ('publicada','en_revision','archivada') THEN
        RAISE EXCEPTION 'Una encuesta % no se archiva', v_enc.estado;
    END IF;
    PERFORM set_config('encuestas.por_funcion', 'si', true);
    UPDATE public.encuestas_cliente SET estado = 'archivada' WHERE id = p_id RETURNING * INTO v_enc;
    INSERT INTO public.encuesta_cliente_eventos (encuesta_id, tipo) VALUES (p_id, 'archivada');
    PERFORM set_config('encuestas.por_funcion', '', true);
    RETURN json_build_object('estado', v_enc.estado);
END $$;

-- Duplicar es la única forma de cambiar algo que ya salió de borrador. Desde
-- una plantilla nace la versión 1; desde una encuesta, la siguiente versión de
-- su familia. Las fechas no se copian: casi nunca sirven las mismas.
CREATE FUNCTION public.encuesta_cliente_duplicar(p_id uuid, p_como_plantilla boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_src public.encuestas_cliente;
    v_new uuid;
    v_ver integer;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_edit') THEN
        RAISE EXCEPTION 'FORBIDDEN: duplicar exige diseñar encuestas';
    END IF;
    SELECT * INTO v_src FROM public.encuestas_cliente WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;
    v_ver := CASE WHEN v_src.es_plantilla OR p_como_plantilla THEN 1 ELSE v_src.version + 1 END;

    PERFORM set_config('encuestas.por_funcion', 'si', true);
    INSERT INTO public.encuestas_cliente (
        nombre, objetivo, es_plantilla, estado, version, origen_id, cuestionario, canales, alcance,
        meta_total, incentivo_tipo, incentivo_puntos, incentivo_descripcion, texto_consentimiento,
        mensaje_bienvenida, mensaje_cierre, created_by)
    VALUES (
        CASE WHEN v_src.es_plantilla OR p_como_plantilla THEN v_src.nombre
             ELSE regexp_replace(v_src.nombre, '\s*\(v\d+\)$', '') || ' (v' || v_ver || ')' END,
        v_src.objetivo, p_como_plantilla, 'borrador', v_ver, p_id, v_src.cuestionario, v_src.canales, v_src.alcance,
        v_src.meta_total, v_src.incentivo_tipo, v_src.incentivo_puntos, v_src.incentivo_descripcion,
        v_src.texto_consentimiento, v_src.mensaje_bienvenida, v_src.mensaje_cierre, public.auth_employee_id())
    RETURNING id INTO v_new;
    INSERT INTO public.encuesta_cliente_sucursales (encuesta_id, branch_id, meta)
    SELECT v_new, branch_id, meta FROM public.encuesta_cliente_sucursales WHERE encuesta_id = p_id;
    INSERT INTO public.encuesta_cliente_eventos (encuesta_id, tipo, comentario)
    VALUES (v_new, 'duplicada', 'A partir de «' || v_src.nombre || '»');
    PERFORM set_config('encuestas.por_funcion', '', true);
    RETURN v_new;
END $$;

REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_candado()                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_sucursal_candado()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_anotar_creacion()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_problemas_de(public.encuestas_cliente) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_problemas(uuid)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_destinatarios(text, uuid)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_avisar(uuid[], text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_enviar(uuid, text)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_revisar(uuid, text, text)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_publicar(uuid)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_cerrar(uuid, text)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_archivar(uuid)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_duplicar(uuid, boolean)        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_problemas_de(public.encuestas_cliente) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_problemas(uuid)                TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_destinatarios(text, uuid)      TO service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_avisar(uuid[], text, text, uuid) TO service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_enviar(uuid, text)             TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_revisar(uuid, text, text)      TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_publicar(uuid)                 TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_cerrar(uuid, text)             TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_archivar(uuid)                 TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_duplicar(uuid, boolean)        TO authenticated, service_role;

-- ── Plantillas de arranque ─────────────────────────────────────────────────
INSERT INTO public.encuestas_cliente (nombre, objetivo, es_plantilla, cuestionario, canales) VALUES
('NPS rápido', 'Tres preguntas para medir la recomendación y su motivo, en menos de un minuto.', true,
 '{"secciones":[{"id":"s1","titulo":"Tu opinión","preguntas":[
   {"id":"nps","tipo":"nps","texto":"¿Qué tan probable es que recomiendes nuestra farmacia a un familiar o amigo?","obligatoria":true,"dimension":"recomendacion"},
   {"id":"motivo_bajo","tipo":"texto","texto":"¿Qué tendríamos que mejorar?","obligatoria":false,"dimension":"recomendacion","condicion":{"pregunta":"nps","operador":"<=","valor":6}},
   {"id":"motivo_alto","tipo":"texto","texto":"¿Qué es lo que más te gusta de nosotros?","obligatoria":false,"dimension":"recomendacion","condicion":{"pregunta":"nps","operador":">=","valor":9}}
 ]}]}'::jsonb, '{qr,kiosco}'),
('Calidad de la atención', 'Cómo vive el cliente la visita a la sala: trato, asesoría, espera y orden.', true,
 '{"secciones":[
   {"id":"s1","titulo":"Tu visita de hoy","preguntas":[
     {"id":"csat","tipo":"csat","texto":"En general, ¿qué tan satisfecho quedaste con tu visita?","obligatoria":true,"dimension":"atencion"},
     {"id":"trato","tipo":"likert","texto":"El personal me atendió con amabilidad","obligatoria":true,"dimension":"atencion"},
     {"id":"asesoria","tipo":"likert","texto":"Me explicaron con claridad cómo tomar mi medicamento","obligatoria":true,"dimension":"atencion"},
     {"id":"encontro","tipo":"si_no","texto":"¿Encontraste todo lo que buscabas?","obligatoria":true,"dimension":"surtido"},
     {"id":"falto","tipo":"texto","texto":"¿Qué no encontraste?","obligatoria":false,"dimension":"surtido","condicion":{"pregunta":"encontro","operador":"=","valor":false}},
     {"id":"espera","tipo":"unica","texto":"¿Cuánto esperaste para ser atendido?","obligatoria":true,"dimension":"espera","opciones":[
        {"id":"a","texto":"Menos de 5 minutos"},{"id":"b","texto":"De 5 a 10 minutos"},{"id":"c","texto":"Más de 10 minutos"}]},
     {"id":"limpieza","tipo":"likert","texto":"La farmacia estaba limpia y ordenada","obligatoria":true,"dimension":"instalaciones"}
   ]},
   {"id":"s2","titulo":"Para cerrar","preguntas":[
     {"id":"nps","tipo":"nps","texto":"¿Qué tan probable es que nos recomiendes?","obligatoria":true,"dimension":"recomendacion"},
     {"id":"comentario","tipo":"texto","texto":"¿Algo más que quieras contarnos?","obligatoria":false}
   ]}]}'::jsonb, '{entrevista,kiosco,qr}'),
('Percepción de marca', 'Qué representa la empresa para el cliente frente a la competencia.', true,
 '{"secciones":[{"id":"s1","titulo":"Lo que piensas de nosotros","preguntas":[
   {"id":"confianza","tipo":"likert","texto":"Confío en la calidad de los productos que vende esta farmacia","obligatoria":true,"dimension":"marca"},
   {"id":"precios","tipo":"likert","texto":"Los precios son justos comparados con otras farmacias","obligatoria":true,"dimension":"precio"},
   {"id":"atributos","tipo":"multiple","texto":"¿Con qué palabras asocias a nuestra farmacia?","obligatoria":false,"dimension":"marca","opciones":[
      {"id":"a","texto":"Confianza"},{"id":"b","texto":"Buen precio"},{"id":"c","texto":"Cercanía"},{"id":"d","texto":"Buena atención"},
      {"id":"e","texto":"Variedad"},{"id":"f","texto":"Rapidez"},{"id":"g","texto":"Caro"},{"id":"h","texto":"Lento"}]},
   {"id":"eleccion","tipo":"ranking","texto":"Ordena lo que más pesa al elegir farmacia","obligatoria":false,"dimension":"marca","opciones":[
      {"id":"a","texto":"Precio"},{"id":"b","texto":"Cercanía"},{"id":"c","texto":"Atención"},{"id":"d","texto":"Surtido"}]},
   {"id":"frecuencia","tipo":"unica","texto":"¿Con qué frecuencia nos visitas?","obligatoria":true,"opciones":[
      {"id":"a","texto":"Primera vez"},{"id":"b","texto":"Una vez al mes o menos"},{"id":"c","texto":"Varias veces al mes"},{"id":"d","texto":"Cada semana"}]},
   {"id":"nps","tipo":"nps","texto":"¿Qué tan probable es que nos recomiendes?","obligatoria":true,"dimension":"recomendacion"}
 ]}]}'::jsonb, '{entrevista,qr}');

-- ── Permisos de arranque ───────────────────────────────────────────────────
-- Se ajustan después en Permisos. Aprobar arranca sólo con Gerente General
-- (decisión del usuario, 2026-10-01).
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'encuestas_clientes', v.can_view, v.can_edit, v.can_approve, 'ALL'
  FROM (VALUES ('Gerente General',                         true, true,  true),
               ('Administrador',                           true, true,  false),
               ('Agente de Atencion de Canales Digitales', true, true,  false),
               ('Supervisor/a de Ventas',                  true, false, false)) v(nombre, can_view, can_edit, can_approve)
  JOIN public.roles r ON r.name = v.nombre
 WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.module_key = 'encuestas_clientes');

-- ── La población para sugerir la muestra ───────────────────────────────────
-- Tickets de los últimos 30 días por sucursal: es a cuántas atenciones
-- representa la encuesta. DEFINER porque quien diseña no necesariamente ve
-- Ventas; devuelve sólo conteos. Medido en prod: 31 ms, 2,476 bloques.
CREATE FUNCTION public.encuesta_cliente_poblacion()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    RETURN (
        SELECT coalesce(json_agg(json_build_object('branch_id', branch_id, 'tickets', tickets)), '[]'::json)
          FROM (SELECT branch_id, count(*) AS tickets
                  FROM public.sales_invoices
                 WHERE fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 30
                   AND public.venta_valida(estado)
                 GROUP BY branch_id) t
    );
END $$;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_poblacion() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_poblacion() TO authenticated, service_role;
