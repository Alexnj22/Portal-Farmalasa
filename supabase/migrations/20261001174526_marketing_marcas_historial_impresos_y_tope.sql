-- Planificador de contenido, tercera tanda (pedido del usuario, 2026-10-01):
--   · una pieza puede ser de VARIAS marcas a la vez;
--   · se puede quitar una pieza ya puesta (no la publicada), sólo quien la creó;
--   · sólo quien creó una pieza la mueve (de estado o de día);
--   · el historial de cada pieza: qué cambió, cuándo y quién;
--   · solicitudes de piezas IMPRESAS, con su tamaño;
--   · el tope mensual de pauta lo fija gerencia y no se puede pasar.
SET lock_timeout = '5s';

-- ── Varias marcas por pieza ────────────────────────────────────────────────
-- `marcas` es la lista; `marca_id` queda como la principal (la primera), que es
-- la que pinta el color en el calendario y la que ya leen los informes.
ALTER TABLE public.marketing_piezas ADD COLUMN marcas smallint[] NOT NULL DEFAULT '{}';
SELECT set_config('marketing.por_funcion', 'si', true);
UPDATE public.marketing_piezas SET marcas = ARRAY[marca_id] WHERE marcas = '{}';
SELECT set_config('marketing.por_funcion', '', true);

CREATE FUNCTION public.marketing_piezas_marcas()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    IF coalesce(cardinality(NEW.marcas), 0) = 0 THEN
        NEW.marcas := ARRAY[NEW.marca_id];
    ELSE
        -- Sin repetidas y en el orden en que se eligieron: la primera manda.
        NEW.marcas := ARRAY(SELECT x FROM unnest(NEW.marcas) WITH ORDINALITY AS u(x, o) GROUP BY x ORDER BY min(o));
        NEW.marca_id := NEW.marcas[1];
    END IF;
    -- Un arreglo no admite FK: se valida acá.
    IF EXISTS (SELECT 1 FROM unnest(NEW.marcas) x
                WHERE NOT EXISTS (SELECT 1 FROM public.marketing_marcas m WHERE m.id = x)) THEN
        RAISE EXCEPTION 'Una de las marcas no existe';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_piezas_marcas BEFORE INSERT OR UPDATE OF marcas, marca_id
    ON public.marketing_piezas FOR EACH ROW EXECUTE FUNCTION public.marketing_piezas_marcas();
CREATE INDEX marketing_piezas_marcas_idx ON public.marketing_piezas USING gin (marcas);

-- ── El candado, con «sólo quien la creó la mueve» ──────────────────────────
-- Mover = cambiarle el estado o el día. Lo que hacen quien revisa (por las
-- funciones de revisión) y el cron de las 8:00 (sin usuario) no es «mover».
CREATE OR REPLACE FUNCTION public.marketing_candado_de_estado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_yo uuid := public.auth_employee_id();
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
        IF TG_OP = 'UPDATE' AND v_yo IS NOT NULL
           AND (NEW.estado IS DISTINCT FROM OLD.estado OR NEW.fecha IS DISTINCT FROM OLD.fecha)
           AND OLD.created_by IS NOT NULL AND OLD.created_by <> v_yo
           AND NOT public.auth_is_su() THEN
            RAISE EXCEPTION 'Sólo quien creó la pieza la mueve';
        END IF;
        IF NEW.estado = 'aprobado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'aprobado') THEN
            RAISE EXCEPTION 'Una pieza la aprueba quien revisa';
        END IF;
        IF NEW.estado = 'programado' AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('aprobado','programado')) THEN
            RAISE EXCEPTION 'Sólo se programa una pieza aprobada';
        END IF;
        IF TG_OP = 'UPDATE' AND (NEW.revisado_por, NEW.revisado_at) IS DISTINCT FROM (OLD.revisado_por, OLD.revisado_at) THEN
            RAISE EXCEPTION 'La revisión la firma quien revisa';
        END IF;
        IF TG_OP = 'INSERT' THEN NEW.revisado_por := NULL; NEW.revisado_at := NULL; END IF;
        -- Tocar lo que se aprobó lo devuelve a revisión: si no, quien aprobó
        -- firmaría una pieza que ya no es la que vio.
        IF TG_OP = 'UPDATE' AND OLD.estado IN ('aprobado','programado') AND NEW.estado = OLD.estado
           AND (NEW.titulo, NEW.copy, NEW.hashtags, NEW.fecha, NEW.hora, NEW.formato, NEW.redes, NEW.marcas)
               IS DISTINCT FROM
               (OLD.titulo, OLD.copy, OLD.hashtags, OLD.fecha, OLD.hora, OLD.formato, OLD.redes, OLD.marcas) THEN
            NEW.estado := 'finalizado';
        END IF;
    END IF;
    RETURN NEW;
END $$;

