-- H32 — marketing: lo que el diseñador sube a una pieza DESPUÉS de enviarla
-- no lo ve nadie más hasta que la vuelva a enviar a revisión (decisión del
-- usuario, 2026-10-23). `marketing_archivos.borrador` lo pone la BASE
-- (trigger); un borrador sólo lo leen quien lo subió y quien creó la pieza;
-- una versión borrador no retira a la anterior; marketing_enviar_pieza y
-- marketing_publicar_mes publican los borradores (una pieza aprobada con
-- diseño nuevo vuelve a `finalizado`); el historial no muestra el enlace de un
-- borrador. Definiciones VIVAS de prod (después de segunda_a2_06).

SET lock_timeout = '5s';

ALTER TABLE public.marketing_archivos
    ADD COLUMN IF NOT EXISTS borrador boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.marketing_archivos.borrador IS
    'H32: subido después del envío a revisión y todavía no reenviado. Sólo lo ven quien lo subió y quien creó la pieza. Lo pone el trigger marketing_archivos_borrador y lo quita marketing_publicar_borradores.';

CREATE OR REPLACE FUNCTION public.marketing_archivo_borrador()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF coalesce(current_setting('marketing.por_funcion', true), '') = 'si' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.borrador IS DISTINCT FROM OLD.borrador THEN
        RAISE EXCEPTION 'Un diseño sin enviar se publica enviando la pieza a revisión';
    END IF;
    IF TG_OP = 'INSERT'
       OR (NEW.url, NEW.enlace, NEW.pieza_id) IS DISTINCT FROM (OLD.url, OLD.enlace, OLD.pieza_id) THEN
        NEW.borrador := EXISTS (
            SELECT 1 FROM public.marketing_piezas p
              JOIN public.marketing_meses m ON m.id = p.mes_id
             WHERE p.id = NEW.pieza_id
               AND (p.enviada_at IS NOT NULL OR m.publicado_at IS NOT NULL));
    END IF;
    RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.marketing_archivo_borrador() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_archivo_borrador() TO authenticated, service_role;

-- «…_borrador»: los BEFORE INSERT corren por orden alfabético y
-- `marketing_archivos_version` tiene que ver la marca ya puesta.
DROP TRIGGER IF EXISTS marketing_archivos_borrador ON public.marketing_archivos;
CREATE TRIGGER marketing_archivos_borrador
    BEFORE INSERT OR UPDATE ON public.marketing_archivos
    FOR EACH ROW EXECUTE FUNCTION public.marketing_archivo_borrador();

CREATE OR REPLACE FUNCTION public.marketing_archivo_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_ant public.marketing_archivos;
BEGIN
    IF NEW.anterior_id IS NULL THEN NEW.version := 1; RETURN NEW; END IF;
    SELECT * INTO v_ant FROM public.marketing_archivos WHERE id = NEW.anterior_id FOR UPDATE;
    IF NOT FOUND OR v_ant.pieza_id <> NEW.pieza_id THEN
        RAISE EXCEPTION 'La versión anterior no es de esta pieza';
    END IF;
    IF v_ant.reemplazado
       OR EXISTS (SELECT 1 FROM public.marketing_archivos s WHERE s.anterior_id = v_ant.id) THEN
        RAISE EXCEPTION 'Ese diseño ya tiene una versión más nueva';
    END IF;
    NEW.version := v_ant.version + 1;
    NEW.orden := v_ant.orden;
    IF NOT NEW.borrador OR v_ant.borrador THEN
        UPDATE public.marketing_archivos SET reemplazado = true WHERE id = v_ant.id;
    END IF;
    RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.marketing_anotar_archivo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_p public.marketing_piezas;
