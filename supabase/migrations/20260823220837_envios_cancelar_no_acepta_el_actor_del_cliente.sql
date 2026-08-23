SET lock_timeout = '5s';

-- `cancelar_envio` recibía `p_actor` y la llama el NAVEGADOR: quien la invoca
-- podía pasar el id de otra persona y firmar la cancelación con su nombre —y,
-- peor, pasar el de alguien con alcance sobre todas para saltarse el freno de
-- sala. Es SECURITY DEFINER: adentro no hay RLS que lo ataje.
--
-- Quién es el que llama lo contesta `auth_employee_id()`, que es lo mismo que
-- usan las policies. Un parámetro no puede decidirlo.
DROP FUNCTION IF EXISTS public.cancelar_envio(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.cancelar_envio(p_request_id uuid, p_motivo text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r      public.approval_requests%ROWTYPE;
    v_yo   uuid := public.auth_employee_id();
    v_mi   integer;
    v_todo boolean;
    v_org  integer;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'Sesión inválida.'; END IF;

    SELECT * INTO r FROM public.approval_requests
     WHERE id = p_request_id AND type = 'INVENTORY_TRANSFER_PUSH';
    IF r.id IS NULL THEN RAISE EXCEPTION 'Ese envío no existe.'; END IF;
    IF r.status <> 'PENDING' THEN RAISE EXCEPTION 'Ese envío ya está %.', r.status; END IF;

    IF nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Para cancelar un envío hay que decir por qué.';
    END IF;

    -- Nada puede haber salido. Se pregunta por `enviado_at` y no por el estado:
    -- una línea puede haber salido y estar hoy en `error` por otra cosa, y ese
    -- producto igual está fuera de la sala.
    IF EXISTS (SELECT 1 FROM public.envio_linea l
                WHERE l.request_id = p_request_id AND l.enviado_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Ya salió producto de este envío: lo tiene que contestar la sala de destino.';
    END IF;

    v_org := nullif(r.metadata->>'origen_branch_id','')::integer;
    SELECT branch_id INTO v_mi FROM public.employees WHERE id = v_yo;
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = v_yo
           AND (coalesce(e.system_role,'') = 'SUPERADMIN'
                OR EXISTS (SELECT 1 FROM public.role_permissions rp
                            WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                              AND rp.module_key = 'traslados' AND rp.scope = 'ALL'))
    ) INTO v_todo;

    IF NOT v_todo AND v_yo IS DISTINCT FROM r.employee_id AND v_mi IS DISTINCT FROM v_org THEN
        RAISE EXCEPTION 'Este envío lo cancela la sala de la que iba a salir el producto.';
    END IF;

    UPDATE public.approval_requests
       SET status = 'CANCELLED',
           approver_id = v_yo,
           approver_note = btrim(p_motivo),
           metadata = coalesce(metadata,'{}'::jsonb)
                      || jsonb_build_object('cancelado_at', now(), 'cancelado_por', v_yo),
           updated_at = now()
     WHERE id = p_request_id AND status = 'PENDING';

    UPDATE public.envio_linea
       SET estado = 'error',
           error = 'El envío se canceló antes de salir: ' || btrim(p_motivo),
           updated_at = now()
     WHERE request_id = p_request_id AND enviado_at IS NULL;

    RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancelar_envio(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_envio(uuid, text) TO authenticated, service_role;
