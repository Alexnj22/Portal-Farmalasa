-- Planificador de contenido (marketing): el mes, las piezas, su flujo, las
-- solicitudes al diseñador, la revisión y la pauta.
--
-- Permisos del módulo `marketing`:
--   can_view    ver el calendario y el tablero, comentar, pedir piezas
--   can_edit    planificar, subir diseños, publicar el mes, anotar la pauta
--   can_approve aprobar piezas y el mes, pedir cambios
--
-- Los diseños sólo los ve quien EDITA hasta que el mes se publica a revisión
-- (pedido del usuario, 2026-10-01: «antes solo se ve cómo va el flujo»). Eso
-- lo decide el RLS de `marketing_archivos` y de `storage.objects`, no la
-- pantalla: escondido en el navegador, el archivo seguiría bajándose.
SET lock_timeout = '5s';

-- ── Catálogos ──────────────────────────────────────────────────────────────
CREATE TABLE public.marketing_marcas (
    id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre     text NOT NULL UNIQUE CHECK (btrim(nombre) <> ''),
    color      text NOT NULL DEFAULT 'chart-1',
    activo     boolean NOT NULL DEFAULT true,
    orden      smallint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- La red se guarda por su CLAVE (`instagram`), no por el rótulo: el rótulo es
-- libre. Apagar una red la saca del formulario sin tocar lo ya planificado.
CREATE TABLE public.marketing_redes (
    clave      text PRIMARY KEY CHECK (clave ~ '^[a-z_]+$'),
    nombre     text NOT NULL,
    activo     boolean NOT NULL DEFAULT true,
    orden      smallint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.marketing_marcas (nombre, color, orden) VALUES
    ('Farmacia La Popular', 'chart-1', 1),
    ('Farmacia La Salud',   'chart-3', 2);

-- TikTok entra apagada: hoy es un supuesto, no una cuenta.
INSERT INTO public.marketing_redes (clave, nombre, activo, orden) VALUES
    ('facebook',  'Facebook',  true,  1),
    ('instagram', 'Instagram', true,  2),
    ('tiktok',    'TikTok',    false, 3),
    ('whatsapp',  'WhatsApp',  true,  4);

-- ── El mes ─────────────────────────────────────────────────────────────────
CREATE TABLE public.marketing_meses (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mes                date NOT NULL UNIQUE CHECK (extract(day FROM mes) = 1),
    estado             text NOT NULL DEFAULT 'planificando'
                       CHECK (estado IN ('planificando','en_revision','con_cambios','aprobado')),
    objetivo           text,
    presupuesto_pauta  numeric(12,2) NOT NULL DEFAULT 0 CHECK (presupuesto_pauta >= 0),
    version            integer NOT NULL DEFAULT 0,
    publicado_at       timestamptz,
    publicado_por      uuid REFERENCES public.employees(id),
    aprobado_at        timestamptz,
    aprobado_por       uuid REFERENCES public.employees(id),
    created_by         uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Solicitudes al diseñador ───────────────────────────────────────────────
CREATE TABLE public.marketing_solicitudes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    marca_id       smallint REFERENCES public.marketing_marcas(id),
    titulo         text NOT NULL CHECK (btrim(titulo) <> ''),
    descripcion    text,
    formato        text CHECK (formato IN ('post','carrusel','reel','video','historia')),
    fecha_deseada  date,
    prioridad      text NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('normal','alta','urgente')),
    estado         text NOT NULL DEFAULT 'nueva'
                   CHECK (estado IN ('nueva','aceptada','rechazada','entregada')),
    respuesta      text,
    solicitado_por uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_solicitudes_marca_idx ON public.marketing_solicitudes (marca_id);
CREATE INDEX marketing_solicitudes_estado_idx ON public.marketing_solicitudes (estado, created_at DESC);

-- ── Las piezas ─────────────────────────────────────────────────────────────
CREATE TABLE public.marketing_piezas (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mes_id            uuid NOT NULL REFERENCES public.marketing_meses(id) ON DELETE CASCADE,
    marca_id          smallint NOT NULL REFERENCES public.marketing_marcas(id),
    fecha             date NOT NULL,
    hora              time,
    formato           text NOT NULL CHECK (formato IN ('post','carrusel','reel','video','historia')),
    redes             text[] NOT NULL DEFAULT '{}',
    pilar             text CHECK (pilar IN ('promocion','producto','educativo','institucional','fecha_especial','entretenimiento')),
    titulo            text NOT NULL CHECK (btrim(titulo) <> ''),
    copy              text,
    hashtags          text,
    notas             text,
    estado            text NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente','en_proceso','finalizado','cambios','aprobado','publicado')),
    pautar            boolean NOT NULL DEFAULT false,
    solicitud_id      uuid REFERENCES public.marketing_solicitudes(id) ON DELETE SET NULL,
    enlace_publicado  text,
    publicado_en      timestamptz,
    revisado_por      uuid REFERENCES public.employees(id),
    revisado_at       timestamptz,
    created_by        uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_piezas_mes_idx       ON public.marketing_piezas (mes_id, fecha);
CREATE INDEX marketing_piezas_marca_idx     ON public.marketing_piezas (marca_id);
CREATE INDEX marketing_piezas_solicitud_idx ON public.marketing_piezas (solicitud_id) WHERE solicitud_id IS NOT NULL;

-- La pieza vive dentro de SU mes: una fecha de otro mes la sacaría del
-- calendario donde se revisa. Un CHECK no puede mirar otra tabla.
CREATE FUNCTION public.marketing_pieza_en_su_mes()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_mes date;
BEGIN
    SELECT mes INTO v_mes FROM public.marketing_meses WHERE id = NEW.mes_id;
    IF date_trunc('month', NEW.fecha)::date <> v_mes THEN
        RAISE EXCEPTION 'La fecha % no es del mes %', NEW.fecha, to_char(v_mes, 'MM/YYYY');
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_piezas_en_su_mes BEFORE INSERT OR UPDATE OF fecha, mes_id
    ON public.marketing_piezas FOR EACH ROW EXECUTE FUNCTION public.marketing_pieza_en_su_mes();

-- ── Los archivos de cada pieza ─────────────────────────────────────────────
-- `url` es la forma pública como identificador (regla 10): nunca una firmada.
CREATE TABLE public.marketing_archivos (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pieza_id    uuid NOT NULL REFERENCES public.marketing_piezas(id) ON DELETE CASCADE,
    url         text,
    enlace      text,
    nombre      text,
    mime        text,
    orden       smallint NOT NULL DEFAULT 0,
    subido_por  uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (url IS NOT NULL OR enlace IS NOT NULL)
);
CREATE INDEX marketing_archivos_pieza_idx ON public.marketing_archivos (pieza_id, orden);

-- ── Comentarios y decisiones ───────────────────────────────────────────────
-- Append-only: la conversación de la revisión es el registro de qué se pidió.
CREATE TABLE public.marketing_comentarios (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mes_id     uuid NOT NULL REFERENCES public.marketing_meses(id) ON DELETE CASCADE,
    pieza_id   uuid REFERENCES public.marketing_piezas(id) ON DELETE CASCADE,
    tipo       text NOT NULL DEFAULT 'comentario'
               CHECK (tipo IN ('comentario','cambio','aprobacion')),
    texto      text NOT NULL CHECK (btrim(texto) <> ''),
    autor_id   uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    resuelto   boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_comentarios_mes_idx   ON public.marketing_comentarios (mes_id, created_at);
CREATE INDEX marketing_comentarios_pieza_idx ON public.marketing_comentarios (pieza_id) WHERE pieza_id IS NOT NULL;

-- ── La pauta (1:1 con la pieza) ────────────────────────────────────────────
CREATE TABLE public.marketing_pautas (
    pieza_id      uuid PRIMARY KEY REFERENCES public.marketing_piezas(id) ON DELETE CASCADE,
    redes         text[] NOT NULL DEFAULT '{}',
    objetivo      text CHECK (objetivo IN ('alcance','interaccion','mensajes','trafico','ventas','seguidores')),
    publico       text,
    presupuesto   numeric(10,2) NOT NULL DEFAULT 0 CHECK (presupuesto >= 0),
    fecha_inicio  date,
    fecha_fin     date,
    gastado       numeric(10,2) CHECK (gastado >= 0),
    alcance       integer CHECK (alcance >= 0),
    impresiones   integer CHECK (impresiones >= 0),
    interacciones integer CHECK (interacciones >= 0),
    mensajes      integer CHECK (mensajes >= 0),
    clics         integer CHECK (clics >= 0),
    notas         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio)
);

CREATE TRIGGER marketing_meses_updated_at       BEFORE UPDATE ON public.marketing_meses       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER marketing_piezas_updated_at      BEFORE UPDATE ON public.marketing_piezas      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER marketing_solicitudes_updated_at BEFORE UPDATE ON public.marketing_solicitudes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER marketing_pautas_updated_at      BEFORE UPDATE ON public.marketing_pautas      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.marketing_marcas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_redes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_meses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_solicitudes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_piezas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_archivos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_comentarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_pautas      ENABLE ROW LEVEL SECURITY;

-- Privilegios de tabla: este proyecto no los concede por defecto. Lo que
-- cada quien puede hacer de verdad lo deciden las policies de abajo.
REVOKE ALL ON public.marketing_marcas, public.marketing_redes, public.marketing_meses,
              public.marketing_solicitudes, public.marketing_piezas, public.marketing_archivos,
              public.marketing_comentarios, public.marketing_pautas FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.marketing_marcas, public.marketing_meses,
              public.marketing_solicitudes TO authenticated;
GRANT SELECT, UPDATE ON public.marketing_redes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_piezas, public.marketing_archivos,
              public.marketing_pautas TO authenticated;
GRANT SELECT, INSERT ON public.marketing_comentarios TO authenticated;
GRANT ALL ON public.marketing_marcas, public.marketing_redes, public.marketing_meses,
             public.marketing_solicitudes, public.marketing_piezas, public.marketing_archivos,
             public.marketing_comentarios, public.marketing_pautas TO service_role;

-- Lectura: quien ve el módulo.
CREATE POLICY marketing_marcas_select      ON public.marketing_marcas      FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_redes_select       ON public.marketing_redes       FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_meses_select       ON public.marketing_meses       FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_solicitudes_select ON public.marketing_solicitudes FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_piezas_select      ON public.marketing_piezas      FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_comentarios_select ON public.marketing_comentarios FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_pautas_select      ON public.marketing_pautas      FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_view')));

-- Los diseños: quien edita los ve siempre; el resto, desde que el mes se
-- publicó a revisión.
CREATE POLICY marketing_archivos_select ON public.marketing_archivos FOR SELECT TO authenticated USING (
    (SELECT public.auth_has_module_permission('marketing','can_edit'))
    OR ((SELECT public.auth_has_module_permission('marketing','can_view'))
        AND EXISTS (SELECT 1 FROM public.marketing_piezas p
                      JOIN public.marketing_meses m ON m.id = p.mes_id
                     WHERE p.id = marketing_archivos.pieza_id AND m.publicado_at IS NOT NULL))
);

-- Escritura del plan: quien edita.
CREATE POLICY marketing_marcas_insert ON public.marketing_marcas FOR INSERT TO authenticated WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit')));
CREATE POLICY marketing_marcas_update ON public.marketing_marcas FOR UPDATE TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_edit'))) WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit')));
CREATE POLICY marketing_redes_update  ON public.marketing_redes  FOR UPDATE TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_edit'))) WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit')));

