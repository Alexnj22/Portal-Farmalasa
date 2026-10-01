-- Planificador de contenido, cuarta tanda (pedido del usuario, 2026-10-01):
--   · duplicar piezas o un mes entero a otro mes;
--   · versiones de un diseño (V1 → V2) sin perder la anterior;
--   · comentarios marcados SOBRE el diseño (punto, recuadro o trazo a lápiz);
--   · biblioteca de marca (logos, paleta, tipografías, fotos);
--   · LIBERAR piezas aprobadas para que las salas las descarguen y publiquen
--     en WhatsApp, desde una galería con su propio permiso (`galeria`).
SET lock_timeout = '5s';

-- ── Versiones y medidas de los archivos ────────────────────────────────────
-- Una versión nueva es una fila nueva que apunta a la anterior; la anterior
-- queda `reemplazado` y deja de verse en la pieza (sí en el comparador).
-- Las medidas se guardan al subir: dicen si sirve para un estado de WhatsApp.
ALTER TABLE public.marketing_archivos
    ADD COLUMN version     smallint NOT NULL DEFAULT 1 CHECK (version >= 1),
    ADD COLUMN anterior_id uuid REFERENCES public.marketing_archivos(id) ON DELETE SET NULL,
    ADD COLUMN reemplazado boolean NOT NULL DEFAULT false,
    ADD COLUMN tamano      bigint CHECK (tamano >= 0),
    ADD COLUMN ancho       integer CHECK (ancho > 0),
    ADD COLUMN alto        integer CHECK (alto > 0);
CREATE INDEX marketing_archivos_anterior_idx ON public.marketing_archivos (anterior_id) WHERE anterior_id IS NOT NULL;

-- La versión y el «reemplazado» de la anterior los pone la base: así no hay
-- dos V2 de lo mismo, ni una anterior que siga viéndose.
CREATE FUNCTION public.marketing_archivo_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_ant public.marketing_archivos;
BEGIN
    IF NEW.anterior_id IS NULL THEN NEW.version := 1; RETURN NEW; END IF;
    SELECT * INTO v_ant FROM public.marketing_archivos WHERE id = NEW.anterior_id FOR UPDATE;
    IF NOT FOUND OR v_ant.pieza_id <> NEW.pieza_id THEN
        RAISE EXCEPTION 'La versión anterior no es de esta pieza';
    END IF;
    IF v_ant.reemplazado THEN
        RAISE EXCEPTION 'Ese diseño ya tiene una versión más nueva';
    END IF;
    NEW.version := v_ant.version + 1;
    NEW.orden := v_ant.orden;
    UPDATE public.marketing_archivos SET reemplazado = true WHERE id = v_ant.id;
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_archivos_version BEFORE INSERT ON public.marketing_archivos
    FOR EACH ROW EXECUTE FUNCTION public.marketing_archivo_version();

-- ── Comentarios marcados sobre el diseño ───────────────────────────────────
-- `marca` en coordenadas relativas (0–1) a la imagen, para que la marca caiga
-- en el mismo sitio a cualquier tamaño de pantalla:
--   {"tipo":"punto","x":..,"y":..}
--   {"tipo":"recuadro","x":..,"y":..,"w":..,"h":..}
--   {"tipo":"trazo","puntos":[[x,y],...]}
ALTER TABLE public.marketing_comentarios
    ADD COLUMN archivo_id uuid REFERENCES public.marketing_archivos(id) ON DELETE CASCADE,
    ADD COLUMN marca jsonb CHECK (marca IS NULL OR marca->>'tipo' IN ('punto','recuadro','trazo'));
CREATE INDEX marketing_comentarios_archivo_idx ON public.marketing_comentarios (archivo_id) WHERE archivo_id IS NOT NULL;

