SET lock_timeout = '5s';

-- El termómetro del ambiente también es de la SUCURSAL.
--
-- «Que pase esa info a la primera card, y que se entienda que es tanto para
-- bodega como sala de ventas» (usuario). Es el mismo aparato con el que se
-- camina la vuelta: preguntarlo por área daba dos respuestas para un objeto que
-- es uno.
--
-- El refrigerador queda AFUERA a propósito: su termómetro es otro aparato, y es
-- el único que la norma manda calibrar en una farmacia (RTS 6.2.19, guía 2.32
-- CRÍTICO). Se elige por «tiene franjas y no es refrigerador» y no por una
-- lista de tipos, para que un área de ambiente nueva entre sola.
CREATE OR REPLACE FUNCTION public.aplicar_horarios_bitacora(
    p_branch_id   bigint,
    p_franjas     jsonb DEFAULT '[]'::jsonb,
    p_limpiezas   jsonb DEFAULT '[]'::jsonb,
    p_instrumento text  DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_tocadas integer;
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras_configurar', 'can_edit') THEN
        RAISE EXCEPTION 'Tu cargo no puede configurar las bitacoras.' USING ERRCODE = '42501';
    END IF;
    IF public.auth_module_scope('bitacoras_configurar') <> 'ALL'
       AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
        RAISE EXCEPTION 'Solo podes configurar tu sala.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.bitacora_areas a
       SET franjas = (
               SELECT coalesce(jsonb_agg(
                          CASE WHEN n.clave IS NULL THEN f
                               ELSE f || jsonb_build_object('desde', n.desde, 'hasta', n.hasta) END
                          ORDER BY t.ord), '[]'::jsonb)
                 FROM jsonb_array_elements(a.franjas) WITH ORDINALITY AS t(f, ord)
                 LEFT JOIN LATERAL (
                     SELECT x->>'clave' AS clave, x->>'desde' AS desde, x->>'hasta' AS hasta
                       FROM jsonb_array_elements(coalesce(p_franjas, '[]'::jsonb)) x
                      WHERE x->>'clave' = f->>'clave'
                      LIMIT 1
                 ) n ON true
           ),
           limpiezas = (
               SELECT coalesce(jsonb_agg(
                          CASE WHEN n.clave IS NULL THEN f
                               ELSE f || jsonb_build_object('desde', n.desde, 'hasta', n.hasta) END
                          ORDER BY t.ord), '[]'::jsonb)
                 FROM jsonb_array_elements(a.limpiezas) WITH ORDINALITY AS t(f, ord)
                 LEFT JOIN LATERAL (
                     SELECT x->>'clave' AS clave, x->>'desde' AS desde, x->>'hasta' AS hasta
                       FROM jsonb_array_elements(coalesce(p_limpiezas, '[]'::jsonb)) x
                      WHERE x->>'clave' = f->>'clave'
                      LIMIT 1
                 ) n ON true
           ),
           instrumento = CASE
               WHEN p_instrumento IS NULL THEN a.instrumento
               WHEN a.tipo <> 'refrigerador' AND jsonb_array_length(a.franjas) > 0
                   THEN nullif(btrim(p_instrumento), '')
               ELSE a.instrumento
           END,
           updated_at = now()
     WHERE a.branch_id = p_branch_id;

    GET DIAGNOSTICS v_tocadas = ROW_COUNT;
    RETURN v_tocadas;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aplicar_horarios_bitacora(bigint, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aplicar_horarios_bitacora(bigint, jsonb, jsonb, text) TO authenticated, service_role;

-- La firma vieja (tres argumentos) se va: dos sobrecargas del mismo nombre
-- dejan a PostgREST eligiendo, y en este proyecto eso ya costó una revocación
-- de permisos que alcanzó a una sola de dos.
DROP FUNCTION IF EXISTS public.aplicar_horarios_bitacora(bigint, jsonb, jsonb);
