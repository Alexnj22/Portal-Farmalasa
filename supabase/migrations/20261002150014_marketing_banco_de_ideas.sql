-- Banco de ideas (pedido del usuario, 2026-10-02): cualquiera con acceso a
-- Marketing deja una idea, con quién y a qué hora; el diseñador la toma («en
-- trabajo») y la resuelve ligándola a la pieza donde la usó, o la descarta.
-- Cada paso queda con su persona y su hora en la misma fila.
SET lock_timeout = '5s';

CREATE TABLE public.marketing_ideas (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo        text NOT NULL CHECK (btrim(titulo) <> ''),
    detalle       text,
    marca_id      smallint REFERENCES public.marketing_marcas(id),
    formato       text,
    estado        text NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva','en_trabajo','usada','descartada')),
    autor_id      uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    tomada_por    uuid REFERENCES public.employees(id),
    tomada_at     timestamptz,
    pieza_id      uuid REFERENCES public.marketing_piezas(id) ON DELETE SET NULL,
    cerrada_por   uuid REFERENCES public.employees(id),
    cerrada_at    timestamptz,
    nota_cierre   text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_ideas_estado_idx ON public.marketing_ideas (estado, created_at DESC);
CREATE INDEX marketing_ideas_pieza_idx  ON public.marketing_ideas (pieza_id);
CREATE INDEX marketing_ideas_marca_idx  ON public.marketing_ideas (marca_id);
CREATE INDEX marketing_ideas_autor_idx  ON public.marketing_ideas (autor_id);

ALTER TABLE public.marketing_ideas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_ideas FROM anon, authenticated;
GRANT SELECT, DELETE ON public.marketing_ideas TO authenticated;
-- Lo que escribe quien propone. El estado, quién la tomó y la pieza sólo los
-- mueve `marketing_idea_mover`: no hay privilegio de columna para eso.
GRANT INSERT (titulo, detalle, marca_id, formato, autor_id) ON public.marketing_ideas TO authenticated;
GRANT UPDATE (titulo, detalle, marca_id, formato)           ON public.marketing_ideas TO authenticated;
GRANT ALL ON public.marketing_ideas TO service_role;

CREATE POLICY marketing_ideas_select ON public.marketing_ideas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_ideas_insert ON public.marketing_ideas FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_view'))
                AND autor_id = (SELECT public.auth_employee_id()));
-- Se corrige mientras nadie la tomó.
CREATE POLICY marketing_ideas_update ON public.marketing_ideas FOR UPDATE TO authenticated
    USING (autor_id = (SELECT public.auth_employee_id()) AND estado = 'nueva')
    WITH CHECK (autor_id = (SELECT public.auth_employee_id()) AND estado = 'nueva');
-- La quita quien la escribió mientras siga nueva, o quien aprueba.
CREATE POLICY marketing_ideas_delete ON public.marketing_ideas FOR DELETE TO authenticated
    USING ((autor_id = (SELECT public.auth_employee_id()) AND estado = 'nueva')
           OR (SELECT public.auth_has_module_permission('marketing','can_approve')));

-- Aviso al diseñador cuando entra una idea (a la campana, sin sonar).
CREATE FUNCTION public.marketing_avisar_idea()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    PERFORM public.marketing_avisar('can_edit', 'Idea nueva: «' || NEW.titulo || '»',
        coalesce(left(NEW.detalle, 200), 'Está en el banco de ideas.'),
        '/marketing?tab=ideas', false, jsonb_build_object('idea_id', NEW.id));
    RETURN NEW;
END $$;
CREATE TRIGGER marketing_ideas_aviso AFTER INSERT ON public.marketing_ideas
    FOR EACH ROW EXECUTE FUNCTION public.marketing_avisar_idea();

-- Mover una idea: tomarla, usarla en una pieza, descartarla o reabrirla.
CREATE FUNCTION public.marketing_idea_mover(p_id uuid, p_estado text, p_pieza_id uuid DEFAULT NULL, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_i public.marketing_ideas; v_yo uuid := public.auth_employee_id();
    v_pz public.marketing_piezas; v_mes date;
BEGIN
    IF NOT (public.auth_has_module_permission('marketing','can_edit')
            OR public.auth_has_module_permission('marketing','can_approve')) THEN
        RAISE EXCEPTION 'FORBIDDEN: mover una idea exige editar o aprobar en el planificador';
    END IF;
    IF p_estado NOT IN ('nueva','en_trabajo','usada','descartada') THEN
        RAISE EXCEPTION 'Estado desconocido: %', p_estado;
    END IF;
    SELECT * INTO v_i FROM public.marketing_ideas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La idea no existe'; END IF;

    IF p_estado = 'usada' THEN
        IF p_pieza_id IS NULL THEN RAISE EXCEPTION 'Para darla por usada, elige la pieza'; END IF;
        SELECT * INTO v_pz FROM public.marketing_piezas WHERE id = p_pieza_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'La pieza no existe'; END IF;
        SELECT mes INTO v_mes FROM public.marketing_meses WHERE id = v_pz.mes_id;
    END IF;

    UPDATE public.marketing_ideas SET
        estado      = p_estado,
        tomada_por  = CASE WHEN p_estado = 'nueva' THEN NULL
                           WHEN p_estado = 'en_trabajo' OR tomada_por IS NULL THEN v_yo ELSE tomada_por END,
        tomada_at   = CASE WHEN p_estado = 'nueva' THEN NULL
                           WHEN p_estado = 'en_trabajo' OR tomada_at IS NULL THEN now() ELSE tomada_at END,
        pieza_id    = CASE WHEN p_estado = 'usada' THEN p_pieza_id ELSE NULL END,
        cerrada_por = CASE WHEN p_estado IN ('usada','descartada') THEN v_yo END,
        cerrada_at  = CASE WHEN p_estado IN ('usada','descartada') THEN now() END,
        nota_cierre = CASE WHEN p_estado IN ('usada','descartada') THEN nullif(btrim(p_nota), '') END
     WHERE id = p_id;

    -- A quien la propuso le interesa saber qué pasó con su idea.
    IF v_i.autor_id IS DISTINCT FROM v_yo AND p_estado IN ('en_trabajo','usada','descartada') THEN
        PERFORM public.notify_employees(ARRAY[v_i.autor_id], 'MARKETING',
            CASE p_estado WHEN 'en_trabajo' THEN 'Tu idea está en trabajo'
                          WHEN 'usada' THEN 'Tu idea se usó'
                          ELSE 'Tu idea se descartó' END,
            '«' || v_i.titulo || '»' ||
                CASE WHEN p_estado = 'usada' THEN ' → «' || v_pz.titulo || '», ' || to_char(v_pz.fecha, 'DD/MM') ELSE '' END ||
                coalesce(' — ' || nullif(btrim(p_nota), ''), ''),
            CASE WHEN p_estado = 'usada'
                 THEN '/marketing?tab=calendario&mes=' || to_char(v_mes, 'YYYY-MM') || '&pieza=' || p_pieza_id
                 ELSE '/marketing?tab=ideas' END,
            jsonb_build_object('idea_id', p_id, 'quien_id', v_yo), false, NULL);
    END IF;
    RETURN json_build_object('estado', p_estado);
END $$;

REVOKE EXECUTE ON FUNCTION public.marketing_avisar_idea()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_idea_mover(uuid, text, uuid, text)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marketing_idea_mover(uuid, text, uuid, text)     TO authenticated, service_role;
