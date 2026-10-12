-- Chat (2026-10-12), pedidos del usuario:
--   · «agrega el recordatorio» → si un cliente lleva 15 minutos esperando
--     respuesta, UN aviso al equipo (`chat_recordar_espera`, cron cada 5 min).
--     `esperando_desde` = el primer mensaje del cliente después de la última
--     respuesta del equipo; se borra al contestar.
--   · «que se pueda reaccionar y responder un mensaje» → reacciones con emoji
--     (`app_chat_reacciones`, una por persona y mensaje) y respuesta citando
--     un mensaje (`app_chat_mensajes.respuesta_a`).
SET lock_timeout = '5s';

ALTER TABLE public.app_chat_conversaciones
  ADD COLUMN IF NOT EXISTS esperando_desde timestamptz,
  ADD COLUMN IF NOT EXISTS espera_recordada_at timestamptz;
ALTER TABLE public.app_chat_mensajes
  ADD COLUMN IF NOT EXISTS respuesta_a bigint REFERENCES public.app_chat_mensajes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS app_chat_mensajes_respuesta_a_idx ON public.app_chat_mensajes (respuesta_a) WHERE respuesta_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_chat_conversaciones_esperando_idx ON public.app_chat_conversaciones (esperando_desde) WHERE esperando_desde IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.app_chat_reacciones (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mensaje_id  bigint NOT NULL REFERENCES public.app_chat_mensajes(id) ON DELETE CASCADE,
  autor       text NOT NULL CHECK (autor IN ('cliente', 'equipo')),
  employee_id uuid REFERENCES public.employees(id),
  emoji       text NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '😮', '🙏', '✅')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (autor <> 'equipo' OR employee_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS app_chat_reacciones_una_idx
  ON public.app_chat_reacciones (mensaje_id, autor, coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS app_chat_reacciones_employee_idx ON public.app_chat_reacciones (employee_id) WHERE employee_id IS NOT NULL;
ALTER TABLE public.app_chat_reacciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_chat_reacciones_select ON public.app_chat_reacciones FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('chat_clientes', 'can_view')));
REVOKE ALL ON public.app_chat_reacciones FROM anon;
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_chat_reacciones;

CREATE OR REPLACE FUNCTION public.chat_reaccionar(p_mensaje bigint, p_emoji text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid := public.auth_employee_id();
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_edit') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.app_chat_reacciones WHERE mensaje_id = p_mensaje AND autor = 'equipo' AND employee_id = v_emp;
  IF p_emoji IS NOT NULL THEN
    INSERT INTO public.app_chat_reacciones (mensaje_id, autor, employee_id, emoji) VALUES (p_mensaje, 'equipo', v_emp, p_emoji);
  END IF;
  RETURN json_build_object('ok', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chat_reaccionar(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_reaccionar(bigint, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.chat_responder(bigint, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.chat_responder(p_conversacion bigint, p_texto text, p_foto_ruta text DEFAULT NULL,
                                                 p_adjunto jsonb DEFAULT NULL, p_respuesta_a bigint DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid := public.auth_employee_id(); v_id bigint; v_customer bigint; v_nombre text;
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_edit') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_foto_ruta IS NOT NULL AND p_foto_ruta !~ ('^chat/[0-9]+/') THEN RAISE EXCEPTION 'RUTA_INVALIDA'; END IF;
  SELECT customer_id INTO v_customer FROM public.app_chat_conversaciones WHERE id = p_conversacion;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF p_respuesta_a IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.app_chat_mensajes
       WHERE id = p_respuesta_a AND conversacion_id = p_conversacion) THEN
    RAISE EXCEPTION 'CITA_INVALIDA';
  END IF;
  INSERT INTO public.app_chat_mensajes (conversacion_id, autor, employee_id, texto, foto_ruta, adjunto, respuesta_a)
  VALUES (p_conversacion, 'equipo', v_emp, nullif(btrim(coalesce(p_texto, '')), ''), p_foto_ruta, p_adjunto, p_respuesta_a)
  RETURNING id INTO v_id;
  SELECT split_part(name, ' ', 1) INTO v_nombre FROM public.employees WHERE id = v_emp;
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (v_customer, 'chat', 'chat:' || v_id, coalesce(v_nombre, 'Farmacia Salud') || ' te respondió',
          coalesce(left(nullif(btrim(coalesce(p_texto, '')), ''), 140), 'Te envió algo en el chat.'), '/chat')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  RETURN json_build_object('ok', true, 'id', v_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chat_responder(bigint, text, text, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_responder(bigint, text, text, jsonb, bigint) TO authenticated, service_role;

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
           esperando_desde = NULL, espera_recordada_at = NULL
     WHERE id = NEW.conversacion_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_chat_mensaje_nuevo() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chat_recordar_espera()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r record; v_dest uuid[]; v_n integer := 0;
BEGIN
  IF NOT coalesce((public.farmacia_estado() ->> 'abierta')::boolean, false) THEN RETURN 0; END IF;
  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'chat_clientes'
                 AND rp.can_view AND rp.role_id IN (e.role_id, e.secondary_role_id));
  FOR r IN
    SELECT cv.id, cv.esperando_desde, c.name AS cliente
      FROM public.app_chat_conversaciones cv JOIN public.customers c ON c.id = cv.customer_id
     WHERE cv.estado = 'abierta' AND cv.esperando_desde < now() - interval '15 minutes'
       AND cv.espera_recordada_at IS NULL
     LIMIT 50
  LOOP
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'CHAT_CLIENTE', coalesce(r.cliente, 'Un cliente') || ' espera respuesta',
        'Lleva ' || floor(extract(epoch FROM now() - r.esperando_desde) / 60)::int || ' minutos sin respuesta en el chat.', '/chat-clientes',
        jsonb_build_object('conversacion_id', r.id, 'check_key', 'chat-espera15:' || r.id || ':' || extract(epoch FROM r.esperando_desde)::bigint), true, NULL);
    END IF;
    UPDATE public.app_chat_conversaciones SET espera_recordada_at = now() WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chat_recordar_espera() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_recordar_espera() TO service_role;

SELECT cron.schedule('chat-recordar-espera-5min', '*/5 * * * *', $$SELECT public.chat_recordar_espera()$$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-recordar-espera-5min');
