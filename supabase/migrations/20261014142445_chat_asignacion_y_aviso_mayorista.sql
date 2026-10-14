-- (2026-10-14) Dos pedidos del usuario:
--
-- 1) «La notificación al portal cuando alguien solicita ser cliente mayorista
--    no llega». No llegaba porque nunca se mandó: `mayorista_solicitar_app`
--    sólo escribe la fila. Ahora un trigger avisa a quien puede APROBAR el
--    módulo `mayoristas` cuando una ficha pasa a `solicitado`.
--
-- 2) Chat ASIGNADO: «el primer empleado que conteste queda asignado al chat
--    para solventar; si no le contesta al cliente en 15 minutos, avisa a la
--    sucursal donde está ese empleado; si a los 5 minutos más no le contesta,
--    queda registrado y avisa a supervisión. No queda bloqueado: sólo dice
--    que está asignado, pero alguien más puede contestar.»
--      · `asignada_a` = quien contestó primero (no cambia si otro contesta).
--      · `chat_vigilar_espera()` (cada minuto, sólo con la farmacia abierta):
--          - sin asignar → a los 15 min, el aviso de siempre al equipo del chat;
--          - asignada → a los 15 min, aviso a la SALA de ese empleado; a los
--            20 min, fila en `app_chat_incumplimientos` y aviso a supervisión.
--        Cada escalón una vez por espera; contestar (cualquiera) los reinicia.
SET lock_timeout = '5s';

-- ── 1. Solicitud de mayorista → aviso ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clientes_mayoristas_avisar_solicitud()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_dest uuid[]; v_cliente text;
BEGIN
  IF NEW.estado = 'solicitado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'solicitado') THEN
    SELECT name INTO v_cliente FROM public.customers WHERE id = NEW.customer_id;
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'mayoristas'
                   AND rp.can_approve AND rp.role_id IN (e.role_id, e.secondary_role_id));
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'MAYORISTA_SOLICITUD', 'Solicitud de Cliente Mayorista',
        coalesce(v_cliente, 'Un cliente') || CASE WHEN NEW.origen = 'app' THEN ' lo pidió desde la app.' ELSE ' fue propuesto.' END
          || CASE WHEN NEW.nota_solicitud IS NOT NULL THEN ' «' || left(NEW.nota_solicitud, 120) || '»' ELSE '' END,
        '/mayoristas', jsonb_build_object('customer_id', NEW.customer_id,
          'check_key', 'mayorista-solicitud:' || NEW.customer_id || ':' || extract(epoch FROM coalesce(NEW.solicitado_at, now()))::bigint),
        true, NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.clientes_mayoristas_avisar_solicitud() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS clientes_mayoristas_avisar_solicitud ON public.clientes_mayoristas;
CREATE TRIGGER clientes_mayoristas_avisar_solicitud AFTER INSERT OR UPDATE OF estado ON public.clientes_mayoristas
  FOR EACH ROW EXECUTE FUNCTION public.clientes_mayoristas_avisar_solicitud();

-- ── 2. Chat asignado ─────────────────────────────────────────────────────
ALTER TABLE public.app_chat_conversaciones
  ADD COLUMN IF NOT EXISTS asignada_a uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS asignada_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalada_sala_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalada_supervision_at timestamptz;
CREATE INDEX IF NOT EXISTS app_chat_conversaciones_asignada_idx ON public.app_chat_conversaciones (asignada_a) WHERE asignada_a IS NOT NULL;

-- Registro de incumplimientos: el cliente esperó más de 20 min con el chat
-- asignado a alguien que no contestó. Historial: sin DELETE.
CREATE TABLE IF NOT EXISTS public.app_chat_incumplimientos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversacion_id bigint NOT NULL REFERENCES public.app_chat_conversaciones(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES public.employees(id),
  branch_id       bigint REFERENCES public.branches(id),
  esperando_desde timestamptz NOT NULL,
  minutos         integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_chat_incumplimientos_conv_idx ON public.app_chat_incumplimientos (conversacion_id);
CREATE INDEX IF NOT EXISTS app_chat_incumplimientos_emp_idx ON public.app_chat_incumplimientos (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_chat_incumplimientos_branch_idx ON public.app_chat_incumplimientos (branch_id);
ALTER TABLE public.app_chat_incumplimientos ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_chat_incumplimientos_select ON public.app_chat_incumplimientos FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('chat_clientes', 'can_view')));
REVOKE ALL ON public.app_chat_incumplimientos FROM anon;

