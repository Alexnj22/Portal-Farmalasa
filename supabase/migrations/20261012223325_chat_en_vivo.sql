-- Chat en vivo (2026-10-12). Pedido del usuario: «si llegan mensajes, ¿aparece
-- como notificación? ¿aparece indicador de respuesta? ¿qué falta?».
--   · Push al instante: la respuesta del chat y la receta revisada entraban a
--     `app_cliente_avisos` y salían con el cron del minuto (hasta 60 s de
--     espera). Ahora un trigger le pide a `avisos-clientes` (modo
--     `pendientes`, que sólo manda esas filas) que salgan ya. pg_net es
--     asíncrono: no frena la escritura. El cron sigue como red.
--   · «Escribiendo…» en los dos sentidos y «Visto»: columnas en la
--     conversación. El equipo marca con `chat_escribiendo`; el cliente, por la
--     función de la app. Duran 6 s: si no se renuevan, se apagan solas.
SET lock_timeout = '5s';

ALTER TABLE public.app_chat_conversaciones
  ADD COLUMN IF NOT EXISTS escribiendo_por uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS escribiendo_at timestamptz,
  ADD COLUMN IF NOT EXISTS cliente_escribiendo_at timestamptz,
  ADD COLUMN IF NOT EXISTS visto_equipo_at timestamptz;

CREATE OR REPLACE FUNCTION public.chat_tomar(p_conversacion bigint, p_soltar boolean DEFAULT false)
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
  IF p_soltar THEN
    UPDATE public.app_chat_conversaciones SET tomada_por = NULL, tomada_at = NULL, escribiendo_por = NULL, escribiendo_at = NULL
     WHERE id = p_conversacion AND tomada_por = v_emp;
  ELSE
    UPDATE public.app_chat_conversaciones SET tomada_por = v_emp, tomada_at = now(), sin_leer_equipo = 0, visto_equipo_at = now()
     WHERE id = p_conversacion
       AND (tomada_por IS NULL OR tomada_por = v_emp OR tomada_at < now() - interval '10 minutes');
  END IF;
  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_escribiendo(p_conversacion bigint)
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
     SET escribiendo_por = public.auth_employee_id(), escribiendo_at = now(), visto_equipo_at = now()
   WHERE id = p_conversacion;
  RETURN json_build_object('ok', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chat_escribiendo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_escribiendo(bigint) TO authenticated, service_role;

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
           estado = 'abierta', resuelta_at = NULL, resuelta_por = NULL
     WHERE id = NEW.conversacion_id;
    IF coalesce(v_antes, 0) = 0 THEN
      SELECT name INTO v_cliente FROM public.customers WHERE id = v_customer;
      SELECT array_agg(e.id) INTO v_dest FROM public.employees e
       WHERE e.status = 'ACTIVO'
         AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'chat_clientes'
                     AND rp.can_view AND rp.role_id IN (e.role_id, e.secondary_role_id));
      IF v_dest IS NOT NULL THEN
        PERFORM public.notify_employees(v_dest, 'CHAT_CLIENTE', 'Mensaje de ' || coalesce(v_cliente, 'un cliente'),
          coalesce(left(NEW.texto, 140), 'Envió una foto'), '/chat-clientes',
          jsonb_build_object('conversacion_id', NEW.conversacion_id), true, NULL);
      END IF;
    END IF;
  ELSIF NEW.autor = 'equipo' THEN
    UPDATE public.app_chat_conversaciones
       SET ultimo_mensaje_at = NEW.created_at, ultimo_de = 'equipo',
           ultimo_texto = coalesce(left(NEW.texto, 140), CASE WHEN NEW.adjunto IS NOT NULL THEN 'Producto' ELSE 'Foto' END),
           sin_leer_equipo = 0, sin_leer_cliente = sin_leer_cliente + 1,
           tomada_por = NEW.employee_id, tomada_at = NEW.created_at,
           escribiendo_por = NULL, escribiendo_at = NULL, visto_equipo_at = NEW.created_at
     WHERE id = NEW.conversacion_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_chat_mensaje_nuevo() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_cliente_avisos_salir_ya()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_secreto text;
BEGIN
  SELECT decrypted_secret INTO v_secreto FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret';
  IF v_secreto IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/avisos-clientes',
      body := '{"modo":"pendientes"}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
      timeout_milliseconds := 20000);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_cliente_avisos_salir_ya() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS app_cliente_avisos_salir_ya ON public.app_cliente_avisos;
CREATE TRIGGER app_cliente_avisos_salir_ya AFTER INSERT ON public.app_cliente_avisos
  FOR EACH ROW WHEN (NEW.tipo IN ('chat', 'receta') AND NEW.enviado = false)
  EXECUTE FUNCTION public.app_cliente_avisos_salir_ya();