-- El mes se crea y se le cambia el objetivo/presupuesto desde la pantalla, y
-- eso lo hace también quien aprueba: el presupuesto de pauta lo fija gerencia.
-- El ESTADO lo mueven sólo las funciones de abajo (el trigger lo protege).
CREATE POLICY marketing_meses_insert ON public.marketing_meses FOR INSERT TO authenticated WITH CHECK (
    (SELECT public.auth_has_module_permission('marketing','can_edit')) OR (SELECT public.auth_has_module_permission('marketing','can_approve')));
CREATE POLICY marketing_meses_update ON public.marketing_meses FOR UPDATE TO authenticated USING (
    (SELECT public.auth_has_module_permission('marketing','can_edit')) OR (SELECT public.auth_has_module_permission('marketing','can_approve')))
  WITH CHECK (
    (SELECT public.auth_has_module_permission('marketing','can_edit')) OR (SELECT public.auth_has_module_permission('marketing','can_approve')));

CREATE POLICY marketing_piezas_insert ON public.marketing_piezas FOR INSERT TO authenticated WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit')));
CREATE POLICY marketing_piezas_update ON public.marketing_piezas FOR UPDATE TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_edit'))) WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit')));
CREATE POLICY marketing_piezas_delete ON public.marketing_piezas FOR DELETE TO authenticated USING (
    (SELECT public.auth_has_module_permission('marketing','can_edit')) AND estado IN ('pendiente','en_proceso'));