-- Quien contesta primero queda asignado; cualquier respuesta reinicia la escalera.
CREATE OR REPLACE FUNCTION public.app_chat_mensaje_nuevo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_antes integer; v_cliente text; v_dest uuid[]; v_customer bigint;
BEGIN
  IF NEW.autor = 'cliente' THEN
    SELECT sin_leer_equipo, customer_id INTO v_antes, v_customer FROM public.app_chat_conversaciones WHERE id = NEW.conversacion_id;
    UPDATE public.app_chat_conversaciones
       SET ultimo_mensaje_at = NEW.created_at, ultimo_de = 'cliente',
           ultimo_texto = coalesce(left(NEW.texto, 140), 'Foto'),
           sin_leer_equipo = sin_leer_equipo + 1, cliente_escribiendo_at = NULL,
           esperando_desde = coalesce(esperando_desde, NEW.created_at),
           estado = 'abierta', resuelta_at = NULL, resuelta_por = NULL
     WHERE id = NEW.conversacion_id;
    IF coalesce(v_antes, 0) + 1 = 3 THEN
      SELECT name INTO v_cliente FROM public.customers WHERE id = v_customer;
      SELECT array_agg(e.id) INTO v_dest FROM public.employees e
       WHERE e.status = 'ACTIVO'
         AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'chat_clientes'
                     AND rp.can_view AND rp.role_id IN (e.role_id, e.secondary_role_id));
      IF v_dest IS NOT NULL THEN
        PERFORM public.notify_employees(v_dest, 'CHAT_CLIENTE', coalesce(v_cliente, 'Un cliente') || ' espera respuesta',
          '3 mensajes sin contestar en el chat.', '/chat-clientes',
          jsonb_build_object('conversacion_id', NEW.conversacion_id, 'check_key', 'chat-espera:' || NEW.conversacion_id || ':' || NEW.id), true, NULL);
      END IF;
    END IF;
  ELSIF NEW.autor = 'equipo' THEN
    UPDATE public.app_chat_conversaciones
       SET ultimo_mensaje_at = NEW.created_at, ultimo_de = 'equipo',
           ultimo_texto = coalesce(left(NEW.texto, 140), CASE WHEN NEW.adjunto IS NOT NULL THEN 'Producto' ELSE 'Foto' END),
           sin_leer_equipo = 0, sin_leer_cliente = sin_leer_cliente + 1,
           tomada_por = NEW.employee_id, tomada_at = NEW.created_at,
           escribiendo_por = NULL, escribiendo_at = NULL, visto_equipo_at = NEW.created_at,
           esperando_desde = NULL, espera_recordada_at = NULL,
           escalada_sala_at = NULL, escalada_supervision_at = NULL,
           asignada_a = coalesce(asignada_a, NEW.employee_id),
           asignada_at = coalesce(asignada_at, NEW.created_at)
     WHERE id = NEW.conversacion_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_chat_mensaje_nuevo() FROM PUBLIC, anon, authenticated;

-- Al resolver, la asignación se libera: la próxima conversación la toma quien conteste.
CREATE OR REPLACE FUNCTION public.chat_resolver(p_conversacion bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_edit') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_chat_conversaciones
     SET estado = 'resuelta', resuelta_por = public.auth_employee_id(), resuelta_at = now(),
         tomada_por = NULL, tomada_at = NULL, sin_leer_equipo = 0,
         asignada_a = NULL, asignada_at = NULL, escalada_sala_at = NULL, escalada_supervision_at = NULL
   WHERE id = p_conversacion;
  RETURN json_build_object('ok', true);
END;
$function$;

-- La vigilancia: reemplaza a `chat_recordar_espera` (que queda llamándola).
CREATE OR REPLACE FUNCTION public.chat_vigilar_espera()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r record; v_equipo uuid[]; v_super uuid[]; v_sala uuid[]; n1 int := 0; n2 int := 0; n3 int := 0; v_min int;
BEGIN
  IF NOT coalesce((public.farmacia_estado() ->> 'abierta')::boolean, false) THEN
    RETURN json_build_object('abierta', false);
  END IF;
  SELECT array_agg(e.id) INTO v_equipo FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'chat_clientes'
                 AND rp.can_view AND rp.role_id IN (e.role_id, e.secondary_role_id));
  SELECT array_agg(e.id) INTO v_super FROM public.employees e
   WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;

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
         WHERE e.status = 'ACTIVO' AND e.branch_id = r.sala_id;
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
REVOKE EXECUTE ON FUNCTION public.chat_vigilar_espera() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_vigilar_espera() TO service_role;

-- El cron viejo pasa a vigilar cada minuto (los escalones son a los 15 y 20).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-recordar-espera-5min') THEN
    PERFORM cron.unschedule('chat-recordar-espera-5min');
  END IF;
END $$;
SELECT cron.schedule('chat-vigilar-espera-1min', '* * * * *', $$SELECT public.chat_vigilar_espera()$$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-vigilar-espera-1min');

-- La bandeja trae la asignación.
CREATE OR REPLACE FUNCTION public.chat_conversaciones(p_estado text DEFAULT 'abierta', p_antes timestamptz DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(x ORDER BY x.ultimo_mensaje_at DESC) FROM (
      SELECT cv.id, cv.customer_id, cv.estado, cv.ultimo_mensaje_at, cv.ultimo_de, cv.ultimo_texto,
             cv.sin_leer_equipo, cv.tomada_por, cv.tomada_at,
             (cv.tomada_por IS NOT NULL AND cv.tomada_at > now() - interval '10 minutes') AS tomada_vigente,
             cv.etiquetas, cv.calificacion, cv.calificacion_comentario, cv.esperando_desde,
             cv.asignada_a, cv.asignada_at, cv.escalada_sala_at, cv.escalada_supervision_at,
             c.name AS cliente, c.phone AS telefono,
             f.ruta AS foto_ruta,
             public.cliente_es_empleado(cv.customer_id) AS es_team,
             (public.mayorista_de(cv.customer_id) ->> 'estado') = 'aprobado' AS es_mayoreo,
             public.mayorista_de(cv.customer_id) ->> 'rango' AS rango,
             (public.puntos_nivel_de(public.puntos_compra_12m(cv.customer_id, (now() AT TIME ZONE 'America/El_Salvador')::date))).clave AS nivel
        FROM public.app_chat_conversaciones cv
        JOIN public.customers c ON c.id = cv.customer_id
        LEFT JOIN public.app_cliente_fotos f ON f.customer_id = cv.customer_id AND f.quitada_at IS NULL
       WHERE (p_estado IS NULL OR cv.estado = p_estado)
         AND (p_antes IS NULL OR cv.ultimo_mensaje_at < p_antes)
       ORDER BY cv.ultimo_mensaje_at DESC
       LIMIT 40) x), '[]'::json);
END;
$function$;
