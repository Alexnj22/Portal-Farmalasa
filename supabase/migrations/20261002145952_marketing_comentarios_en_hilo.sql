-- Comentarios en hilo (pedido del usuario, 2026-10-02): en la vista del mes,
-- una conversación entre gerencia y el diseñador con comentarios sueltos y
-- respuestas. Un solo nivel: responder a una respuesta cuelga del comentario
-- raíz, como en los chats — un árbol profundo no se lee en un teléfono.
-- Además, cada quien corrige o quita lo que escribió.
SET lock_timeout = '5s';

ALTER TABLE public.marketing_comentarios
    ADD COLUMN respuesta_a uuid REFERENCES public.marketing_comentarios(id) ON DELETE CASCADE,
    ADD COLUMN editado_at  timestamptz;
CREATE INDEX marketing_comentarios_respuesta_idx ON public.marketing_comentarios (respuesta_a);

-- La respuesta hereda el mes y la pieza de su raíz: el cliente no puede
-- colgarla de un hilo y mandarla a otro mes.
CREATE FUNCTION public.marketing_comentario_hilo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_raiz public.marketing_comentarios;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.respuesta_a IS NOT NULL THEN
            SELECT * INTO v_raiz FROM public.marketing_comentarios WHERE id = NEW.respuesta_a;
            IF NOT FOUND THEN RAISE EXCEPTION 'El comentario al que respondes ya no existe'; END IF;
            IF v_raiz.respuesta_a IS NOT NULL THEN
                SELECT * INTO v_raiz FROM public.marketing_comentarios WHERE id = v_raiz.respuesta_a;
            END IF;
            NEW.respuesta_a := v_raiz.id;
            NEW.mes_id      := v_raiz.mes_id;
            NEW.pieza_id    := v_raiz.pieza_id;
        END IF;
        NEW.editado_at := NULL;
    ELSIF NEW.texto IS DISTINCT FROM OLD.texto THEN
        -- Quien puede marcar resuelto (otra policy) no por eso reescribe lo que dijo otro.
        IF OLD.autor_id IS DISTINCT FROM public.auth_employee_id() THEN
            RAISE EXCEPTION 'Sólo quien escribió el comentario lo corrige';
        END IF;
        IF nullif(btrim(NEW.texto), '') IS NULL THEN RAISE EXCEPTION 'El comentario no puede quedar vacío'; END IF;
        NEW.editado_at := now();
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_comentarios_hilo BEFORE INSERT OR UPDATE OF texto ON public.marketing_comentarios
    FOR EACH ROW EXECUTE FUNCTION public.marketing_comentario_hilo();

-- Corregir lo propio: sólo el texto (privilegio por columna) y sólo los
-- comentarios — un «Aprobado» o un pedido de cambio son decisiones, no charla.
GRANT UPDATE (texto) ON public.marketing_comentarios TO authenticated;
CREATE POLICY marketing_comentarios_update_propio ON public.marketing_comentarios FOR UPDATE TO authenticated
    USING (autor_id = (SELECT public.auth_employee_id()) AND tipo = 'comentario')
    WITH CHECK (autor_id = (SELECT public.auth_employee_id()) AND tipo = 'comentario');

-- Quitar lo propio, mientras nadie le haya respondido: borrar una raíz con
-- respuestas se llevaría lo que escribieron otros.
CREATE POLICY marketing_comentarios_delete_propio ON public.marketing_comentarios FOR DELETE TO authenticated
    USING (autor_id = (SELECT public.auth_employee_id()) AND tipo = 'comentario'
           AND NOT EXISTS (SELECT 1 FROM public.marketing_comentarios r WHERE r.respuesta_a = marketing_comentarios.id));

-- El aviso: como antes al otro lado (quien diseña ↔ quien aprueba), y además
-- a quienes ya participan del hilo, con push: alguien te respondió.
CREATE OR REPLACE FUNCTION public.marketing_avisar_comentario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_mes date; v_titulo text; v_yo uuid := public.auth_employee_id();
    v_lado text; v_dest uuid[]; v_hilo uuid[]; v_link text; v_cab text; v_quien text;
BEGIN
    IF NEW.tipo <> 'comentario' OR coalesce(current_setting('marketing.por_funcion', true), '') = 'si' THEN
        RETURN NEW;
    END IF;
    SELECT mes INTO v_mes FROM public.marketing_meses WHERE id = NEW.mes_id;
    SELECT titulo INTO v_titulo FROM public.marketing_piezas WHERE id = NEW.pieza_id;
    v_lado := CASE WHEN public.auth_has_module_permission('marketing','can_edit') THEN 'can_approve' ELSE 'can_edit' END;
    v_link := '/marketing?tab=calendario&mes=' || to_char(v_mes, 'YYYY-MM') || coalesce('&pieza=' || NEW.pieza_id, '');
    v_cab  := coalesce(' en «' || v_titulo || '»', ' en el calendario de ' || public.marketing_nombre_mes(v_mes));

    PERFORM public.marketing_avisar(v_lado,
        CASE WHEN NEW.respuesta_a IS NULL THEN 'Comentario' ELSE 'Respuesta' END || v_cab,
        left(NEW.texto, 200), v_link, false,
        jsonb_build_object('mes_id', NEW.mes_id, 'pieza_id', NEW.pieza_id, 'comentario_id', NEW.id));

    IF NEW.respuesta_a IS NOT NULL THEN
        v_dest := public.marketing_destinatarios(v_lado, v_yo);
        SELECT array_agg(DISTINCT c.autor_id) INTO v_hilo
          FROM public.marketing_comentarios c
         WHERE (c.id = NEW.respuesta_a OR c.respuesta_a = NEW.respuesta_a)
           AND c.autor_id IS DISTINCT FROM v_yo
           AND NOT (c.autor_id = ANY (coalesce(v_dest, '{}')));
        IF coalesce(array_length(v_hilo, 1), 0) > 0 THEN
            SELECT split_part(btrim(name), ' ', 1) INTO v_quien FROM public.employees WHERE id = v_yo;
            PERFORM public.notify_employees(v_hilo, 'MARKETING',
                coalesce(v_quien, 'Alguien') || ' te respondió' || v_cab,
                left(NEW.texto, 200), v_link,
                jsonb_build_object('mes_id', NEW.mes_id, 'pieza_id', NEW.pieza_id, 'comentario_id', NEW.id, 'quien_id', v_yo),
                true, NULL);
        END IF;
    END IF;
    RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.marketing_comentario_hilo() FROM PUBLIC, anon, authenticated;
