-- La lectura de Saly de los RESULTADOS de una encuesta a clientes (pedido del
-- usuario 2026-11-07: «el portal no me dice nada, sólo me dice tantas; debe
-- ser inteligente»). Lee los números, las sucursales, los cruces entre
-- preguntas que calcula el núcleo y los comentarios, y dice qué significa.
--
-- Igual que el resumen de comentarios (`encuesta_cliente_resumenes`): la IA
-- tiene costo y cuota, así que la lectura se guarda, todos ven la misma, y
-- sólo se rehace a mano cuando entraron respuestas nuevas suficientes
-- (5, o el 10 % de las que había, lo que sea mayor).
--
-- `branch_key`: 0 = todas, -1 = campo, N = la sucursal (el mismo criterio que
-- `encuesta_cliente_resultados` con `nullif(p_branch, -1)`).
SET lock_timeout = '5s';

CREATE TABLE public.encuesta_cliente_lecturas (
    encuesta_id  uuid NOT NULL REFERENCES public.encuestas_cliente(id) ON DELETE CASCADE,
    branch_key   integer NOT NULL DEFAULT 0,
    texto        text NOT NULL CHECK (length(texto) BETWEEN 1 AND 8000),
    respuestas_n integer NOT NULL CHECK (respuestas_n >= 0),
    generado_por uuid REFERENCES public.employees(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (encuesta_id, branch_key)
);
COMMENT ON TABLE public.encuesta_cliente_lecturas IS
    'La lectura de Saly de los resultados de una encuesta a clientes, por sucursal (0 = todas, -1 = campo). Se escribe sólo por encuesta_cliente_guardar_lectura.';
ALTER TABLE public.encuesta_cliente_lecturas ENABLE ROW LEVEL SECURITY;
CREATE POLICY encuesta_cliente_lecturas_select ON public.encuesta_cliente_lecturas
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes', 'can_view')));
REVOKE ALL ON public.encuesta_cliente_lecturas FROM anon;

-- Cuántas respuestas hay con el mismo filtro que los resultados.
CREATE FUNCTION public.encuesta_cliente_respuestas_n(p_id uuid, p_branch integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
    SELECT count(*)::integer FROM public.encuesta_cliente_respuestas
     WHERE encuesta_id = p_id AND (p_branch IS NULL OR branch_id IS NOT DISTINCT FROM nullif(p_branch, -1));
$$;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_respuestas_n(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_respuestas_n(uuid, integer) TO service_role;

CREATE FUNCTION public.encuesta_cliente_lectura(p_id uuid, p_branch integer DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_l public.encuesta_cliente_lecturas; v_n integer;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO v_l FROM public.encuesta_cliente_lecturas WHERE encuesta_id = p_id AND branch_key = coalesce(p_branch, 0);
    v_n := public.encuesta_cliente_respuestas_n(p_id, p_branch);
    RETURN json_build_object(
        'texto', v_l.texto, 'respuestas_n', v_l.respuestas_n, 'generado_at', v_l.created_at,
        'generado_por', v_l.generado_por, 'respuestas', v_n,
        'nuevas', CASE WHEN v_l.texto IS NULL THEN v_n ELSE greatest(v_n - v_l.respuestas_n, 0) END,
        'minimo_nuevas', greatest(5, ceil(coalesce(v_l.respuestas_n, 0) * 0.10))::integer);
END $$;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_lectura(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_lectura(uuid, integer) TO authenticated, service_role;

-- Guarda la lectura. Si otra persona guardó una con MÁS respuestas mientras
-- Saly leía, se queda la de ella: nunca una lectura vieja pisa una nueva.
CREATE FUNCTION public.encuesta_cliente_guardar_lectura(p_id uuid, p_branch integer, p_texto text, p_respuestas_n integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_prev public.encuesta_cliente_lecturas; v_n integer;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF btrim(coalesce(p_texto, '')) = '' THEN RAISE EXCEPTION 'Lectura vacía'; END IF;
    v_n := public.encuesta_cliente_respuestas_n(p_id, p_branch);
    IF p_respuestas_n IS NULL OR p_respuestas_n < 1 OR p_respuestas_n > v_n THEN
        RAISE EXCEPTION 'La lectura no corresponde a las respuestas de la encuesta';
    END IF;
    SELECT * INTO v_prev FROM public.encuesta_cliente_lecturas
     WHERE encuesta_id = p_id AND branch_key = coalesce(p_branch, 0) FOR UPDATE;
    IF FOUND AND v_prev.respuestas_n > p_respuestas_n THEN
        RETURN json_build_object('guardado', false);
    END IF;
    INSERT INTO public.encuesta_cliente_lecturas (encuesta_id, branch_key, texto, respuestas_n, generado_por)
    VALUES (p_id, coalesce(p_branch, 0), left(p_texto, 8000), p_respuestas_n, public.auth_employee_id())
    ON CONFLICT (encuesta_id, branch_key) DO UPDATE
       SET texto = EXCLUDED.texto, respuestas_n = EXCLUDED.respuestas_n,
           generado_por = EXCLUDED.generado_por, created_at = now();
    RETURN json_build_object('guardado', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_guardar_lectura(uuid, integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_guardar_lectura(uuid, integer, text, integer) TO authenticated, service_role;