BEGIN
    SELECT * INTO v_p FROM public.marketing_piezas WHERE id = coalesce(NEW.pieza_id, OLD.pieza_id);
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, a, actor)
    VALUES (v_p.mes_id, v_p.id, v_p.titulo,
            CASE WHEN TG_OP = 'DELETE' THEN 'archivo_quitado'
                 WHEN NEW.anterior_id IS NOT NULL THEN 'version' ELSE 'archivo' END,
            CASE WHEN TG_OP = 'DELETE' THEN coalesce(OLD.nombre, CASE WHEN OLD.borrador THEN 'Enlace' ELSE OLD.enlace END)
                 WHEN NEW.anterior_id IS NOT NULL THEN 'V' || NEW.version || coalesce(' · ' || NEW.nombre, '')
                 ELSE coalesce(NEW.nombre, CASE WHEN NEW.borrador THEN 'Enlace' ELSE NEW.enlace END) END,
            public.auth_employee_id());
    RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.marketing_publicar_borradores(p_piezas uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_prev   text := coalesce(current_setting('marketing.por_funcion', true), '');
    v_piezas uuid[];
    v_n      integer;
BEGIN
    IF p_piezas IS NULL OR cardinality(p_piezas) = 0 THEN RETURN 0; END IF;
    PERFORM set_config('marketing.por_funcion', 'si', true);

    UPDATE public.marketing_archivos a SET reemplazado = true
     WHERE a.pieza_id = ANY (p_piezas) AND NOT a.reemplazado
       AND EXISTS (SELECT 1 FROM public.marketing_archivos s
                    WHERE s.anterior_id = a.id AND s.borrador);

    WITH pub AS (
        UPDATE public.marketing_archivos SET borrador = false
         WHERE pieza_id = ANY (p_piezas) AND borrador
        RETURNING pieza_id)
    SELECT array_agg(DISTINCT pieza_id), count(*) INTO v_piezas, v_n FROM pub;

    IF v_n > 0 THEN
        UPDATE public.marketing_piezas SET estado = 'finalizado'
         WHERE id = ANY (v_piezas) AND estado IN ('aprobado', 'programado');
    END IF;

    PERFORM set_config('marketing.por_funcion', v_prev, true);
    RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.marketing_publicar_borradores(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_publicar_borradores(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.marketing_enviar_pieza(p_pieza_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_p public.marketing_piezas; v_m public.marketing_meses; v_yo uuid := public.auth_employee_id();
        v_pub integer;
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
    v_pub := public.marketing_publicar_borradores(ARRAY[p_pieza_id]);
    INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, actor)
    VALUES (v_p.mes_id, v_p.id, v_p.titulo, 'enviada', v_yo);
    PERFORM public.marketing_avisar('can_approve',
        '«' || v_p.titulo || '» lista para revisar',
        'Apruébala o pide cambios.',
        '/marketing?tab=calendario&mes=' || to_char(v_m.mes, 'YYYY-MM') || '&pieza=' || p_pieza_id, true,
        jsonb_build_object('mes_id', v_m.id, 'pieza_id', p_pieza_id));
    RETURN json_build_object('enviada', true, 'disenos_publicados', v_pub);
END $function$;

CREATE OR REPLACE FUNCTION public.marketing_publicar_mes(p_mes_id uuid, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_mes   public.marketing_meses;
    v_yo    uuid := public.auth_employee_id();
    v_sin   integer;
    v_label text;
    v_pub   integer;
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_edit') THEN
        RAISE EXCEPTION 'FORBIDDEN: publicar el mes exige editar el planificador';
    END IF;
    SELECT * INTO v_mes FROM public.marketing_meses WHERE id = p_mes_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El mes no existe'; END IF;

    SELECT count(*) INTO v_sin FROM public.marketing_piezas WHERE mes_id = p_mes_id;
    IF v_sin = 0 THEN RAISE EXCEPTION 'El mes no tiene piezas para revisar'; END IF;

    PERFORM set_config('marketing.por_funcion', 'si', true);
    UPDATE public.marketing_meses
       SET estado = 'en_revision', version = version + 1,
           publicado_at = now(), publicado_por = v_yo,
           primer_envio_at = coalesce(primer_envio_at, now())
     WHERE id = p_mes_id
    RETURNING * INTO v_mes;
    IF nullif(btrim(p_nota), '') IS NOT NULL THEN
        INSERT INTO public.marketing_comentarios (mes_id, tipo, texto, autor_id)
        VALUES (p_mes_id, 'comentario', p_nota, v_yo);
    END IF;
    PERFORM set_config('marketing.por_funcion', '', true);

    v_pub := public.marketing_publicar_borradores(
        ARRAY(SELECT id FROM public.marketing_piezas WHERE mes_id = p_mes_id));

    v_label := public.marketing_nombre_mes(v_mes.mes);
    PERFORM public.marketing_avisar('can_approve',
        CASE WHEN v_mes.version = 1 THEN 'Calendario de ' || v_label || ' listo para revisar'
             ELSE 'Calendario de ' || v_label || ' actualizado (versión ' || v_mes.version || ')' END,
        coalesce(nullif(btrim(p_nota), ''), 'Revisa las piezas y deja tus comentarios o apruébalo.'),
        '/marketing?tab=calendario&mes=' || to_char(v_mes.mes, 'YYYY-MM'), true,
        jsonb_build_object('mes_id', p_mes_id));

    RETURN json_build_object('estado', v_mes.estado, 'version', v_mes.version, 'disenos_publicados', v_pub);
END $function$;

CREATE OR REPLACE FUNCTION public.marketing_objeto_es_borrador_ajeno(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_seg text := split_part(p_name, '/', 2);
    v_yo  uuid;
BEGIN
    IF v_seg !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
    END IF;
    v_yo := public.auth_employee_id();
    RETURN EXISTS (
        SELECT 1
          FROM public.marketing_archivos a
          JOIN public.marketing_piezas p ON p.id = a.pieza_id
         WHERE a.pieza_id = v_seg::uuid
           AND a.borrador
           AND right(a.url, length(p_name) + 1) = '/' || p_name
           AND a.subido_por IS DISTINCT FROM v_yo
           AND p.created_by IS DISTINCT FROM v_yo);
END $function$;

REVOKE ALL ON FUNCTION public.marketing_objeto_es_borrador_ajeno(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_objeto_es_borrador_ajeno(text) TO authenticated, service_role;

DROP POLICY IF EXISTS marketing_archivos_select ON public.marketing_archivos;
CREATE POLICY marketing_archivos_select ON public.marketing_archivos
    FOR SELECT TO authenticated
    USING (
        (NOT borrador
         OR subido_por = (SELECT public.auth_employee_id())
         OR pieza_id IN (SELECT p.id FROM public.marketing_piezas p
                          WHERE p.created_by = (SELECT public.auth_employee_id())))
        AND (
            (SELECT public.auth_has_module_permission('marketing', 'can_edit'))
            OR ((SELECT public.auth_has_module_permission('marketing', 'can_view'))
                AND EXISTS (SELECT 1 FROM public.marketing_piezas p
                              JOIN public.marketing_meses m ON m.id = p.mes_id
                             WHERE p.id = marketing_archivos.pieza_id
                               AND (m.publicado_at IS NOT NULL OR p.enviada_at IS NOT NULL)))));

DROP POLICY IF EXISTS marketing_archivos_galeria ON public.marketing_archivos;
CREATE POLICY marketing_archivos_galeria ON public.marketing_archivos
    FOR SELECT TO authenticated
    USING (
        NOT reemplazado AND NOT borrador
        AND (SELECT public.auth_has_module_permission('galeria', 'can_view'))
        AND EXISTS (SELECT 1 FROM public.marketing_piezas p
                     WHERE p.id = marketing_archivos.pieza_id AND p.liberada
                       AND p.estado = ANY (ARRAY['aprobado', 'programado', 'publicado'])));

DROP POLICY IF EXISTS marketing_storage_select ON storage.objects;
CREATE POLICY marketing_storage_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'marketing'
        AND ((SELECT public.auth_has_module_permission('marketing', 'can_edit'))
             OR ((SELECT public.auth_has_module_permission('marketing', 'can_view'))
                 AND (EXISTS (SELECT 1 FROM public.marketing_meses m
                               WHERE m.id::text = (storage.foldername(objects.name))[1]
                                 AND m.publicado_at IS NOT NULL)
                      OR EXISTS (SELECT 1 FROM public.marketing_piezas p
                                  WHERE p.id::text = (storage.foldername(objects.name))[2]
                                    AND p.enviada_at IS NOT NULL))))
        AND NOT public.marketing_objeto_es_borrador_ajeno(name));

DROP POLICY IF EXISTS marketing_storage_galeria ON storage.objects;
CREATE POLICY marketing_storage_galeria ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'marketing'
        AND (SELECT public.auth_has_module_permission('galeria', 'can_view'))
        AND EXISTS (SELECT 1 FROM public.marketing_piezas p
                     WHERE p.id::text = (storage.foldername(objects.name))[2] AND p.liberada
                       AND p.estado = ANY (ARRAY['aprobado', 'programado', 'publicado']))
        AND NOT public.marketing_objeto_es_borrador_ajeno(name));