-- Cambiar el diseño reabre la pieza AUNQUE no la haya creado quien sube: es
-- el sistema el que la devuelve a revisión, no una persona que la mueve.
CREATE OR REPLACE FUNCTION public.marketing_archivo_reabre_pieza()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    PERFORM set_config('marketing.por_funcion', 'si', true);
    UPDATE public.marketing_piezas SET estado = 'finalizado'
     WHERE id = coalesce(NEW.pieza_id, OLD.pieza_id) AND estado IN ('aprobado','programado');
    PERFORM set_config('marketing.por_funcion', '', true);
    RETURN NULL;
END $$;

-- ── Quitar una pieza ya puesta ─────────────────────────────────────────────
-- Cualquiera que no haya salido ya, y sólo quien la creó. Lo publicado es
-- historia: borrarlo dejaría el informe del mes contando otra cosa.
DROP POLICY marketing_piezas_delete ON public.marketing_piezas;
CREATE POLICY marketing_piezas_delete ON public.marketing_piezas FOR DELETE TO authenticated USING (
    (SELECT public.auth_has_module_permission('marketing','can_edit'))
    AND estado <> 'publicado'
    AND (created_by = (SELECT public.auth_employee_id()) OR (SELECT public.auth_is_su())));

-- ── El historial de cada pieza ─────────────────────────────────────────────
-- Lo escriben los triggers, nadie a mano. `pieza_id` queda en NULL al quitarla
-- (el `titulo` es la foto de cómo se llamaba) para que el mes conserve el
-- rastro de qué se quitó y quién.
CREATE TABLE public.marketing_historial (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mes_id     uuid NOT NULL REFERENCES public.marketing_meses(id) ON DELETE CASCADE,
    pieza_id   uuid REFERENCES public.marketing_piezas(id) ON DELETE SET NULL,
    titulo     text NOT NULL,
    evento     text NOT NULL CHECK (evento IN ('creada','estado','fecha','archivo','archivo_quitado','quitada')),
    de         text,
    a          text,
    actor      uuid REFERENCES public.employees(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_historial_mes_idx   ON public.marketing_historial (mes_id, created_at DESC);
CREATE INDEX marketing_historial_pieza_idx ON public.marketing_historial (pieza_id, created_at DESC) WHERE pieza_id IS NOT NULL;

ALTER TABLE public.marketing_historial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_historial FROM anon;
GRANT SELECT ON public.marketing_historial TO authenticated;
GRANT ALL ON public.marketing_historial TO service_role;
CREATE POLICY marketing_historial_select ON public.marketing_historial FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_view')));

CREATE FUNCTION public.marketing_anotar_pieza()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_yo uuid := public.auth_employee_id();
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, a, actor)
        VALUES (NEW.mes_id, NEW.id, NEW.titulo, 'creada', NEW.estado, v_yo);
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.estado IS DISTINCT FROM OLD.estado THEN
            INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, de, a, actor)
            VALUES (NEW.mes_id, NEW.id, NEW.titulo, 'estado', OLD.estado, NEW.estado, v_yo);
        END IF;
        IF NEW.fecha IS DISTINCT FROM OLD.fecha THEN
            INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, de, a, actor)
            VALUES (NEW.mes_id, NEW.id, NEW.titulo, 'fecha', OLD.fecha::text, NEW.fecha::text, v_yo);
        END IF;
    ELSIF EXISTS (SELECT 1 FROM public.marketing_meses WHERE id = OLD.mes_id) THEN
        INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, de, actor)
        VALUES (OLD.mes_id, NULL, OLD.titulo, 'quitada', OLD.estado, v_yo);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER marketing_piezas_historial AFTER INSERT OR UPDATE OF estado, fecha OR DELETE
    ON public.marketing_piezas FOR EACH ROW EXECUTE FUNCTION public.marketing_anotar_pieza();

CREATE FUNCTION public.marketing_anotar_archivo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_p public.marketing_piezas;
BEGIN
    -- Al quitar la pieza, sus archivos se van en cascada después de ella: no
    -- hay pieza a la que anotarle nada, y la baja ya quedó como «quitada».
    SELECT * INTO v_p FROM public.marketing_piezas WHERE id = coalesce(NEW.pieza_id, OLD.pieza_id);
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, a, actor)
    VALUES (v_p.mes_id, v_p.id, v_p.titulo,
            CASE TG_OP WHEN 'INSERT' THEN 'archivo' ELSE 'archivo_quitado' END,
            coalesce(CASE TG_OP WHEN 'INSERT' THEN NEW.nombre ELSE OLD.nombre END,
                     CASE TG_OP WHEN 'INSERT' THEN NEW.enlace ELSE OLD.enlace END),
            public.auth_employee_id());
    RETURN NULL;
END $$;
CREATE TRIGGER marketing_archivos_historial AFTER INSERT OR DELETE
    ON public.marketing_archivos FOR EACH ROW EXECUTE FUNCTION public.marketing_anotar_archivo();