CREATE POLICY marketing_archivos_insert ON public.marketing_archivos FOR INSERT TO authenticated WITH CHECK (
    (SELECT public.auth_has_module_permission('marketing','can_edit')) AND subido_por = (SELECT public.auth_employee_id()));
CREATE POLICY marketing_archivos_update ON public.marketing_archivos FOR UPDATE TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_edit'))) WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit')));
CREATE POLICY marketing_archivos_delete ON public.marketing_archivos FOR DELETE TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_edit')));

CREATE POLICY marketing_pautas_insert ON public.marketing_pautas FOR INSERT TO authenticated WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit')));
CREATE POLICY marketing_pautas_update ON public.marketing_pautas FOR UPDATE TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_edit'))) WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit')));
CREATE POLICY marketing_pautas_delete ON public.marketing_pautas FOR DELETE TO authenticated USING ((SELECT public.auth_has_module_permission('marketing','can_edit')));

-- Solicitudes: cualquiera que ve el módulo pide, firmando con su ficha; la
-- edita quien la pidió mientras siga nueva, o quien edita (para aceptarla).
CREATE POLICY marketing_solicitudes_insert ON public.marketing_solicitudes FOR INSERT TO authenticated WITH CHECK (
    (SELECT public.auth_has_module_permission('marketing','can_view'))
    AND solicitado_por = (SELECT public.auth_employee_id()) AND estado = 'nueva');
