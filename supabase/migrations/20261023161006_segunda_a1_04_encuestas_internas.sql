-- segunda-a1-04 · Encuestas internas: crear y editar una encuesta escribe (H10)
-- `surveys` sólo tenía policy de SELECT: el UPDATE afectaba 0 filas sin error.
-- No hay DELETE desde el cliente (la pantalla archiva con `estado`).
SET lock_timeout = '5s';

DROP POLICY IF EXISTS surveys_insert ON public.surveys;
CREATE POLICY surveys_insert ON public.surveys
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['encuesta_admin', 'encuesta'])));

DROP POLICY IF EXISTS surveys_update ON public.surveys;
CREATE POLICY surveys_update ON public.surveys
    FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['encuesta_admin', 'encuesta'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['encuesta_admin', 'encuesta'])));
