SET lock_timeout = '5s';

-- «Apareció» le llega a quien recibió «faltó».
--
-- `resolver_envio_aparecido` usaba los destinatarios del aviso de resolución
-- (quien armó el envío + jefatura y turno de su sala). Probado sobre la E00212
-- a las 22:00: UNA persona, contra las cinco que recibieron el faltante —que
-- sale de `resolver_destinatarios_traslado`, otra lista—. Se suman los que
-- recibieron el faltante. El resto de la función no cambia: se edita la
-- definición viva por reemplazo exacto, y si el ancla no está, falla.
DO $migr$
DECLARE
    d   text := pg_get_functiondef('public.resolver_envio_aparecido(uuid, uuid)'::regprocedure);
    a   text := $a$       AND (e.id = r.employee_id
            OR (e.branch_id = v_org$a$;
    b   text := $b$       AND (e.id = r.employee_id
            -- A quien le dijeron «faltó» se le dice «apareció».
            OR e.id IN (SELECT n.recipient_id FROM public.notifications n
                         WHERE n.type = 'REQUEST_PENDING'
                           AND n.metadata->>'request_id' = p_request_id::text
                           AND n.metadata ? 'faltantes')
            OR (e.branch_id = v_org$b$;
BEGIN
    IF position(a IN d) = 0 THEN
        RAISE EXCEPTION 'resolver_envio_aparecido cambió: no está el ancla.';
    END IF;
    EXECUTE replace(d, a, b);
END
$migr$;

REVOKE EXECUTE ON FUNCTION public.resolver_envio_aparecido(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolver_envio_aparecido(uuid, uuid) TO service_role;