-- ── Historial: versiones y liberación ──────────────────────────────────────
ALTER TABLE public.marketing_historial DROP CONSTRAINT marketing_historial_evento_check;
ALTER TABLE public.marketing_historial ADD CONSTRAINT marketing_historial_evento_check
    CHECK (evento IN ('creada','estado','fecha','archivo','archivo_quitado','quitada','version','liberada','retenida'));

CREATE OR REPLACE FUNCTION public.marketing_anotar_archivo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_p public.marketing_piezas;
BEGIN
    -- Al quitar la pieza, sus archivos se van en cascada después de ella: no
    -- hay pieza a la que anotarle nada, y la baja ya quedó como «quitada».
    SELECT * INTO v_p FROM public.marketing_piezas WHERE id = coalesce(NEW.pieza_id, OLD.pieza_id);
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, a, actor)
    VALUES (v_p.mes_id, v_p.id, v_p.titulo,
            CASE WHEN TG_OP = 'DELETE' THEN 'archivo_quitado'
                 WHEN NEW.anterior_id IS NOT NULL THEN 'version' ELSE 'archivo' END,
            CASE WHEN TG_OP = 'DELETE' THEN coalesce(OLD.nombre, OLD.enlace)
                 WHEN NEW.anterior_id IS NOT NULL THEN 'V' || NEW.version || coalesce(' · ' || NEW.nombre, '')
                 ELSE coalesce(NEW.nombre, NEW.enlace) END,
            public.auth_employee_id());
    RETURN NULL;
END $$;

-- ── Liberar piezas para las salas ──────────────────────────────────────────
ALTER TABLE public.marketing_piezas
    ADD COLUMN liberada     boolean NOT NULL DEFAULT false,
    ADD COLUMN liberada_at  timestamptz,
    ADD COLUMN liberada_por uuid REFERENCES public.employees(id);
CREATE INDEX marketing_piezas_liberadas_idx ON public.marketing_piezas (fecha DESC) WHERE liberada;

-- Una pieza que vuelve a revisión deja de estar liberada: las salas no pueden
-- tener una versión que ya no es la aprobada.
CREATE FUNCTION public.marketing_retener_si_reabre()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    IF NEW.liberada AND NEW.estado NOT IN ('aprobado','programado','publicado') THEN
        NEW.liberada := false;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_piezas_retener BEFORE UPDATE ON public.marketing_piezas
    FOR EACH ROW EXECUTE FUNCTION public.marketing_retener_si_reabre();

CREATE FUNCTION public.marketing_liberar_pieza(p_pieza_id uuid, p_liberar boolean)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_p public.marketing_piezas; v_yo uuid := public.auth_employee_id();
BEGIN
    IF NOT (public.auth_has_module_permission('marketing','can_edit')
            OR public.auth_has_module_permission('marketing','can_approve')) THEN
        RAISE EXCEPTION 'FORBIDDEN: liberar exige editar o aprobar en el planificador';
    END IF;
    SELECT * INTO v_p FROM public.marketing_piezas WHERE id = p_pieza_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La pieza no existe'; END IF;
    IF p_liberar AND v_p.estado NOT IN ('aprobado','programado','publicado') THEN
        RAISE EXCEPTION 'Sólo se libera una pieza aprobada';
    END IF;
    IF v_p.liberada = p_liberar THEN RETURN json_build_object('liberada', p_liberar); END IF;

    PERFORM set_config('marketing.por_funcion', 'si', true);
    UPDATE public.marketing_piezas
       SET liberada = p_liberar,
           liberada_at = CASE WHEN p_liberar THEN now() ELSE liberada_at END,
           liberada_por = CASE WHEN p_liberar THEN v_yo ELSE liberada_por END
     WHERE id = p_pieza_id;
    PERFORM set_config('marketing.por_funcion', '', true);

    INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, actor)
    VALUES (v_p.mes_id, v_p.id, v_p.titulo, CASE WHEN p_liberar THEN 'liberada' ELSE 'retenida' END, v_yo);
    RETURN json_build_object('liberada', p_liberar);
