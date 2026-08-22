SET lock_timeout = '5s';

-- Cerrar un envío tocaba `status`, `approver_id`, `approver_note` y el
-- `metadata` desde la Edge Function, y el metadata iba entero
-- (`{ ...meta, rejection_reason }`) — la misma trampa que el candado: lo que
-- otra escritura haya puesto en el medio se pierde. Acá el `||` funde.
--
-- Y el motivo NO es cosmético: `validar_rechazo_con_motivo` exige que un
-- REJECTED traiga `rejection_reason` o `approver_note`, así que perderlo en una
-- fusión sería una excepción en la cara de quien está decidiendo.
--
-- `p_actor` pasa a ser el `approver_id`: quien DECIDIÓ, no quien recibió el
-- aviso. Es lo que hace que el aviso de vuelta diga el nombre correcto —
-- cualquiera de los destinatarios de la sala puede contestar.
CREATE OR REPLACE FUNCTION public.cerrar_envio(
    p_request_id uuid,
    p_status     text,
    p_actor      uuid,
    p_nota       text DEFAULT NULL,
    p_motivos    text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ok boolean;
BEGIN
    IF p_status NOT IN ('APPROVED','REJECTED') THEN
        RAISE EXCEPTION 'Un envío se cierra en APPROVED o REJECTED, no en %.', p_status;
    END IF;

    UPDATE public.approval_requests
       SET status        = p_status,
           approver_id   = p_actor,
           approver_note = nullif(btrim(coalesce(p_nota, '')), ''),
           metadata      = coalesce(metadata, '{}'::jsonb)
                           || CASE WHEN nullif(btrim(coalesce(p_motivos, '')), '') IS NOT NULL
                                   THEN jsonb_build_object('rejection_reason', p_motivos)
                                   ELSE '{}'::jsonb END,
           updated_at    = now()
     WHERE id = p_request_id
       AND type = 'INVENTORY_TRANSFER_PUSH'
       -- Sólo desde PENDING: dos personas de la sala decidiendo a la vez pasan
       -- las dos la lectura de «¿queda algo por decidir?», y acá la segunda no
       -- escribe. Sin esto, la segunda dispararía otro aviso de resolución.
       AND status = 'PENDING'
    RETURNING true INTO v_ok;
    RETURN coalesce(v_ok, false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cerrar_envio(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_envio(uuid, text, uuid, text, text) TO service_role;
