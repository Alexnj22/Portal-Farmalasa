-- Avisos del chat al equipo (2026-10-12, decisión del usuario): «que no
-- llegue notificación al portal, suficiente con la burbuja; imagina que
-- llegan 20 mensajes, 20 notificaciones a todos. Sólo que llegue si hay
-- varios mensajes y no se ha contestado». Antes avisaba cada vez que una
-- conversación pasaba a sin leer. Ahora avisa UNA vez, cuando la conversación
-- junta 3 mensajes del cliente sin respuesta (al llegar el tercero); si el
-- equipo contesta, el contador vuelve a 0 y el ciclo empieza de nuevo.
SET lock_timeout = '5s';

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
    -- Sólo al juntar 3 sin respuesta (el tercero), una vez por ciclo.
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
           escribiendo_por = NULL, escribiendo_at = NULL, visto_equipo_at = NEW.created_at
     WHERE id = NEW.conversacion_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_chat_mensaje_nuevo() FROM PUBLIC, anon, authenticated;