END $$;

-- ── Duplicar piezas a otro mes ─────────────────────────────────────────────
-- `semana`: el mismo día de la semana en la misma semana del mes (el primer
-- lunes cae en el primer lunes); si ese mes no tiene un quinto lunes, va al
-- último. `dia`: el mismo número de día, o el último del mes si no existe.
-- Las copias nacen pendientes, sin diseños ni pauta, firmadas por quien duplica.
-- INVOKER: el RLS decide (sólo quien edita inserta).
CREATE FUNCTION public.marketing_duplicar(p_piezas uuid[], p_mes_destino date, p_modo text DEFAULT 'semana')
RETURNS json LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, extensions AS $$
DECLARE
    v_mes_id uuid;
    v_dest   date := date_trunc('month', p_mes_destino)::date;
    v_fin    date := (date_trunc('month', p_mes_destino) + interval '1 month - 1 day')::date;
    r        public.marketing_piezas;
    v_fecha  date;
    v_n      integer := 0;
    v_nth    integer;
    v_prim   date;
BEGIN
    IF p_modo NOT IN ('semana','dia') THEN RAISE EXCEPTION 'Modo desconocido: %', p_modo; END IF;
    SELECT id INTO v_mes_id FROM public.marketing_meses WHERE mes = v_dest;
    IF v_mes_id IS NULL THEN
        INSERT INTO public.marketing_meses (mes) VALUES (v_dest) RETURNING id INTO v_mes_id;
    END IF;
    FOR r IN SELECT * FROM public.marketing_piezas WHERE id = ANY (p_piezas) ORDER BY fecha, hora NULLS LAST LOOP
        IF p_modo = 'dia' THEN
            v_fecha := least(v_dest + (extract(day FROM r.fecha)::int - 1), v_fin);
        ELSE
            v_nth := (extract(day FROM r.fecha)::int - 1) / 7;
            v_prim := v_dest + ((extract(dow FROM r.fecha)::int - extract(dow FROM v_dest)::int + 7) % 7);
            v_fecha := v_prim + 7 * v_nth;
            WHILE v_fecha > v_fin LOOP v_fecha := v_fecha - 7; END LOOP;
        END IF;
        INSERT INTO public.marketing_piezas
            (mes_id, marca_id, marcas, fecha, hora, formato, redes, pilar, titulo, copy, hashtags, notas, pautar, promocion_id)
        VALUES (v_mes_id, r.marca_id, r.marcas, v_fecha, r.hora, r.formato, r.redes, r.pilar, r.titulo, r.copy,
                r.hashtags, r.notas, r.pautar, r.promocion_id);
        v_n := v_n + 1;
    END LOOP;
    RETURN json_build_object('copiadas', v_n, 'mes_id', v_mes_id);
END $$;

-- ── Biblioteca de marca ────────────────────────────────────────────────────
-- `marca_id` vacío = de las dos (o de todas). Un color de la paleta va en
-- `color` (#RRGGBB) y no lleva archivo.
CREATE TABLE public.marketing_recursos (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    marca_id   smallint REFERENCES public.marketing_marcas(id) ON DELETE CASCADE,
    tipo       text NOT NULL CHECK (tipo IN ('logo','color','tipografia','foto','plantilla','otro')),
    nombre     text NOT NULL CHECK (btrim(nombre) <> ''),
    url        text,
    enlace     text,
    color      text CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
    mime       text,
    notas      text,
    subido_por uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (url IS NOT NULL OR enlace IS NOT NULL OR color IS NOT NULL)
);
CREATE INDEX marketing_recursos_marca_idx ON public.marketing_recursos (marca_id, tipo);

ALTER TABLE public.marketing_recursos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_recursos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_recursos TO authenticated;
GRANT ALL ON public.marketing_recursos TO service_role;
CREATE POLICY marketing_recursos_select ON public.marketing_recursos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_recursos_insert ON public.marketing_recursos FOR INSERT TO authenticated
    WITH CHECK (((SELECT public.auth_has_module_permission('marketing','can_edit'))
                 OR (SELECT public.auth_has_module_permission('marketing','can_approve')))
                AND subido_por = (SELECT public.auth_employee_id()));
CREATE POLICY marketing_recursos_update ON public.marketing_recursos FOR UPDATE TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_edit'))
        OR (SELECT public.auth_has_module_permission('marketing','can_approve')))
    WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit'))
             OR (SELECT public.auth_has_module_permission('marketing','can_approve')));