-- Una pieza que quien aprueba ya vio y se quita después: se le avisa, con un
-- comentario en el mes (el trigger de comentarios hace el aviso).
CREATE FUNCTION public.marketing_avisar_pieza_quitada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_yo uuid := public.auth_employee_id();
BEGIN
    IF v_yo IS NOT NULL AND EXISTS (SELECT 1 FROM public.marketing_meses
                                     WHERE id = OLD.mes_id AND publicado_at IS NOT NULL) THEN
        INSERT INTO public.marketing_comentarios (mes_id, tipo, texto, autor_id)
        VALUES (OLD.mes_id, 'comentario',
                'Se quitó del calendario «' || OLD.titulo || '» (' || to_char(OLD.fecha, 'DD/MM') || ').', v_yo);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER marketing_piezas_quitada AFTER DELETE ON public.marketing_piezas
    FOR EACH ROW EXECUTE FUNCTION public.marketing_avisar_pieza_quitada();

-- Lo que ya existe entra al historial como «creada», con quien la creó.
INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, a, actor, created_at)
SELECT mes_id, id, titulo, 'creada', estado, created_by, created_at FROM public.marketing_piezas;

-- ── Solicitudes de piezas impresas ─────────────────────────────────────────
ALTER TABLE public.marketing_solicitudes DROP CONSTRAINT marketing_solicitudes_formato_check;
ALTER TABLE public.marketing_solicitudes
    ADD COLUMN tipo text NOT NULL DEFAULT 'digital' CHECK (tipo IN ('digital','impreso')),
    ADD COLUMN tamano text,
    ADD CONSTRAINT marketing_solicitudes_formato_check CHECK (formato IN (
        'post','carrusel','reel','video','historia',
        'banner','rollup','afiche','volante','rotulo','etiqueta','tarjeta','otro'));

-- ── El tope mensual de pauta ───────────────────────────────────────────────
-- Gerencia (quien aprueba) fija cuánto hay; el diseñador lo reparte pieza por
-- pieza y la base no deja pasarse. Sin tope fijado no se asigna nada.
CREATE FUNCTION public.marketing_tope_de_pauta()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_mes public.marketing_meses; v_asignado numeric;
BEGIN
    SELECT m.* INTO v_mes FROM public.marketing_meses m
      JOIN public.marketing_piezas p ON p.mes_id = m.id WHERE p.id = NEW.pieza_id;
    SELECT coalesce(sum(pa.presupuesto), 0) INTO v_asignado
      FROM public.marketing_pautas pa JOIN public.marketing_piezas p ON p.id = pa.pieza_id
     WHERE p.mes_id = v_mes.id AND pa.pieza_id <> NEW.pieza_id;
    IF NEW.presupuesto > 0 AND v_mes.presupuesto_pauta = 0 THEN
        RAISE EXCEPTION 'Gerencia todavía no fijó el presupuesto de pauta de %', public.marketing_nombre_mes(v_mes.mes);
    END IF;
    IF v_asignado + NEW.presupuesto > v_mes.presupuesto_pauta THEN
        RAISE EXCEPTION 'Supera el presupuesto de pauta del mes: quedan $% de $%',
            to_char(v_mes.presupuesto_pauta - v_asignado, 'FM999,990.00'), to_char(v_mes.presupuesto_pauta, 'FM999,990.00');
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_pautas_tope BEFORE INSERT OR UPDATE OF presupuesto
    ON public.marketing_pautas FOR EACH ROW EXECUTE FUNCTION public.marketing_tope_de_pauta();

CREATE FUNCTION public.marketing_presupuesto_lo_fija_gerencia()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_asignado numeric;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.presupuesto_pauta IS NOT DISTINCT FROM OLD.presupuesto_pauta THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.presupuesto_pauta = 0 THEN RETURN NEW; END IF;
    IF public.auth_employee_id() IS NOT NULL
       AND NOT public.auth_has_module_permission('marketing','can_approve') THEN
        RAISE EXCEPTION 'El presupuesto de pauta del mes lo fija gerencia';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        SELECT coalesce(sum(pa.presupuesto), 0) INTO v_asignado
          FROM public.marketing_pautas pa JOIN public.marketing_piezas p ON p.id = pa.pieza_id
         WHERE p.mes_id = NEW.id;
        IF NEW.presupuesto_pauta < v_asignado THEN
            RAISE EXCEPTION 'Ya hay $% asignados en pauta este mes', to_char(v_asignado, 'FM999,990.00');
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_meses_presupuesto BEFORE INSERT OR UPDATE OF presupuesto_pauta
    ON public.marketing_meses FOR EACH ROW EXECUTE FUNCTION public.marketing_presupuesto_lo_fija_gerencia();

-- ── Permisos de ejecución ──────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.marketing_piezas_marcas()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_candado_de_estado()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_archivo_reabre_pieza()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_anotar_pieza()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_anotar_archivo()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_avisar_pieza_quitada()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_tope_de_pauta()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_presupuesto_lo_fija_gerencia()  FROM PUBLIC, anon, authenticated;
