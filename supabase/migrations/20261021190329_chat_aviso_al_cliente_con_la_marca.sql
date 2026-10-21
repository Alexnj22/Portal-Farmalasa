SET lock_timeout = '5s';

-- El aviso que le llega al cliente cuando el equipo le responde (2026-10-21).
-- Antes: título «EDWIN te respondió» —el primer nombre tal cual está en la
-- ficha, en mayúsculas— y en la pantalla bloqueada no se veía que venía de la
-- farmacia. Ahora, como WhatsApp Business: el título es la marca y el cuerpo
-- lleva el primer nombre en mayúscula inicial («Edwin: …»). Decisión del
-- usuario. El resto de la función queda igual que la definición viva.
CREATE OR REPLACE FUNCTION public.chat_responder(p_conversacion bigint, p_texto text, p_foto_ruta text DEFAULT NULL::text, p_adjunto jsonb DEFAULT NULL::jsonb, p_respuesta_a bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid := public.auth_employee_id(); v_id bigint; v_customer bigint; v_nombre text; v_texto text; v_cuerpo text;
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
  v_texto := nullif(btrim(coalesce(p_texto, '')), '');
  INSERT INTO public.app_chat_mensajes (conversacion_id, autor, employee_id, texto, foto_ruta, adjunto, respuesta_a)
  VALUES (p_conversacion, 'equipo', v_emp, v_texto, p_foto_ruta, p_adjunto, p_respuesta_a)
  RETURNING id INTO v_id;
  -- Primer nombre, en mayúscula inicial («EDWIN» → «Edwin»).
  SELECT nullif(initcap(lower(split_part(btrim(coalesce(nullif(btrim(first_names), ''), name, '')), ' ', 1))), '')
    INTO v_nombre FROM public.employees WHERE id = v_emp;
  v_cuerpo := CASE
    WHEN v_texto IS NOT NULL THEN coalesce(v_nombre || ': ', '') || left(v_texto, 140)
    ELSE coalesce(v_nombre || ' te envió ', 'Te enviaron ') || CASE
      WHEN p_foto_ruta IS NOT NULL THEN 'una foto.'
      WHEN p_adjunto->>'tipo' = 'audio' THEN 'una nota de voz.'
      WHEN p_adjunto->>'tipo' = 'producto' THEN 'un producto.'
      WHEN p_adjunto->>'tipo' = 'oferta' THEN 'una oferta.'
      ELSE 'un mensaje.' END
  END;
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (v_customer, 'chat', 'chat:' || v_id, 'Farmacia Salud', v_cuerpo, '/chat')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  RETURN json_build_object('ok', true, 'id', v_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chat_responder(bigint, text, text, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_responder(bigint, text, text, jsonb, bigint) TO authenticated, service_role;
