-- «Borrar mi cuenta» de la app de clientes: lo que se borra en la BASE, en una
-- sola llamada (2026-10-19, auditoría).
--
-- Antes lo hacía la función de borde con selects y updates sueltos, y dos
-- cosas quedaban cortas: el `.limit(5000)` de las fotos del chat lo cortaba
-- PostgREST en 1000 sin avisar, y quedaban fuera datos que el aviso de
-- privacidad promete borrar (los correos guardados, el comentario de la
-- calificación del chat, el registro de Apple Wallet, el código de referido y
-- las historias vistas). Acá no hay techo de filas: es SQL.
--
-- Devuelve las rutas de los ARCHIVOS a borrar del almacenamiento (foto de
-- perfil y fotos del chat): eso no se puede hacer desde SQL y lo hace la
-- función de borde con la respuesta.
--
-- Lo que NO toca, a propósito (mismas reglas que antes):
--   · El chat queda con «Mensaje borrado»: de la conversación cuelgan
--     `app_chat_incumplimientos`, que miden al personal, no al cliente.
--   · La calificación (el número) se queda; el comentario, que es texto del
--     cliente, se borra.
--   · `app_cliente_referidos`: respalda los puntos que ya se dieron, también
--     a la otra persona. Se borra sólo el código para invitar.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_borrar_datos_de_cuenta(p_customer bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_archivos text[] := '{}';
  v_mensajes integer;
  v_correos integer;
  v_wallet integer;
  v_vistas integer;
BEGIN
  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'falta la ficha';
  END IF;

  SELECT coalesce(array_agg(f.ruta), '{}') INTO v_archivos
    FROM public.app_cliente_fotos f
   WHERE f.customer_id = p_customer AND f.ruta IS NOT NULL;
  DELETE FROM public.app_cliente_fotos WHERE customer_id = p_customer;

  v_archivos := v_archivos || (
    SELECT coalesce(array_agg(m.foto_ruta), '{}')
      FROM public.app_chat_mensajes m
      JOIN public.app_chat_conversaciones c ON c.id = m.conversacion_id
     WHERE c.customer_id = p_customer AND m.foto_ruta IS NOT NULL);

  UPDATE public.app_chat_mensajes m
     SET texto = 'Mensaje borrado', foto_ruta = NULL, adjunto = NULL
    FROM public.app_chat_conversaciones c
   WHERE c.id = m.conversacion_id
     AND c.customer_id = p_customer
     AND (m.texto IS DISTINCT FROM 'Mensaje borrado' OR m.foto_ruta IS NOT NULL OR m.adjunto IS NOT NULL);
  GET DIAGNOSTICS v_mensajes = ROW_COUNT;

  -- `ultimo_texto` es la vista previa del último mensaje: también es texto suyo.
  UPDATE public.app_chat_conversaciones
     SET calificacion_comentario = NULL,
         ultimo_texto = CASE WHEN ultimo_texto IS NULL THEN NULL ELSE 'Mensaje borrado' END
   WHERE customer_id = p_customer
     AND (calificacion_comentario IS NOT NULL OR ultimo_texto IS DISTINCT FROM 'Mensaje borrado');

  DELETE FROM public.app_cliente_correos WHERE customer_id = p_customer;
  GET DIAGNOSTICS v_correos = ROW_COUNT;

  -- Sin registro, `wallet-pases` ya no le avisa al iPhone que hay tarjeta nueva.
  DELETE FROM public.wallet_registros WHERE customer_id = p_customer;
  GET DIAGNOSTICS v_wallet = ROW_COUNT;

  DELETE FROM public.app_cliente_referido_codigo WHERE customer_id = p_customer;

  DELETE FROM public.app_historias_vistas WHERE customer_id = p_customer;
  GET DIAGNOSTICS v_vistas = ROW_COUNT;

  RETURN json_build_object(
    'archivos', to_json(v_archivos),
    'mensajes', v_mensajes, 'correos', v_correos, 'wallet', v_wallet, 'historias_vistas', v_vistas);
END;
$function$;

REVOKE ALL ON FUNCTION public.app_borrar_datos_de_cuenta(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_borrar_datos_de_cuenta(bigint) TO service_role;

-- Las reservas de la app que quedan ABIERTAS y SIN PAGO al borrar la cuenta se
-- cancelan: nadie va a seguirlas, y así su foto de receta entra en lo que se
-- borra (la receta de una reserva cancelada no respalda ninguna dispensación).
-- Las que tienen pago o anticipo NO se tocan: devolver dinero lo decide una
-- persona. Las de origen 'sucursal' tampoco: son de la sala. Mismo cambio que
-- la acción `cancelar_reserva` de la app.
CREATE OR REPLACE FUNCTION public.app_cancelar_reservas_abiertas_sin_pago(p_customer bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  n integer;
BEGIN
  UPDATE public.app_reservas
     SET estado = 'cancelada', cerrada_at = now(), updated_at = now()
   WHERE customer_id = p_customer
     AND origen = 'app'
     AND estado IN ('en_revision', 'pendiente', 'lista')
     AND coalesce(pago_estado, 'pendiente') = 'pendiente';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.app_cancelar_reservas_abiertas_sin_pago(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cancelar_reservas_abiertas_sin_pago(bigint) TO service_role;
