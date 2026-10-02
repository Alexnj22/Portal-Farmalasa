-- Planificador de contenido, quinta tanda (pedido del usuario, 2026-10-01):
--   · OK individuales: una pieza se envía SOLA a revisión y se aprueba al momento;
--   · aviso a las salas al liberar material (con el push espaciado);
--   · control del servicio del diseñador según su oferta (30-sep-2026): metas
--     mensuales, 10 días de anticipación por pieza, calendario desde el mes
--     anterior, visitas presenciales, entregables del manual de marca, rondas de
--     cambios y un CIERRE mensual firmado que congela el acta para el pago.
SET lock_timeout = '5s';

-- ── Campos nuevos ──────────────────────────────────────────────────────────
ALTER TABLE public.marketing_piezas
    ADD COLUMN enviada_at  timestamptz,
    ADD COLUMN enviada_por uuid REFERENCES public.employees(id);
ALTER TABLE public.marketing_meses
    ADD COLUMN primer_envio_at timestamptz;

-- Lo que alimenta la evaluación no lo escribe nadie a mano: sólo las funciones.
CREATE FUNCTION public.marketing_campos_de_control()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    IF coalesce(current_setting('marketing.por_funcion', true), '') = 'si' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'marketing_piezas'
       AND (NEW.enviada_at, NEW.enviada_por) IS DISTINCT FROM (OLD.enviada_at, OLD.enviada_por) THEN
        RAISE EXCEPTION 'El envío a revisión lo registra el portal';
    END IF;
    IF TG_TABLE_NAME = 'marketing_meses' AND NEW.primer_envio_at IS DISTINCT FROM OLD.primer_envio_at THEN
        RAISE EXCEPTION 'El envío del calendario lo registra el portal';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_piezas_control BEFORE UPDATE OF enviada_at, enviada_por ON public.marketing_piezas
    FOR EACH ROW EXECUTE FUNCTION public.marketing_campos_de_control();
CREATE TRIGGER marketing_meses_control BEFORE UPDATE OF primer_envio_at ON public.marketing_meses
    FOR EACH ROW EXECUTE FUNCTION public.marketing_campos_de_control();

ALTER TABLE public.marketing_historial DROP CONSTRAINT marketing_historial_evento_check;
ALTER TABLE public.marketing_historial ADD CONSTRAINT marketing_historial_evento_check
    CHECK (evento IN ('creada','estado','fecha','archivo','archivo_quitado','quitada','version','liberada','retenida','enviada'));

-- ── Metas del contrato (en ajustes, editables al terminar la prueba) ───────
ALTER TABLE public.marketing_ajustes
    ADD COLUMN meta_publicaciones smallint NOT NULL DEFAULT 12 CHECK (meta_publicaciones >= 0),
    ADD COLUMN meta_videos        smallint NOT NULL DEFAULT 4  CHECK (meta_videos >= 0),
    ADD COLUMN meta_visitas       smallint NOT NULL DEFAULT 1  CHECK (meta_visitas >= 0),
    ADD COLUMN dias_anticipacion  smallint NOT NULL DEFAULT 10 CHECK (dias_anticipacion >= 0),
    -- El calendario «desde el mes anterior» se exige desde noviembre de 2026:
    -- octubre arrancó ya empezado el mes (decisión del usuario).
    ADD COLUMN control_desde      date     NOT NULL DEFAULT '2026-11-01';

-- El manual de marca es un entregable mensual del contrato: va a la biblioteca.
ALTER TABLE public.marketing_recursos DROP CONSTRAINT marketing_recursos_tipo_check;
ALTER TABLE public.marketing_recursos ADD CONSTRAINT marketing_recursos_tipo_check
    CHECK (tipo IN ('logo','color','tipografia','foto','plantilla','manual','otro'));

