SET lock_timeout = '5s';

-- Un envío armado cuyo despacho falló entero se quedaba en la lista para
-- siempre: la única salida era volver a despacharlo. Si el producto ya no
-- está, o si fue un error, no había forma de sacarlo de la pantalla — y una
-- lista con basura que no se puede limpiar se deja de mirar entera.
--
-- Sólo se cancela lo que NO SALIÓ. Es la línea entre un envío y un movimiento
-- de inventario: en cuanto un renglón tiene `enviado_at`, el producto está
-- fuera de la sala y lo que corresponde es que la otra sala lo conteste o lo
-- devuelva, no que éste desaparezca de la vista.
CREATE OR REPLACE FUNCTION public.cancelar_envio(p_request_id uuid, p_actor uuid, p_motivo text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r      public.approval_requests%ROWTYPE;
    v_mi   integer;
    v_todo boolean;
    v_org  integer;
BEGIN
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

    -- Lo cancela quien lo armó, o alguien de la sala que envía, o quien tenga
    -- alcance sobre todas. Mismo criterio con que se creó.
    v_org := nullif(r.metadata->>'origen_branch_id','')::integer;
    SELECT branch_id INTO v_mi FROM public.employees WHERE id = p_actor;
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = p_actor
           AND (coalesce(e.system_role,'') = 'SUPERADMIN'
                OR EXISTS (SELECT 1 FROM public.role_permissions rp
                            WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                              AND rp.module_key = 'traslados' AND rp.scope = 'ALL'))
    ) INTO v_todo;

    IF NOT v_todo AND p_actor IS DISTINCT FROM r.employee_id AND v_mi IS DISTINCT FROM v_org THEN
        RAISE EXCEPTION 'Este envío lo cancela la sala de la que iba a salir el producto.';
    END IF;

    UPDATE public.approval_requests
       SET status = 'CANCELLED',
           approver_id = p_actor,
           approver_note = btrim(p_motivo),
           metadata = coalesce(metadata,'{}'::jsonb)
                      || jsonb_build_object('cancelado_at', now(), 'cancelado_por', p_actor),
           updated_at = now()
     WHERE id = p_request_id AND status = 'PENDING';

    -- Los renglones se cierran con el envío. `error` y no un estado propio: es
    -- lo que ya significa «esta línea no va a moverse», y agregar un sexto
    -- estado sólo para esto obligaría a tocar los cinco sitios que los leen.
    UPDATE public.envio_linea
       SET estado = 'error',
           error = 'El envío se canceló antes de salir: ' || btrim(p_motivo),
           updated_at = now()
     WHERE request_id = p_request_id AND enviado_at IS NULL;

    RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancelar_envio(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_envio(uuid, uuid, text) TO authenticated, service_role;