CREATE POLICY marketing_recursos_delete ON public.marketing_recursos FOR DELETE TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_edit'))
        OR (SELECT public.auth_has_module_permission('marketing','can_approve')));

-- ── La galería de las salas (módulo `galeria`) ─────────────────────────────
-- Quien tiene `galeria` y NO `marketing` ve SÓLO lo liberado y aprobado: ni
-- borradores, ni diseños reemplazados, ni comentarios, ni pauta.
CREATE POLICY marketing_piezas_galeria ON public.marketing_piezas FOR SELECT TO authenticated
    USING (liberada AND estado IN ('aprobado','programado','publicado')
           AND (SELECT public.auth_has_module_permission('galeria','can_view')));
CREATE POLICY marketing_archivos_galeria ON public.marketing_archivos FOR SELECT TO authenticated
    USING (NOT reemplazado
           AND (SELECT public.auth_has_module_permission('galeria','can_view'))
           AND EXISTS (SELECT 1 FROM public.marketing_piezas p
                        WHERE p.id = marketing_archivos.pieza_id AND p.liberada
                          AND p.estado IN ('aprobado','programado','publicado')));
CREATE POLICY marketing_marcas_galeria ON public.marketing_marcas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('galeria','can_view')));

-- Storage: lo liberado para la galería (carpeta <mes>/<pieza>/…) y la
-- biblioteca de marca (carpeta `biblioteca/…`) para quien ve el planificador.
CREATE POLICY marketing_storage_galeria ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'marketing'
    AND (SELECT public.auth_has_module_permission('galeria','can_view'))
    AND EXISTS (SELECT 1 FROM public.marketing_piezas p
                 WHERE p.id::text = (storage.foldername(name))[2] AND p.liberada
                   AND p.estado IN ('aprobado','programado','publicado')));
CREATE POLICY marketing_storage_biblioteca ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'marketing' AND (storage.foldername(name))[1] = 'biblioteca'
    AND (SELECT public.auth_has_module_permission('marketing','can_view')));
-- Subir a la biblioteca también lo puede hacer quien aprueba (no sólo quien edita).
CREATE POLICY marketing_storage_biblioteca_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'marketing' AND (storage.foldername(name))[1] = 'biblioteca'
    AND (SELECT public.auth_has_module_permission('marketing','can_approve')));
CREATE POLICY marketing_storage_biblioteca_delete ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'marketing' AND (storage.foldername(name))[1] = 'biblioteca'
    AND (SELECT public.auth_has_module_permission('marketing','can_approve')));

-- Permisos de arranque de la galería: las salas y quienes ya ven el
-- planificador. Se ajustan en Permisos.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'galeria', true, false, false, 'ALL'
  FROM public.roles r
 WHERE r.name IN ('Jefe/a de Sala','Subjefe/a de Sala','Dependiente de Farmacia','Regente',
                  'Supervisor/a de Ventas','Gerente General','Administrador',
                  'Agente de Atencion de Canales Digitales','Diseñador/a Gráfico/a')
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.module_key = 'galeria');

-- ── Permisos de ejecución ──────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.marketing_archivo_version()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_anotar_archivo()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_retener_si_reabre()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_liberar_pieza(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_duplicar(uuid[], date, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marketing_liberar_pieza(uuid, boolean) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.marketing_duplicar(uuid[], date, text) TO authenticated, service_role;
