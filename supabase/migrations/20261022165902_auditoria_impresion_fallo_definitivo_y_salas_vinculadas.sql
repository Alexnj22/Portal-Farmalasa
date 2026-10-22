SET lock_timeout = '5s';

-- Auditoría 2026-10-21, grupo 1 · H10 y H11 (impresión). Ambas partidas de la
-- definición viva.
--
-- H10 · `confirmar_impresion` devolvía a PENDIENTE todo fallo, así que un
-- «Documento ilegible» —que el agente promete no reintentar— se reclamaba y
-- fallaba otras dos veces hasta que `reclamar_impresion` lo pasaba a ERROR.
-- `p_definitivo` lo pasa a ERROR de una vez. Con DEFAULT false: los agentes de
-- las cajas que todavía no se actualizaron llaman con cinco argumentos por
-- nombre y siguen igual. Se reemplaza la firma (DROP + CREATE) para no dejar
-- dos sobrecargas, y se conservan los mismos permisos (el agente entra como
-- anon con device+token; ver auditoria/superficie-anon.json).
--
-- H11 · `salas_con_caja_de_impresion` contaba una caja con el código generado
-- y nunca canjeado. `encolar_impresion` exige `vinculada_at`, así que la sala
-- aparecía como destino y al elegirla se rechazaba. Mismo criterio en los dos.

DROP FUNCTION IF EXISTS public.confirmar_impresion(uuid, uuid, bigint, boolean, text);

CREATE FUNCTION public.confirmar_impresion(p_device uuid, p_token uuid, p_id bigint, p_ok boolean,
                                           p_error text DEFAULT NULL::text, p_definitivo boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_sala bigint;
BEGIN
    SELECT d.branch_id INTO v_sala FROM public.impresion_dispositivos d
     WHERE d.id = p_device AND d.token = p_token AND d.activo;
    IF v_sala IS NULL THEN RAISE EXCEPTION 'Caja no reconocida.'; END IF;

    UPDATE public.cola_impresion
       SET estado = CASE WHEN p_ok THEN 'IMPRESO'
                         WHEN coalesce(p_definitivo, false) THEN 'ERROR'
                         ELSE 'PENDIENTE' END,
           impreso_at = CASE WHEN p_ok THEN now() END,
           error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 400) END,
           reclamado_at = NULL
     WHERE id = p_id AND branch_id = v_sala;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_impresion(uuid, uuid, bigint, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_impresion(uuid, uuid, bigint, boolean, text, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.salas_con_caja_de_impresion()
 RETURNS TABLE(branch_id bigint, latiendo boolean, ultimo_latido timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT d.branch_id,
           (max(d.ultimo_latido) > now() - interval '2 minutes') AS latiendo,
           max(d.ultimo_latido) AS ultimo_latido
      FROM public.impresion_dispositivos d
     WHERE d.activo
       AND d.vinculada_at IS NOT NULL
       AND (SELECT auth_employee_id()) IS NOT NULL
     GROUP BY d.branch_id;
$function$;

NOTIFY pgrst, 'reload schema';
