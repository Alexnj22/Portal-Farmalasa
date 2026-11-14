SET lock_timeout = '5s';

-- Vigilancia de seguridad: se quita el aviso «Entrada de noche» (2026-11-14).
-- El usuario lo pidió: llegaba casi a diario por gente que trabaja de noche
-- con normalidad (11 en dos semanas) y no aportaba. Quedan los otros dos
-- hallazgos de la mañana (cuenta sin uso, cuenta sin dueño activo) y el aviso
-- al momento por cambio de control. Partido de la definición VIVA.
-- La clave 'noche' del resultado se conserva en 0 para quien la lea.

CREATE OR REPLACE FUNCTION public.vigilar_seguridad()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dest uuid[] := public.seguridad_destinatarios();
    v_sin_uso int := 0; v_sueltas int := 0;
    v_para uuid[];
    r record;
BEGIN
    IF cardinality(v_dest) = 0 THEN
        RETURN jsonb_build_object('error', 'sin destinatarios');
    END IF;

    FOR r IN
        -- 1 · Persona activa, 60+ días sin entrar, con alguna cuenta abierta.
        --     Las fichas de menos de 60 días no cuentan: todavía no tuvieron tiempo.
        WITH cuentas AS (
            SELECT e.id AS emp, e.name, e.created_at,
                   max(u.last_sign_in_at) AS ultimo,
                   bool_or(u.banned_until IS NULL OR u.banned_until < now()) AS abierta
              FROM public.employees e
              JOIN auth.users u
                ON u.id = e.id
                OR u.id IN (SELECT l.auth_user_id FROM public.employee_auth_accounts l WHERE l.employee_id = e.id)
             WHERE e.status = 'ACTIVO'
             GROUP BY e.id, e.name, e.created_at
        )
        SELECT 'sin_uso' AS tipo,
               'SEG_SIN_USO:' || c.emp || ':' || coalesce(c.ultimo::date::text, 'nunca') AS clave,
               'Cuenta sin uso: ' || public.nombre_corto_de_empleado(NULL, NULL, c.name) AS titulo,
               'La cuenta de ' || public.nombre_corto_de_empleado(NULL, NULL, c.name)
                 || CASE WHEN c.ultimo IS NULL THEN ' nunca ha entrado al portal'
                         ELSE ' lleva ' || (current_date - (c.ultimo AT TIME ZONE 'America/El_Salvador')::date)
                              || ' días sin entrar al portal' END
                 || ' y sigue abierta. Si ya no la usa, bloquéala en Personal.' AS cuerpo,
               jsonb_build_object('motivo', 'sin_uso', 'employee_id', c.emp, 'ultimo', c.ultimo) AS meta
          FROM cuentas c
         WHERE c.abierta
           AND c.created_at < now() - interval '60 days'
           AND (c.ultimo IS NULL OR c.ultimo < now() - interval '60 days')

        UNION ALL
        -- 2 · Cuenta sin bloquear cuyo dueño no está activo, o que no es de nadie.
        SELECT 'suelta',
               'SEG_CUENTA_SUELTA:' || u.id || ':' || coalesce(u.last_sign_in_at::date::text, 'nunca'),
               'Cuenta abierta sin dueño activo',
               coalesce('La cuenta de ' || public.nombre_corto_de_empleado(NULL, NULL, e.name)
                          || ' (ficha ' || lower(e.status) || ')',
                        'Una cuenta que no pertenece a ninguna persona del portal')
                 || ' sigue abierta'
                 || CASE WHEN u.last_sign_in_at > now() - interval '24 hours'
                         THEN ' y entró ayer a las ' || public.hora_12((u.last_sign_in_at AT TIME ZONE 'America/El_Salvador')::time)
                         ELSE '' END
                 || '. Bloquéala si nadie la necesita.',
               jsonb_build_object('motivo', 'cuenta_suelta', 'auth_user_id', u.id, 'employee_id', e.id,
                                  'ultimo', u.last_sign_in_at)
          FROM auth.users u
          LEFT JOIN public.employee_auth_accounts l ON l.auth_user_id = u.id
          LEFT JOIN public.employees e ON e.id = coalesce(l.employee_id, u.id)
         WHERE (u.banned_until IS NULL OR u.banned_until < now())
           AND u.deleted_at IS NULL
           AND (e.id IS NULL OR e.status <> 'ACTIVO')
    LOOP
        SELECT array_agg(d) INTO v_para
          FROM unnest(v_dest) d
         WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                            WHERE a.clave = r.clave AND a.recipient_id = d);
        CONTINUE WHEN v_para IS NULL;

        PERFORM public.notify_employees(v_para, 'SEGURIDAD_VIGILANCIA', r.titulo, r.cuerpo,
                                        NULL, r.meta, false, NULL);
        INSERT INTO public.avisos_emitidos (clave, recipient_id)
        SELECT r.clave, d FROM unnest(v_para) d
        ON CONFLICT DO NOTHING;

        IF r.tipo = 'sin_uso' THEN v_sin_uso := v_sin_uso + 1;
        ELSE                       v_sueltas := v_sueltas + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('sin_uso', v_sin_uso, 'cuentas_sueltas', v_sueltas, 'noche', 0,
                              'destinatarios', cardinality(v_dest));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.vigilar_seguridad() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.vigilar_seguridad() TO service_role;