CREATE POLICY marketing_solicitudes_update ON public.marketing_solicitudes FOR UPDATE TO authenticated USING (
    (SELECT public.auth_has_module_permission('marketing','can_edit'))
    OR (solicitado_por = (SELECT public.auth_employee_id()) AND estado = 'nueva'))
  WITH CHECK (
    (SELECT public.auth_has_module_permission('marketing','can_edit'))
    OR (solicitado_por = (SELECT public.auth_employee_id()) AND estado = 'nueva'));

-- Comentarios: cada quien firma lo suyo. Los de tipo «cambio» o «aprobación»
-- los escriben sólo las funciones de revisión (DEFINER).
CREATE POLICY marketing_comentarios_insert ON public.marketing_comentarios FOR INSERT TO authenticated WITH CHECK (
    (SELECT public.auth_has_module_permission('marketing','can_view'))
    AND autor_id = (SELECT public.auth_employee_id()) AND tipo = 'comentario');
-- Marcar resuelto: quien edita (el diseñador cierra lo que corrigió) o quien aprueba.
CREATE POLICY marketing_comentarios_update ON public.marketing_comentarios FOR UPDATE TO authenticated USING (
    (SELECT public.auth_can_edit_any(ARRAY['marketing'])) OR (SELECT public.auth_has_module_permission('marketing','can_approve')))
  WITH CHECK (
    (SELECT public.auth_can_edit_any(ARRAY['marketing'])) OR (SELECT public.auth_has_module_permission('marketing','can_approve')));

-- ── Candado del estado ─────────────────────────────────────────────────────
-- Quien edita no puede darse por aprobado: `estado`, `aprobado_*` y
-- `publicado_*` del mes, y el `aprobado` de una pieza, sólo cambian dentro de
-- las funciones de revisión (que marcan la transacción con un GUC).
CREATE FUNCTION public.marketing_candado_de_estado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    IF coalesce(current_setting('marketing.por_funcion', true), '') = 'si' THEN
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'marketing_meses' THEN
        IF TG_OP = 'INSERT' THEN
            NEW.estado := 'planificando'; NEW.version := 0;
            NEW.publicado_at := NULL; NEW.publicado_por := NULL;
            NEW.aprobado_at := NULL;  NEW.aprobado_por := NULL;
        ELSIF (NEW.estado, NEW.version, NEW.publicado_at, NEW.publicado_por, NEW.aprobado_at, NEW.aprobado_por)
              IS DISTINCT FROM (OLD.estado, OLD.version, OLD.publicado_at, OLD.publicado_por, OLD.aprobado_at, OLD.aprobado_por) THEN
            RAISE EXCEPTION 'El estado del mes se cambia publicándolo o aprobándolo';
        END IF;
    ELSE
        IF NEW.estado = 'aprobado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'aprobado') THEN
            RAISE EXCEPTION 'Una pieza la aprueba quien revisa';
        END IF;
        IF TG_OP = 'UPDATE' AND (NEW.revisado_por, NEW.revisado_at) IS DISTINCT FROM (OLD.revisado_por, OLD.revisado_at) THEN
            RAISE EXCEPTION 'La revisión la firma quien revisa';
        END IF;
        IF TG_OP = 'INSERT' THEN NEW.revisado_por := NULL; NEW.revisado_at := NULL; END IF;
        -- Tocar lo que se aprobó lo devuelve a revisión: si no, quien aprobó
        -- firmaría una pieza que ya no es la que vio.
        IF TG_OP = 'UPDATE' AND OLD.estado = 'aprobado' AND NEW.estado = 'aprobado'
           AND (NEW.titulo, NEW.copy, NEW.hashtags, NEW.fecha, NEW.hora, NEW.formato, NEW.redes, NEW.marca_id)
               IS DISTINCT FROM
               (OLD.titulo, OLD.copy, OLD.hashtags, OLD.fecha, OLD.hora, OLD.formato, OLD.redes, OLD.marca_id) THEN
            NEW.estado := 'finalizado';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_meses_candado  BEFORE INSERT OR UPDATE ON public.marketing_meses  FOR EACH ROW EXECUTE FUNCTION public.marketing_candado_de_estado();
