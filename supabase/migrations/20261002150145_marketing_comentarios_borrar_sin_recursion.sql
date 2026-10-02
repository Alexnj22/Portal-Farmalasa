-- La policy de DELETE de `marketing_comentarios_en_hilo` consultaba la misma
-- tabla (¿tiene respuestas?) y Postgres la rechaza por recursión: su SELECT
-- vuelve a pasar por las policies de la tabla. La pregunta va a una función
-- DEFINER, que la contesta sin RLS.
SET lock_timeout = '5s';

CREATE FUNCTION public.marketing_comentario_tiene_respuestas(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
    SELECT EXISTS (SELECT 1 FROM public.marketing_comentarios WHERE respuesta_a = p_id);
$$;
REVOKE EXECUTE ON FUNCTION public.marketing_comentario_tiene_respuestas(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marketing_comentario_tiene_respuestas(uuid) TO authenticated, service_role;

DROP POLICY marketing_comentarios_delete_propio ON public.marketing_comentarios;
CREATE POLICY marketing_comentarios_delete_propio ON public.marketing_comentarios FOR DELETE TO authenticated
    USING (autor_id = (SELECT public.auth_employee_id()) AND tipo = 'comentario'
           AND NOT public.marketing_comentario_tiene_respuestas(id));
