SET lock_timeout = '5s';

-- Mover el interruptor. La autoría sale del JWT, nunca de un parámetro.
CREATE OR REPLACE FUNCTION public.set_traslado_interruptor(
    p_accion  text,
    p_pausado boolean,
    p_motivo  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_emp uuid;
BEGIN
    IF p_accion NOT IN ('enviar', 'recibir') THEN
        RAISE EXCEPTION 'ACCION_INVALIDA';
    END IF;

    IF NOT (SELECT auth_has_module_permission('pedidos', 'can_edit')) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    -- El empleado detrás del uid. Es el mismo camino que usan las demás.
    SELECT e.id INTO v_emp
    FROM public.employees e
    WHERE e.user_id = auth.uid()
    LIMIT 1;

    UPDATE public.traslado_interruptor
       SET pausado      = p_pausado,
           motivo       = nullif(btrim(coalesce(p_motivo, '')), ''),
           cambiado_por = v_emp,
           cambiado_at  = now()
     WHERE accion = p_accion;

    RETURN jsonb_build_object('accion', p_accion, 'pausado', p_pausado);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_traslado_interruptor(text, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_traslado_interruptor(text, boolean, text) TO authenticated, service_role;