CREATE TRIGGER marketing_piezas_candado BEFORE INSERT OR UPDATE ON public.marketing_piezas FOR EACH ROW EXECUTE FUNCTION public.marketing_candado_de_estado();

-- Lo mismo con los archivos: cambiar el diseño de una pieza aprobada la
-- devuelve a «finalizado», o sea a la cola de revisión.
CREATE FUNCTION public.marketing_archivo_reabre_pieza()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    UPDATE public.marketing_piezas SET estado = 'finalizado'
     WHERE id = coalesce(NEW.pieza_id, OLD.pieza_id) AND estado = 'aprobado';
    RETURN NULL;
END $$;
CREATE TRIGGER marketing_archivos_reabre AFTER INSERT OR DELETE ON public.marketing_archivos
    FOR EACH ROW EXECUTE FUNCTION public.marketing_archivo_reabre_pieza();

-- Un comentario no se reescribe: sólo se marca resuelto.
REVOKE UPDATE ON public.marketing_comentarios FROM authenticated;
GRANT  UPDATE (resuelto) ON public.marketing_comentarios TO authenticated;

-- ── El nombre del mes, en español ──────────────────────────────────────────
-- El formato de mes de `to_char` depende de `lc_time`, que en este servidor es
-- en_US: el aviso diría «October». Sólo la usan los avisos: no hace falta que
-- se inlinee, así que lleva su `search_path` como toda función (regla 4).
CREATE FUNCTION public.marketing_nombre_mes(p_mes date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
    SELECT (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                  'septiembre','octubre','noviembre','diciembre'])[extract(month FROM p_mes)::int]
           || ' ' || extract(year FROM p_mes)::int;
$$;

-- ── A quién se avisa ───────────────────────────────────────────────────────
CREATE FUNCTION public.marketing_destinatarios(p_accion text, p_excepto uuid DEFAULT NULL)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
    SELECT coalesce(array_agg(DISTINCT e.id), '{}')
      FROM public.employees e
      JOIN public.role_permissions rp
        ON rp.role_id IN (e.role_id, e.secondary_role_id)
       AND rp.module_key = 'marketing'
     WHERE e.status = 'ACTIVO'
       AND e.id IS DISTINCT FROM p_excepto
       AND CASE p_accion WHEN 'can_edit' THEN rp.can_edit
                         WHEN 'can_approve' THEN rp.can_approve
                         ELSE rp.can_view END;
$$;

CREATE FUNCTION public.marketing_avisar(p_accion text, p_titulo text, p_cuerpo text, p_link text, p_push boolean, p_meta jsonb DEFAULT '{}')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_dest uuid[] := public.marketing_destinatarios(p_accion, public.auth_employee_id());
BEGIN
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;
    RETURN public.notify_employees(v_dest, 'MARKETING', p_titulo, p_cuerpo, p_link,
        p_meta || jsonb_build_object('quien_id', public.auth_employee_id()), p_push, NULL);
END $$;

