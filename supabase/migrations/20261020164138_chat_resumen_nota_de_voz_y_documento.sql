-- El resumen del último mensaje para la bandeja del equipo (2026-10-20): con
-- notas de voz y documentos en el chat, un mensaje sin texto ya no es sólo
-- «Foto» o «Producto». Reescrita desde la definición VIVA; sólo cambia
-- `ultimo_texto` (los dos lados usan la misma regla, `app_chat_resumen`).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_chat_resumen(p_texto text, p_adjunto jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, extensions
AS $$
  SELECT coalesce(left(p_texto, 140), CASE p_adjunto->>'tipo'
    WHEN 'audio' THEN 'Nota de voz' WHEN 'pdf' THEN 'Documento'
    WHEN 'producto' THEN 'Producto' WHEN 'oferta' THEN 'Oferta' ELSE 'Foto' END)
$$;
REVOKE EXECUTE ON FUNCTION public.app_chat_resumen(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_chat_resumen(text, jsonb) TO authenticated, service_role;

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
           ultimo_texto = public.app_chat_resumen(NEW.texto, NEW.adjunto),
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
           ultimo_texto = public.app_chat_resumen(NEW.texto, NEW.adjunto),
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
