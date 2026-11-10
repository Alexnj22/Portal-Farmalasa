SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.chat_vigilar_espera()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- 2026-11-10 (docs/PLAN-MEMORIA-DE-LA-BASE-2026-11-10.md, fase 1a): las listas
-- de equipo y supervisión costaban ~120 ms por minuto y casi nunca se usan. Se
-- arman la PRIMERA vez que un caso las necesita; mismo contenido, porque nada en
-- el bucle cambia employees ni role_permissions. Avisos, textos y orden:
-- idénticos (comparado en pruebas sobre seis casos, md5 de avisos igual).
DECLARE r record; v_equipo uuid[]; v_super uuid[]; v_sala uuid[]; n1 int := 0; n2 int := 0; n3 int := 0; v_min int;
        v_equipo_listo boolean := false; v_super_listo boolean := false;
BEGIN
  IF NOT coalesce((public.farmacia_estado() ->> 'abierta')::boolean, false) THEN
    RETURN json_build_object('abierta', false);
  END IF;

  FOR r IN
    SELECT cv.id, cv.esperando_desde, cv.asignada_a, cv.espera_recordada_at, cv.escalada_sala_at, cv.escalada_supervision_at,
           c.name AS cliente, emp.name AS empleado, emp.branch_id AS sala_id, b.name AS sala
      FROM public.app_chat_conversaciones cv
      JOIN public.customers c ON c.id = cv.customer_id
      LEFT JOIN public.employees emp ON emp.id = cv.asignada_a
      LEFT JOIN public.branches b ON b.id = emp.branch_id
     WHERE cv.estado = 'abierta' AND cv.esperando_desde < now() - interval '15 minutes'
     LIMIT 100
  LOOP
    v_min := floor(extract(epoch FROM now() - r.esperando_desde) / 60)::int;
    IF r.asignada_a IS NULL THEN
      IF r.espera_recordada_at IS NULL THEN
        IF NOT v_equipo_listo THEN
          SELECT array_agg(e.id) INTO v_equipo FROM public.employees e
           WHERE e.status = 'ACTIVO'
             AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'chat_clientes'
                         AND rp.can_view AND rp.role_id = ANY (public.roles_efectivos_de(e.id)));
          v_equipo_listo := true;
        END IF;
        IF v_equipo IS NOT NULL THEN
          PERFORM public.notify_employees(v_equipo, 'CHAT_CLIENTE', coalesce(r.cliente, 'Un cliente') || ' espera respuesta',
            'Lleva ' || v_min || ' minutos sin respuesta en el chat.', '/chat-clientes',
            jsonb_build_object('conversacion_id', r.id, 'check_key', 'chat-espera15:' || r.id || ':' || extract(epoch FROM r.esperando_desde)::bigint), true, NULL);
        END IF;
        UPDATE public.app_chat_conversaciones SET espera_recordada_at = now() WHERE id = r.id;
        n1 := n1 + 1;
      END IF;
    ELSE
      -- 15 min: aviso a la sala del empleado asignado.
      IF r.escalada_sala_at IS NULL THEN
        SELECT array_agg(e.id) INTO v_sala FROM public.employees e
         WHERE e.status = 'ACTIVO' AND coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = r.sala_id;
        IF v_sala IS NOT NULL THEN
          PERFORM public.notify_employees(v_sala, 'CHAT_CLIENTE', coalesce(r.cliente, 'Un cliente') || ' espera respuesta',
            'El chat está asignado a ' || split_part(coalesce(r.empleado, ''), ' ', 1) || ' y lleva ' || v_min
              || ' minutos sin respuesta. Cualquiera con acceso al chat puede contestar.', '/chat-clientes',
            jsonb_build_object('conversacion_id', r.id, 'check_key', 'chat-sala:' || r.id || ':' || extract(epoch FROM r.esperando_desde)::bigint),
            true, r.sala_id::int);
        END IF;
        UPDATE public.app_chat_conversaciones SET escalada_sala_at = now() WHERE id = r.id;
        n2 := n2 + 1;
      -- 20 min (5 más): se registra y se avisa a supervisión.
      ELSIF r.escalada_supervision_at IS NULL AND r.esperando_desde < now() - interval '20 minutes' THEN
        INSERT INTO public.app_chat_incumplimientos (conversacion_id, employee_id, branch_id, esperando_desde, minutos)
        VALUES (r.id, r.asignada_a, r.sala_id, r.esperando_desde, v_min);
        IF NOT v_super_listo THEN
          SELECT array_agg(e.id) INTO v_super FROM public.employees e
           WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;
          v_super_listo := true;
        END IF;
        IF v_super IS NOT NULL THEN
          PERFORM public.notify_employees(v_super, 'CHAT_INCUMPLIMIENTO', 'Chat sin respuesta: ' || coalesce(r.cliente, 'un cliente'),
            coalesce(r.empleado, 'El asignado') || CASE WHEN r.sala IS NOT NULL THEN ' (' || r.sala || ')' ELSE '' END
              || ' no contesta hace ' || v_min || ' minutos.', '/chat-clientes',
            jsonb_build_object('conversacion_id', r.id, 'check_key', 'chat-super:' || r.id || ':' || extract(epoch FROM r.esperando_desde)::bigint), true, NULL);
        END IF;
        UPDATE public.app_chat_conversaciones SET escalada_supervision_at = now() WHERE id = r.id;
        n3 := n3 + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN json_build_object('abierta', true, 'equipo', n1, 'sala', n2, 'supervision', n3);
END;
$function$;
