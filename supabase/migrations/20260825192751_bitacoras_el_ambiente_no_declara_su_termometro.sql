SET lock_timeout = '5s';

-- El termómetro del ambiente deja de escribirse desde la sucursal.
--
-- ── Por qué se va ──────────────────────────────────────────────────────────
-- «No es el mismo, cada uno tiene uno independiente, pero ¿qué necesitas que
-- escriba? ¿el nombre? ¿es necesario?» (usuario). Las dos mitades son ciertas:
--
--   · Independiente SÍ — el RTS 6.2.11 pide «un instrumento o equipo
--     independiente para área de bodega y sala de ventas». La versión anterior
--     de esta función escribía el mismo texto en las dos áreas, o sea que decía
--     lo contrario de lo que exige la norma.
--   · Y el NOMBRE no lo pide nadie: para una farmacia, el reglamento exige que
--     el instrumento exista (6.2.11) y la guía de la SRS pregunta si HAY
--     termómetro (2.13, CRÍTICO). Ninguno pide identificarlo. Lo que sí se
--     identifica es el del refrigerador, porque su certificado de calibración
--     se emite a nombre de un aparato concreto (6.2.19 / guía 2.32) — y ése se
--     sigue escribiendo en su propia tarjeta.
--
-- Medido antes de decidirlo: **cero áreas tenían instrumento guardado**. Lo que
-- se veía en pantalla era el texto de ejemplo del campo, no un dato. En más de
-- una semana de uso nadie escribió uno.
--
-- Vuelve la firma de tres argumentos y se borra la de cuatro: dos sobrecargas
-- del mismo nombre dejan a PostgREST eligiendo.
CREATE OR REPLACE FUNCTION public.aplicar_horarios_bitacora(
    p_branch_id bigint,
    p_franjas   jsonb DEFAULT '[]'::jsonb,
    p_limpiezas jsonb DEFAULT '[]'::jsonb
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
           updated_at = now()
     WHERE a.branch_id = p_branch_id;

    GET DIAGNOSTICS v_tocadas = ROW_COUNT;
    RETURN v_tocadas;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aplicar_horarios_bitacora(bigint, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aplicar_horarios_bitacora(bigint, jsonb, jsonb) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.aplicar_horarios_bitacora(bigint, jsonb, jsonb, text);
