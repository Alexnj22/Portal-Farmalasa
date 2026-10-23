-- segunda-a2-06 · marketing: lo que no se aprobó no sale (H30, H31, H33)
-- H30 «publicado» sólo desde aprobado; H31 cambiar archivo reabre y el objeto
-- aprobado no se borra; H33 comentarios inmutables salvo `resuelto`.
-- Partido de las definiciones VIVAS (2026-10-23).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.marketing_candado_de_estado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
        -- H30: «publicado» también es un estado al que sólo se llega con la
        -- aprobación. La regla vivía sólo en la pantalla (puedeMoverA): por la
        -- API se publicaba una pieza nunca revisada y llegaba a Galería.
        IF NEW.estado = 'publicado' AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('aprobado','programado','publicado')) THEN
            RAISE EXCEPTION 'Sólo se publica una pieza aprobada';
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
END $function$;

CREATE OR REPLACE FUNCTION public.marketing_archivo_reabre_pieza()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    PERFORM set_config('marketing.por_funcion', 'si', true);
    -- H31: también al CAMBIAR un archivo (url, enlace o pieza), y las dos
    -- piezas si se movió de una a otra.
    UPDATE public.marketing_piezas SET estado = 'finalizado'
     WHERE id IN (CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.pieza_id END,
                  CASE WHEN TG_OP IN ('DELETE', 'UPDATE') THEN OLD.pieza_id END)
       AND estado IN ('aprobado','programado');
    PERFORM set_config('marketing.por_funcion', '', true);
    RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS marketing_archivos_reabre_al_cambiar ON public.marketing_archivos;
CREATE TRIGGER marketing_archivos_reabre_al_cambiar
    AFTER UPDATE OF url, enlace, pieza_id ON public.marketing_archivos
    FOR EACH ROW
    WHEN ((NEW.url, NEW.enlace, NEW.pieza_id) IS DISTINCT FROM (OLD.url, OLD.enlace, OLD.pieza_id))
    EXECUTE FUNCTION public.marketing_archivo_reabre_pieza();

DROP POLICY IF EXISTS marketing_storage_delete ON storage.objects;
CREATE POLICY marketing_storage_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'marketing'
           AND (SELECT public.auth_has_module_permission('marketing', 'can_edit'))
           -- H31: el diseño que alguien aprobó no se reemplaza por debajo.
           AND NOT EXISTS (SELECT 1 FROM public.marketing_piezas p
                            WHERE p.id::text = (storage.foldername(objects.name))[2]
                              AND p.estado IN ('aprobado', 'programado', 'publicado')));

CREATE OR REPLACE FUNCTION public.marketing_comentario_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF coalesce(current_setting('marketing.por_funcion', true), '') = 'si' THEN
        RETURN NEW;
    END IF;
    -- H33: de un comentario se marca `resuelto` y su autor corrige el texto
    -- (marketing_comentario_hilo). Quién lo firmó, de qué tipo es y a qué
    -- pieza pertenece no cambian: una aprobación o un pedido de cambios no se
    -- reescribe.
    IF (NEW.tipo, NEW.autor_id, NEW.mes_id, NEW.pieza_id, NEW.respuesta_a, NEW.archivo_id, NEW.created_at)
       IS DISTINCT FROM (OLD.tipo, OLD.autor_id, OLD.mes_id, OLD.pieza_id, OLD.respuesta_a, OLD.archivo_id, OLD.created_at) THEN
        RAISE EXCEPTION 'De un comentario sólo se marca si está resuelto';
    END IF;
    IF NEW.marca IS DISTINCT FROM OLD.marca AND OLD.autor_id IS DISTINCT FROM public.auth_employee_id() THEN
        RAISE EXCEPTION 'Sólo quien escribió el comentario mueve su marca';
    END IF;
    RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.marketing_comentario_inmutable() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS marketing_comentarios_inmutable ON public.marketing_comentarios;
CREATE TRIGGER marketing_comentarios_inmutable
    BEFORE UPDATE ON public.marketing_comentarios
    FOR EACH ROW EXECUTE FUNCTION public.marketing_comentario_inmutable();