-- ── Visitas presenciales ───────────────────────────────────────────────────
CREATE TABLE public.marketing_visitas (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha          date NOT NULL,
    branch_id      integer REFERENCES public.branches(id),
    notas          text,
    registrada_por uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_visitas_fecha_idx ON public.marketing_visitas (fecha DESC);
CREATE INDEX marketing_visitas_branch_idx ON public.marketing_visitas (branch_id);
ALTER TABLE public.marketing_visitas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_visitas FROM anon;
GRANT SELECT, INSERT, DELETE ON public.marketing_visitas TO authenticated;
GRANT ALL ON public.marketing_visitas TO service_role;
CREATE POLICY marketing_visitas_select ON public.marketing_visitas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_visitas_insert ON public.marketing_visitas FOR INSERT TO authenticated
    WITH CHECK (((SELECT public.auth_has_module_permission('marketing','can_edit'))
                 OR (SELECT public.auth_has_module_permission('marketing','can_approve')))
                AND registrada_por = (SELECT public.auth_employee_id()));
CREATE POLICY marketing_visitas_delete ON public.marketing_visitas FOR DELETE TO authenticated
    USING (registrada_por = (SELECT public.auth_employee_id())
           OR (SELECT public.auth_has_module_permission('marketing','can_approve')));

-- ── Cierres mensuales ──────────────────────────────────────────────────────
-- Uno por mes. `resumen` es la FOTO de los números al firmar: el mes se puede
-- seguir corrigiendo y el acta no cambia, porque es lo que se evaluó para el
-- pago. Volver a firmar la reemplaza (queda en audit_logs).
CREATE TABLE public.marketing_cierres (
    mes_id        uuid PRIMARY KEY REFERENCES public.marketing_meses(id) ON DELETE CASCADE,
    resultado     text NOT NULL CHECK (resultado IN ('cumplio','con_observaciones','no_cumplio')),
    observaciones text,
    resumen       jsonb NOT NULL,
    firmado_por   uuid NOT NULL REFERENCES public.employees(id),
    firmado_at    timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_cierres_firmado_idx ON public.marketing_cierres (firmado_por);
ALTER TABLE public.marketing_cierres ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_cierres FROM anon;
GRANT SELECT ON public.marketing_cierres TO authenticated;
GRANT ALL ON public.marketing_cierres TO service_role;
CREATE POLICY marketing_cierres_select ON public.marketing_cierres FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_view')));

-- ── El cumplimiento de un mes ──────────────────────────────────────────────
-- Cuenta como entregado lo APROBADO (aprobado, programado o publicado): lo
-- terminado sin aprobar todavía no es un entregable.
-- «A tiempo» por pieza: el primer momento en que quedó lista para revisión,
-- contra su fecha de publicación menos los días de anticipación del contrato.
CREATE FUNCTION public.marketing_cumplimiento(p_mes_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_m   public.marketing_meses;
    v_aj  public.marketing_ajustes;
    v_fin date;
    v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_limite_cal timestamptz;
    r json;
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_view') THEN
        RAISE EXCEPTION 'FORBIDDEN: el control exige ver Marketing';
    END IF;
    SELECT * INTO v_m FROM public.marketing_meses WHERE id = p_mes_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO v_aj FROM public.marketing_ajustes WHERE id;
    v_fin := (v_m.mes + interval '1 month - 1 day')::date;
    -- Límite del calendario: el día límite del mes ANTERIOR, al final del día.
    v_limite_cal := (((v_m.mes - interval '1 month')::date + (v_aj.dia_limite_envio - 1)) + time '23:59:59')
                    AT TIME ZONE 'America/El_Salvador';

    WITH p AS (
        SELECT pz.*,
               pz.estado IN ('aprobado','programado','publicado') AS ok,
               (SELECT min(h.created_at) FROM public.marketing_historial h
                 WHERE h.pieza_id = pz.id AND h.evento = 'estado' AND h.a = 'finalizado') AS lista_at,
               (SELECT count(*) FROM public.marketing_comentarios c
                 WHERE c.pieza_id = pz.id AND c.tipo = 'cambio') AS cambios
          FROM public.marketing_piezas pz
         WHERE pz.mes_id = p_mes_id
    ), puntual AS (
        SELECT p.id,
               CASE WHEN p.lista_at IS NOT NULL
                         THEN (p.lista_at AT TIME ZONE 'America/El_Salvador')::date <= p.fecha - v_aj.dias_anticipacion
                    WHEN p.fecha - v_aj.dias_anticipacion < v_hoy THEN false
                    ELSE NULL END AS a_tiempo
          FROM p
    ), correcciones AS (
        -- De cada cambio pedido a la siguiente vez que la pieza volvió a estar lista.
        SELECT extract(epoch FROM (
                   (SELECT min(h.created_at) FROM public.marketing_historial h
                     WHERE h.pieza_id = c.pieza_id AND h.evento = 'estado' AND h.a = 'finalizado'
                       AND h.created_at > c.created_at) - c.created_at)) / 3600.0 AS horas
          FROM public.marketing_comentarios c JOIN p ON p.id = c.pieza_id
         WHERE c.tipo = 'cambio'
    )
    SELECT json_build_object(
        'mes', v_m.mes,
        'metas', json_build_object('publicaciones', v_aj.meta_publicaciones, 'videos', v_aj.meta_videos,
                                   'visitas', v_aj.meta_visitas, 'dias_anticipacion', v_aj.dias_anticipacion),
        'publicaciones', json_build_object(
            'aprobadas', (SELECT count(*) FROM p WHERE ok AND formato IN ('post','carrusel')),
            'planificadas', (SELECT count(*) FROM p WHERE formato IN ('post','carrusel'))),
        'videos', json_build_object(
            'aprobados', (SELECT count(*) FROM p WHERE ok AND formato IN ('reel','video')),
            'planificados', (SELECT count(*) FROM p WHERE formato IN ('reel','video'))),
        'historias', (SELECT count(*) FROM p WHERE ok AND formato = 'historia'),
        'piezas', json_build_object(
            'total', (SELECT count(*) FROM p),
            'aprobadas', (SELECT count(*) FROM p WHERE ok),
            'publicadas', (SELECT count(*) FROM p WHERE estado = 'publicado')),
        'puntualidad', json_build_object(
            'a_tiempo', (SELECT count(*) FROM puntual WHERE a_tiempo),
            'tarde', (SELECT count(*) FROM puntual WHERE a_tiempo = false),
            'por_vencer', (SELECT count(*) FROM puntual WHERE a_tiempo IS NULL)),
        'cambios', json_build_object(
            'rondas', (SELECT coalesce(sum(cambios), 0) FROM p),
            'piezas_con_cambios', (SELECT count(*) FROM p WHERE cambios > 0),
            'maximo', (SELECT coalesce(max(cambios), 0) FROM p),
            'horas_correccion', (SELECT round(avg(horas)::numeric, 1) FROM correcciones WHERE horas IS NOT NULL)),
        'calendario', json_build_object(
            'exento', v_m.mes < v_aj.control_desde,
            'limite', v_limite_cal,
            'enviado', v_m.primer_envio_at,
            'a_tiempo', CASE WHEN v_m.mes < v_aj.control_desde THEN NULL
                             WHEN v_m.primer_envio_at IS NULL THEN (CASE WHEN now() > v_limite_cal THEN false END)
                             ELSE v_m.primer_envio_at <= v_limite_cal END),
        'visitas', (SELECT count(*) FROM public.marketing_visitas WHERE fecha BETWEEN v_m.mes AND v_fin),
        'manual', (SELECT count(*) FROM public.marketing_recursos
                    WHERE tipo = 'manual' AND (created_at AT TIME ZONE 'America/El_Salvador')::date BETWEEN v_m.mes AND v_fin),
        'extraordinarias', (SELECT json_build_object(
                'pedidas', count(*),
                'entregadas', count(*) FILTER (WHERE estado = 'entregada'),
                'dias_entrega', round(avg(extract(epoch FROM (updated_at - created_at)) / 86400.0)
                                      FILTER (WHERE estado = 'entregada')::numeric, 1))
              FROM public.marketing_solicitudes
             WHERE (created_at AT TIME ZONE 'America/El_Salvador')::date BETWEEN v_m.mes AND v_fin)
    ) INTO r;
    RETURN r;
END $$;

-- ── Firmar el cierre ───────────────────────────────────────────────────────
CREATE FUNCTION public.marketing_cerrar_mes(p_mes_id uuid, p_resultado text, p_observaciones text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m public.marketing_meses; v_yo uuid := public.auth_employee_id(); v_res jsonb;
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_approve') THEN
        RAISE EXCEPTION 'FORBIDDEN: el cierre lo firma quien aprueba';
    END IF;
    IF p_resultado NOT IN ('cumplio','con_observaciones','no_cumplio') THEN
        RAISE EXCEPTION 'Resultado desconocido: %', p_resultado;
    END IF;
    IF p_resultado <> 'cumplio' AND nullif(btrim(p_observaciones), '') IS NULL THEN
        RAISE EXCEPTION 'Un cierre con observaciones exige escribirlas';
    END IF;
    SELECT * INTO v_m FROM public.marketing_meses WHERE id = p_mes_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El mes no existe'; END IF;
    v_res := public.marketing_cumplimiento(p_mes_id)::jsonb;
    INSERT INTO public.marketing_cierres (mes_id, resultado, observaciones, resumen, firmado_por, firmado_at)
    VALUES (p_mes_id, p_resultado, nullif(btrim(p_observaciones), ''), v_res, v_yo, now())
    ON CONFLICT (mes_id) DO UPDATE
       SET resultado = EXCLUDED.resultado, observaciones = EXCLUDED.observaciones,
           resumen = EXCLUDED.resumen, firmado_por = EXCLUDED.firmado_por, firmado_at = EXCLUDED.firmado_at;
    PERFORM public.marketing_avisar('can_edit',
        'Cierre de ' || public.marketing_nombre_mes(v_m.mes) || ': ' ||
        CASE p_resultado WHEN 'cumplio' THEN 'cumplió' WHEN 'con_observaciones' THEN 'con observaciones' ELSE 'no cumplió' END,
        coalesce(nullif(btrim(p_observaciones), ''), 'El acta del mes quedó firmada.'),
        '/marketing?tab=servicio&mes=' || to_char(v_m.mes, 'YYYY-MM'), true,
        jsonb_build_object('mes_id', p_mes_id));
    RETURN json_build_object('resultado', p_resultado);
END $$;

-- ── Enviar UNA pieza a revisión ────────────────────────────────────────────
CREATE FUNCTION public.marketing_enviar_pieza(p_pieza_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_p public.marketing_piezas; v_m public.marketing_meses; v_yo uuid := public.auth_employee_id();
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_edit') THEN
        RAISE EXCEPTION 'FORBIDDEN: enviar exige editar el planificador';
    END IF;
    SELECT * INTO v_p FROM public.marketing_piezas WHERE id = p_pieza_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La pieza no existe'; END IF;
    IF v_p.estado <> 'finalizado' THEN
        RAISE EXCEPTION 'Sólo se envía una pieza lista para revisión';
    END IF;
    SELECT * INTO v_m FROM public.marketing_meses WHERE id = v_p.mes_id;
    PERFORM set_config('marketing.por_funcion', 'si', true);
    UPDATE public.marketing_piezas SET enviada_at = now(), enviada_por = v_yo WHERE id = p_pieza_id;
    PERFORM set_config('marketing.por_funcion', '', true);
    INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, actor)
    VALUES (v_p.mes_id, v_p.id, v_p.titulo, 'enviada', v_yo);
    PERFORM public.marketing_avisar('can_approve',
        '«' || v_p.titulo || '» lista para revisar',
        'Apruébala o pide cambios.',
        '/marketing?tab=calendario&mes=' || to_char(v_m.mes, 'YYYY-MM') || '&pieza=' || p_pieza_id, true,
        jsonb_build_object('mes_id', v_m.id, 'pieza_id', p_pieza_id));
    RETURN json_build_object('enviada', true);
END $$;

-- ── Revisar: también una pieza enviada sola ────────────────────────────────
CREATE OR REPLACE FUNCTION public.marketing_revisar_pieza(p_pieza_id uuid, p_decision text, p_texto text DEFAULT NULL::text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
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
    -- Se revisa lo que se envió: el mes entero o la pieza sola.
    IF v_m.publicado_at IS NULL AND v_p.enviada_at IS NULL THEN
        RAISE EXCEPTION 'La pieza todavía no se envió a revisión';
    END IF;
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
END $function$;

-- ── Publicar el mes: registra el PRIMER envío (para el control) ────────────
CREATE OR REPLACE FUNCTION public.marketing_publicar_mes(p_mes_id uuid, p_nota text DEFAULT NULL::text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
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
           publicado_at = now(), publicado_por = v_yo,
           primer_envio_at = coalesce(primer_envio_at, now())
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
END $function$;

-- ── Quién ve los diseños: el mes enviado, o la pieza enviada sola ──────────
DROP POLICY marketing_archivos_select ON public.marketing_archivos;
CREATE POLICY marketing_archivos_select ON public.marketing_archivos FOR SELECT TO authenticated USING (
    (SELECT public.auth_has_module_permission('marketing','can_edit'))
    OR ((SELECT public.auth_has_module_permission('marketing','can_view'))
        AND EXISTS (SELECT 1 FROM public.marketing_piezas p
                      JOIN public.marketing_meses m ON m.id = p.mes_id
                     WHERE p.id = marketing_archivos.pieza_id
                       AND (m.publicado_at IS NOT NULL OR p.enviada_at IS NOT NULL)))
);
DROP POLICY marketing_storage_select ON storage.objects;
CREATE POLICY marketing_storage_select ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'marketing'
    AND ((SELECT public.auth_has_module_permission('marketing','can_edit'))
         OR ((SELECT public.auth_has_module_permission('marketing','can_view'))
             AND (EXISTS (SELECT 1 FROM public.marketing_meses m
                           WHERE m.id::text = (storage.foldername(name))[1] AND m.publicado_at IS NOT NULL)
                  OR EXISTS (SELECT 1 FROM public.marketing_piezas p
                              WHERE p.id::text = (storage.foldername(name))[2] AND p.enviada_at IS NOT NULL)))));

-- ── Liberar: ahora avisa a las salas ───────────────────────────────────────
-- El push suena con la primera pieza liberada; las que siguen en los próximos
-- 15 minutos llegan a la campana sin sonar (diez piezas seguidas no son diez
-- vibraciones en el teléfono de cada dependiente).
CREATE OR REPLACE FUNCTION public.marketing_liberar_pieza(p_pieza_id uuid, p_liberar boolean)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_p public.marketing_piezas; v_yo uuid := public.auth_employee_id();
    v_dest uuid[]; v_push boolean;
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

    IF p_liberar THEN
        SELECT array_agg(DISTINCT e.id) INTO v_dest
          FROM public.employees e
          JOIN public.role_permissions rp ON rp.role_id IN (e.role_id, e.secondary_role_id)
                                         AND rp.module_key = 'galeria' AND rp.can_view
         WHERE e.status = 'ACTIVO' AND e.id IS DISTINCT FROM v_yo;
        v_push := NOT EXISTS (SELECT 1 FROM public.notifications
                               WHERE type = 'GALERIA' AND created_at > now() - interval '15 minutes');
        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(v_dest, 'GALERIA', 'Material nuevo para WhatsApp',
                '«' || v_p.titulo || '» ya se puede descargar en Galería.', '/galeria',
                jsonb_build_object('pieza_id', p_pieza_id), v_push, NULL);
        END IF;
    END IF;
    RETURN json_build_object('liberada', p_liberar);
END $$;

-- ── Permisos de ejecución ──────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.marketing_campos_de_control()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_cumplimiento(uuid)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_cerrar_mes(uuid, text, text)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_enviar_pieza(uuid)                  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marketing_cumplimiento(uuid)                  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.marketing_cerrar_mes(uuid, text, text)        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.marketing_enviar_pieza(uuid)                  TO authenticated, service_role;
