SET lock_timeout = '5s';

-- Corrige la autoría: `employees.user_id` no existe —el portal tiene dos
-- identidades por persona y la traducción vive en `auth_employee_id()`, que ya
-- contempla las dos formas—. La versión anterior fallaba SIEMPRE, así que el
-- interruptor no se podía mover.
CREATE OR REPLACE FUNCTION public.set_traslado_interruptor(
    p_accion  text,
    p_pausado boolean,
    p_motivo  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_accion NOT IN ('enviar', 'recibir') THEN
        RAISE EXCEPTION 'ACCION_INVALIDA';
    END IF;

    IF NOT (SELECT auth_has_module_permission('pedidos', 'can_edit')) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    UPDATE public.traslado_interruptor
       SET pausado      = p_pausado,
           motivo       = nullif(btrim(coalesce(p_motivo, '')), ''),
           cambiado_por = (SELECT auth_employee_id()),
           cambiado_at  = now()
     WHERE accion = p_accion;

    RETURN jsonb_build_object('accion', p_accion, 'pausado', p_pausado);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_traslado_interruptor(text, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_traslado_interruptor(text, boolean, text) TO authenticated, service_role;