-- ── Publicar el mes a revisión ─────────────────────────────────────────────
CREATE FUNCTION public.marketing_publicar_mes(p_mes_id uuid, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_mes   public.marketing_meses;
    v_yo    uuid := public.auth_employee_id();
    v_sin   integer;
    v_label text;
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_edit') THEN
        RAISE EXCEPTION 'FORBIDDEN: publicar el mes exige editar el planificador';
    END IF;
    SELECT * INTO v_mes FROM public.marketing_meses WHERE id = p_mes_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El mes no existe'; END IF;
    -- Un mes aprobado SE PUEDE volver a enviar: si el diseñador corrigió algo
    -- después (la pieza volvió a «finalizado»), quien aprobó tiene que enterarse.

    SELECT count(*) INTO v_sin FROM public.marketing_piezas WHERE mes_id = p_mes_id;
    IF v_sin = 0 THEN RAISE EXCEPTION 'El mes no tiene piezas para revisar'; END IF;

    PERFORM set_config('marketing.por_funcion', 'si', true);
    UPDATE public.marketing_meses
       SET estado = 'en_revision', version = version + 1,
           publicado_at = now(), publicado_por = v_yo
     WHERE id = p_mes_id
    RETURNING * INTO v_mes;
    -- La nota viaja en el aviso de abajo; con la marca puesta, el trigger de
    -- comentarios no manda un segundo aviso por lo mismo.
    IF nullif(btrim(p_nota), '') IS NOT NULL THEN
        INSERT INTO public.marketing_comentarios (mes_id, tipo, texto, autor_id)
        VALUES (p_mes_id, 'comentario', p_nota, v_yo);
    END IF;
    PERFORM set_config('marketing.por_funcion', '', true);

    v_label := public.marketing_nombre_mes(v_mes.mes);
    PERFORM public.marketing_avisar('can_approve',
        CASE WHEN v_mes.version = 1 THEN 'Calendario de ' || v_label || ' listo para revisar'
             ELSE 'Calendario de ' || v_label || ' actualizado (versión ' || v_mes.version || ')' END,
        coalesce(nullif(btrim(p_nota), ''), 'Revisa las piezas y deja tus comentarios o apruébalo.'),
        '/marketing?tab=calendario&mes=' || to_char(v_mes.mes, 'YYYY-MM'), true,
        jsonb_build_object('mes_id', p_mes_id));

    RETURN json_build_object('estado', v_mes.estado, 'version', v_mes.version);
END $$;

-- ── Revisar una pieza ──────────────────────────────────────────────────────
CREATE FUNCTION public.marketing_revisar_pieza(p_pieza_id uuid, p_decision text, p_texto text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_p   public.marketing_piezas;
    v_m   public.marketing_meses;
    v_yo  uuid := public.auth_employee_id();
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_approve') THEN
        RAISE EXCEPTION 'FORBIDDEN: revisar exige aprobar en el planificador';
    END IF;
    IF p_decision NOT IN ('aprobar','cambios') THEN RAISE EXCEPTION 'Decisión desconocida: %', p_decision; END IF;
    IF p_decision = 'cambios' AND nullif(btrim(p_texto), '') IS NULL THEN
        RAISE EXCEPTION 'Pedir un cambio exige decir cuál';
    END IF;

    SELECT * INTO v_p FROM public.marketing_piezas WHERE id = p_pieza_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La pieza no existe'; END IF;
    SELECT * INTO v_m FROM public.marketing_meses WHERE id = v_p.mes_id FOR UPDATE;
    IF v_m.publicado_at IS NULL THEN RAISE EXCEPTION 'El mes todavía no se publicó a revisión'; END IF;
    IF v_p.estado = 'publicado' THEN RAISE EXCEPTION 'La pieza ya salió en redes'; END IF;

    PERFORM set_config('marketing.por_funcion', 'si', true);
    UPDATE public.marketing_piezas
       SET estado = CASE p_decision WHEN 'aprobar' THEN 'aprobado' ELSE 'cambios' END,
           revisado_por = v_yo, revisado_at = now()
     WHERE id = p_pieza_id;
    IF p_decision = 'cambios' AND v_m.estado IN ('en_revision','aprobado') THEN
        UPDATE public.marketing_meses SET estado = 'con_cambios', aprobado_at = NULL, aprobado_por = NULL
         WHERE id = v_m.id;
    END IF;
    PERFORM set_config('marketing.por_funcion', '', true);

    INSERT INTO public.marketing_comentarios (mes_id, pieza_id, tipo, texto, autor_id)
    VALUES (v_m.id, p_pieza_id,
            CASE p_decision WHEN 'aprobar' THEN 'aprobacion' ELSE 'cambio' END,
            coalesce(nullif(btrim(p_texto), ''), 'Aprobada'), v_yo);

    IF p_decision = 'cambios' THEN
        PERFORM public.marketing_avisar('can_edit',
            'Cambios en «' || v_p.titulo || '»', p_texto,
            '/marketing?tab=calendario&mes=' || to_char(v_m.mes, 'YYYY-MM') || '&pieza=' || p_pieza_id, true,
            jsonb_build_object('mes_id', v_m.id, 'pieza_id', p_pieza_id));
    END IF;

    RETURN json_build_object('estado', CASE p_decision WHEN 'aprobar' THEN 'aprobado' ELSE 'cambios' END);
END $$;

-- ── Aprobar el mes entero ──────────────────────────────────────────────────
-- Aprueba de una vez las piezas listas (`finalizado`). Las que siguen en
-- trabajo o con cambios pendientes NO se aprueban solas: se cuentan y se
-- devuelven para que la pantalla lo diga.
CREATE FUNCTION public.marketing_aprobar_mes(p_mes_id uuid, p_texto text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_m         public.marketing_meses;
    v_yo        uuid := public.auth_employee_id();
    v_aprobadas integer;
    v_abiertas  integer;
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_approve') THEN
        RAISE EXCEPTION 'FORBIDDEN: aprobar exige aprobar en el planificador';
    END IF;
    SELECT * INTO v_m FROM public.marketing_meses WHERE id = p_mes_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El mes no existe'; END IF;
    IF v_m.publicado_at IS NULL THEN RAISE EXCEPTION 'El mes todavía no se publicó a revisión'; END IF;

    SELECT count(*) INTO v_abiertas FROM public.marketing_piezas
     WHERE mes_id = p_mes_id AND estado IN ('pendiente','en_proceso','cambios');
    IF v_abiertas > 0 THEN
        RAISE EXCEPTION 'Quedan % pieza(s) sin terminar o con cambios pedidos', v_abiertas;
    END IF;

    PERFORM set_config('marketing.por_funcion', 'si', true);
    UPDATE public.marketing_piezas SET estado = 'aprobado', revisado_por = v_yo, revisado_at = now()
     WHERE mes_id = p_mes_id AND estado = 'finalizado';
    GET DIAGNOSTICS v_aprobadas = ROW_COUNT;
    UPDATE public.marketing_meses SET estado = 'aprobado', aprobado_at = now(), aprobado_por = v_yo
     WHERE id = p_mes_id RETURNING * INTO v_m;
    PERFORM set_config('marketing.por_funcion', '', true);

    INSERT INTO public.marketing_comentarios (mes_id, tipo, texto, autor_id)
    VALUES (p_mes_id, 'aprobacion', coalesce(nullif(btrim(p_texto), ''), 'Calendario aprobado para publicar'), v_yo);

    PERFORM public.marketing_avisar('can_edit',
        'Calendario de ' || public.marketing_nombre_mes(v_m.mes) || ' aprobado',
        coalesce(nullif(btrim(p_texto), ''), 'Todo listo para publicar.'),
        '/marketing?tab=calendario&mes=' || to_char(v_m.mes, 'YYYY-MM'), true,
        jsonb_build_object('mes_id', p_mes_id));

    RETURN json_build_object('estado', 'aprobado', 'piezas_aprobadas', v_aprobadas);
END $$;

-- ── Avisos por trigger: solicitud nueva y comentario ───────────────────────
CREATE FUNCTION public.marketing_avisar_solicitud()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    PERFORM public.marketing_avisar('can_edit',
        CASE NEW.prioridad WHEN 'urgente' THEN 'Solicitud URGENTE: ' ELSE 'Nueva solicitud: ' END || NEW.titulo,
        coalesce(left(NEW.descripcion, 200), ''),
        '/marketing?tab=solicitudes', NEW.prioridad <> 'normal',
        jsonb_build_object('solicitud_id', NEW.id));
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_solicitudes_aviso AFTER INSERT ON public.marketing_solicitudes
    FOR EACH ROW EXECUTE FUNCTION public.marketing_avisar_solicitud();

-- Un comentario suelto avisa al otro lado: si lo escribe quien edita, a
-- quien aprueba; si no, a quien edita. Sin push: es conversación.
CREATE FUNCTION public.marketing_avisar_comentario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_mes date; v_titulo text;
BEGIN
    IF NEW.tipo <> 'comentario' OR coalesce(current_setting('marketing.por_funcion', true), '') = 'si' THEN
        RETURN NEW;
    END IF;
    SELECT mes INTO v_mes FROM public.marketing_meses WHERE id = NEW.mes_id;
    SELECT titulo INTO v_titulo FROM public.marketing_piezas WHERE id = NEW.pieza_id;
    PERFORM public.marketing_avisar(
        CASE WHEN public.auth_has_module_permission('marketing','can_edit') THEN 'can_approve' ELSE 'can_edit' END,
        'Comentario' || coalesce(' en «' || v_titulo || '»', ' en el calendario de ' || public.marketing_nombre_mes(v_mes)),
        left(NEW.texto, 200),
        '/marketing?tab=calendario&mes=' || to_char(v_mes, 'YYYY-MM') || coalesce('&pieza=' || NEW.pieza_id, ''),
        false, jsonb_build_object('mes_id', NEW.mes_id, 'pieza_id', NEW.pieza_id));
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_comentarios_aviso AFTER INSERT ON public.marketing_comentarios
    FOR EACH ROW EXECUTE FUNCTION public.marketing_avisar_comentario();

-- ── Permisos de ejecución (regla 4) ────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.marketing_nombre_mes(date)           FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marketing_nombre_mes(date)           TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.marketing_pieza_en_su_mes()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_candado_de_estado()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_archivo_reabre_pieza()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_destinatarios(text, uuid)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_avisar(text, text, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_avisar_solicitud()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_avisar_comentario()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_publicar_mes(uuid, text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_revisar_pieza(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_aprobar_mes(uuid, text)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marketing_destinatarios(text, uuid)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.marketing_avisar(text, text, text, text, boolean, jsonb) TO service_role;
GRANT  EXECUTE ON FUNCTION public.marketing_publicar_mes(uuid, text)    TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.marketing_revisar_pieza(uuid, text, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.marketing_aprobar_mes(uuid, text)     TO authenticated, service_role;

-- ── Storage: bucket privado ────────────────────────────────────────────────
-- Ruta: <mes_id>/<pieza_id>/<archivo>. 200 MB por archivo alcanza un reel de
-- 60 s en 1080p; un video más pesado entra como enlace.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('marketing', 'marketing', false, 209715200,
        ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic',
              'video/mp4','video/quicktime','video/webm','application/pdf'])
ON CONFLICT (id) DO UPDATE
   SET public = excluded.public, file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

CREATE POLICY marketing_storage_select ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'marketing'
    AND ((SELECT public.auth_has_module_permission('marketing','can_edit'))
         OR ((SELECT public.auth_has_module_permission('marketing','can_view'))
             AND EXISTS (SELECT 1 FROM public.marketing_meses m
                          WHERE m.id::text = (storage.foldername(name))[1]
                            AND m.publicado_at IS NOT NULL))));
CREATE POLICY marketing_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'marketing' AND (SELECT public.auth_has_module_permission('marketing','can_edit')));
CREATE POLICY marketing_storage_delete ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'marketing' AND (SELECT public.auth_has_module_permission('marketing','can_edit')));

-- ── El cargo del diseñador y los permisos de arranque ──────────────────────
-- Se ajustan después en Permisos; esto es sólo el punto de partida. EDITAR lo
-- tiene sólo el diseñador a propósito: con editar se ven los diseños antes de
-- que el mes se envíe, y el pedido fue que el resto vea sólo el flujo.
-- Como el Contador Externo: alcance global y colgado de Gerencia. Una hora de
-- inactividad y no cinco: sube videos pesados y el corte de sala lo dejaría
-- afuera a mitad de la subida.
INSERT INTO public.roles (id, name, parent_role_id, scope, max_limit, idle_limit_min)
SELECT (SELECT max(id) + 1 FROM public.roles), 'Diseñador/a Gráfico/a', 2, 'GLOBAL', 1, 60
 WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Diseñador/a Gráfico/a');

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'marketing', v.can_view, v.can_edit, v.can_approve, 'ALL'
  FROM (VALUES ('Diseñador/a Gráfico/a', true, true,  false),
               ('Gerente General',       true, false, true),
               ('Administrador',         true, false, true),
               ('Agente de Atencion de Canales Digitales', true, false, false)) v(nombre, can_view, can_edit, can_approve)
  JOIN public.roles r ON r.name = v.nombre
 WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.module_key = 'marketing');
