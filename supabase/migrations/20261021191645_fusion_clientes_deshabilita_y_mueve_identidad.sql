-- Fusionar clientes: la duplicada queda DESHABILITADA en la principal y todo
-- lo de la app del cliente se mueve (decisión del dueño 2026-10-21).
-- Parte de la definición viva de fusionar_cliente_duplicado (v2.1330.0).
SET lock_timeout = '5s';

-- ── La ficha vigente de un cliente ─────────────────────────────────────────
-- Sigue `fusionada_en_id` hasta la principal. plpgsql a propósito: un bucle
-- por PK, sin plan que dependa del argumento.
CREATE OR REPLACE FUNCTION public.cliente_vigente(p_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v bigint := p_id;
  n bigint;
  i int := 0;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  LOOP
    SELECT c.fusionada_en_id INTO n FROM public.customers c WHERE c.id = v;
    EXIT WHEN n IS NULL OR i >= 10;
    v := n; i := i + 1;
  END LOOP;
  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cliente_vigente(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_vigente(bigint) TO authenticated, service_role;

-- ── Fusionar: mover TODO y deshabilitar, nunca borrar ──────────────────────
-- Decisión del dueño (2026-10-21): «debe quedar en la cuenta principal, la
-- otra debe quedar deshabilitada». Hasta acá el DELETE final se llevaba en
-- cascada la identidad de la app (sesiones, correos, foto, referidos, wallet,
-- chat, mayorista…). Ahora:
--   · todo lo que cuelga de la ficha se MUEVE a la principal;
--   · donde la tabla admite UNA fila por cliente (o por cliente+clave) y la
--     principal ya tiene la suya, GANA LA PRINCIPAL y la de la duplicada se
--     queda en la ficha deshabilitada — no se pierde, y sigue visible desde
--     ahí con `fusionada_en_id`. Nunca se pisa un dato de la principal;
--   · el chat es la excepción: los mensajes se mueven a la conversación de la
--     principal (dos conversaciones de la misma persona son una sola charla) y
--     la conversación vacía se elimina — no queda ningún mensaje en ella;
--   · la ficha duplicada queda con `fusionada_en_id` + `deshabilitada_at`, sin
--     NIT (es único: si el espejo se lo trae a la principal chocaría). Su fila
--     completa queda en `audit_logs` antes de tocarla.
CREATE OR REPLACE FUNCTION public.fusionar_cliente_duplicado(p_huerfana bigint, p_erp_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h        public.customers%ROWTYPE;
  v_buena    public.customers%ROWTYPE;
  v_movidas  integer := 0;
  v_mov      jsonb   := '{}'::jsonb;
  v_n        integer;
  v_conv_h   bigint;
  v_conv_b   bigint;
BEGIN
  -- `service_role` es el proceso automático: ya es de confianza y no tiene
  -- empleado que resolver. Para cualquier otro, el permiso de siempre.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_h FROM public.customers WHERE id = p_huerfana FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUERFANA_NO_EXISTE'; END IF;

  -- Ya fusionada: no hay nada que hacer (la corrida no debería traerla).
  IF v_h.deshabilitada_at IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'ya_fusionada', true,
      'huerfana', json_build_object('id', p_huerfana, 'name', v_h.name),
      'destino', json_build_object('id', v_h.fusionada_en_id));
  END IF;

  -- Solo se fusiona una ficha SIN emparejar. Una con erp_id es la buena de
  -- alguien y deshabilitarla sería perder el vínculo, no limpiarlo.
  IF v_h.erp_id IS NOT NULL THEN RAISE EXCEPTION 'HUERFANA_YA_EMPAREJADA'; END IF;
  IF public.es_cliente_mostrador(v_h.name, v_h.erp_id) THEN
    RAISE EXCEPTION 'ES_MOSTRADOR';
  END IF;

  SELECT * INTO v_buena FROM public.customers
   WHERE erp_id = p_erp_id AND id <> p_huerfana FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESTINO_NO_EXISTE'; END IF;
  IF v_buena.deshabilitada_at IS NOT NULL THEN RAISE EXCEPTION 'DESTINO_DESHABILITADO'; END IF;

  -- Los puntos son saldo de una persona: no se mezclan de noche.
  IF EXISTS (SELECT 1 FROM public.puntos_cuenta  WHERE customer_id = p_huerfana)
     OR EXISTS (SELECT 1 FROM public.puntos_lote   WHERE customer_id = p_huerfana)
     OR EXISTS (SELECT 1 FROM public.puntos_salida WHERE customer_id = p_huerfana) THEN
    RAISE EXCEPTION 'TIENE_PUNTOS';
  END IF;

  -- ── Lo que tiene historia propia: se mueve entero ────────────────────────
  UPDATE public.sales_invoices SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_movidas = ROW_COUNT;
  v_mov := v_mov || jsonb_build_object('facturas', v_movidas);

  UPDATE public.creditos_de_clientes SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('creditos', v_n);

  UPDATE public.creditos_pagos SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('pagos', v_n);

  UPDATE public.bitacora_dispensaciones SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('dispensaciones', v_n);

  UPDATE public.consentimientos_cliente SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('consentimientos', v_n);

  UPDATE public.cotizaciones SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('cotizaciones', v_n);

  UPDATE public.customers_changelog SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('cambios', v_n);

  UPDATE public.espejo_conflictos SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('conflictos', v_n);

  -- Pedido de dato para un DTE: la llave viva es (cliente, campo) mientras está
  -- PENDIENTE. Se mueve lo que no choca; lo que choca es el MISMO pedido hecho
  -- dos veces y se queda en la deshabilitada.
  UPDATE public.dte_datos_pedidos d SET customer_id = v_buena.id
   WHERE d.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.dte_datos_pedidos o
                      WHERE o.customer_id = v_buena.id AND o.campo = d.campo
                        AND o.estado = 'PENDIENTE' AND d.estado = 'PENDIENTE');
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('pedidos_dte', v_n);

  UPDATE public.dte_correcciones_ficha SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('correcciones_dte', v_n);

  UPDATE public.dte_clientes_siempre_se_envian a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.dte_clientes_siempre_se_envian b WHERE b.customer_id = v_buena.id);

  -- Reservas, encargos, cobros en línea, preventa: dinero y compromisos.
  UPDATE public.app_reservas SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('reservas', v_n);

  UPDATE public.app_encargos SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('encargos', v_n);

  UPDATE public.app_reservas_pagos SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('pagos_en_linea', v_n);

  UPDATE public.preventas SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('preventas', v_n);

  UPDATE public.caja_movimientos_portal SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('movimientos_caja', v_n);

  UPDATE public.inyeccion_aplicaciones SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('inyecciones', v_n);

  UPDATE public.puntos_irregularidad SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('irregularidades', v_n);

  UPDATE public.puntos_cambio_pendiente SET customer_nuevo = v_buena.id WHERE customer_nuevo = p_huerfana;

  UPDATE public.app_cliente_muestras SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('muestras', v_n);

  -- La aceptación de términos es constancia legal: no se borra.
  UPDATE public.app_cliente_aceptaciones SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('aceptaciones', v_n);

  UPDATE public.app_tratamientos a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.app_tratamientos b WHERE b.customer_id = v_buena.id AND b.product_id = a.product_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('tratamientos', v_n);

  -- ── Identidad de la app del cliente ──────────────────────────────────────
  -- Sesiones: cada una es un token propio (único por hash), no chocan. Quien
  -- tenía la app abierta en la duplicada sigue adentro, ya en la principal.
  UPDATE public.app_cliente_sesiones SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('sesiones', v_n);

  -- Correos guardados: (cliente, correo). El mismo correo en las dos es el
  -- mismo dato; se suma el uso a la principal y la copia queda atrás.
  UPDATE public.app_cliente_correos b
     SET veces = coalesce(b.veces, 0) + coalesce(a.veces, 0),
         usado_at = greatest(b.usado_at, a.usado_at)
    FROM public.app_cliente_correos a
   WHERE a.customer_id = p_huerfana AND b.customer_id = v_buena.id AND b.correo = a.correo;
  UPDATE public.app_cliente_correos a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.app_cliente_correos b
                      WHERE b.customer_id = v_buena.id AND b.correo = a.correo);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('correos', v_n);

  UPDATE public.app_cliente_correo_envios SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('correos_enviados', v_n);

  -- Foto: una por cliente. Gana la de la principal si tiene.
  UPDATE public.app_cliente_fotos a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.app_cliente_fotos b WHERE b.customer_id = v_buena.id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('foto', v_n);

  -- Referidos: el código es uno por cliente (gana el de la principal); los
  -- invitados que trajo la duplicada pasan a la principal; si a la duplicada
  -- la invitó alguien y la principal no tiene padrino, lo hereda.
  UPDATE public.app_cliente_referido_codigo a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.app_cliente_referido_codigo b WHERE b.customer_id = v_buena.id);
  UPDATE public.app_cliente_referidos SET referidor_id = v_buena.id WHERE referidor_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('referidos', v_n);
  UPDATE public.app_cliente_referidos a SET invitado_id = v_buena.id
   WHERE a.invitado_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.app_cliente_referidos b WHERE b.invitado_id = v_buena.id);

  UPDATE public.app_cliente_preregistros SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  UPDATE public.app_errores SET customer_id = v_buena.id WHERE customer_id = p_huerfana;

  -- Wallet: (dispositivo, serial) es único sin importar el cliente.
  UPDATE public.wallet_registros SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('wallet', v_n);

  UPDATE public.app_cliente_avisos a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.app_cliente_avisos b
                      WHERE b.customer_id = v_buena.id AND b.tipo = a.tipo AND b.ref IS NOT DISTINCT FROM a.ref);
  UPDATE public.app_historias_vistas a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.app_historias_vistas b
                      WHERE b.customer_id = v_buena.id AND b.historia_id = a.historia_id);
  UPDATE public.encuesta_cliente_respuestas a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT (a.canal = 'app' AND EXISTS (SELECT 1 FROM public.encuesta_cliente_respuestas b
                      WHERE b.customer_id = v_buena.id AND b.encuesta_id = a.encuesta_id AND b.canal = 'app'));
  UPDATE public.encuesta_cliente_incentivos SET customer_id = v_buena.id WHERE customer_id = p_huerfana;

  -- Chat: una conversación por cliente. Si la principal no tiene, se muda la
  -- de la duplicada entera. Si tiene, los mensajes pasan a la de la principal
  -- y la conversación vacía se elimina.
  SELECT id INTO v_conv_h FROM public.app_chat_conversaciones WHERE customer_id = p_huerfana;
  SELECT id INTO v_conv_b FROM public.app_chat_conversaciones WHERE customer_id = v_buena.id;
  IF v_conv_h IS NOT NULL AND v_conv_b IS NULL THEN
    UPDATE public.app_chat_conversaciones SET customer_id = v_buena.id WHERE id = v_conv_h;
    v_mov := v_mov || jsonb_build_object('chat', 'conversacion');
  ELSIF v_conv_h IS NOT NULL THEN
    UPDATE public.app_chat_mensajes SET conversacion_id = v_conv_b WHERE conversacion_id = v_conv_h;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('chat_mensajes', v_n);
    UPDATE public.app_chat_incumplimientos SET conversacion_id = v_conv_b WHERE conversacion_id = v_conv_h;
    UPDATE public.app_chat_conversaciones b
       SET sin_leer_equipo  = coalesce(b.sin_leer_equipo, 0)  + coalesce(h.sin_leer_equipo, 0),
           sin_leer_cliente = coalesce(b.sin_leer_cliente, 0) + coalesce(h.sin_leer_cliente, 0),
           ultimo_mensaje_at = CASE WHEN h.ultimo_mensaje_at > b.ultimo_mensaje_at OR b.ultimo_mensaje_at IS NULL
                                    THEN h.ultimo_mensaje_at ELSE b.ultimo_mensaje_at END,
           ultimo_de    = CASE WHEN h.ultimo_mensaje_at > b.ultimo_mensaje_at OR b.ultimo_mensaje_at IS NULL
                               THEN h.ultimo_de ELSE b.ultimo_de END,
           ultimo_texto = CASE WHEN h.ultimo_mensaje_at > b.ultimo_mensaje_at OR b.ultimo_mensaje_at IS NULL
                               THEN h.ultimo_texto ELSE b.ultimo_texto END
      FROM public.app_chat_conversaciones h
     WHERE b.id = v_conv_b AND h.id = v_conv_h;
    DELETE FROM public.app_chat_conversaciones c
     WHERE c.id = v_conv_h
       AND NOT EXISTS (SELECT 1 FROM public.app_chat_mensajes m WHERE m.conversacion_id = v_conv_h);
  END IF;

  -- Mayorista: una fila por cliente; gana la de la principal. El historial y
  -- los resúmenes del mes se mueven (el resumen, si la principal no tiene ese mes).
  UPDATE public.clientes_mayoristas a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.clientes_mayoristas b WHERE b.customer_id = v_buena.id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('mayorista', v_n);
  UPDATE public.clientes_mayoristas_historial SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  UPDATE public.mayoristas_resumen_mensual a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.mayoristas_resumen_mensual b
                      WHERE b.customer_id = v_buena.id AND b.mes = a.mes);

  -- ── Una fila por cliente: sólo si la buena no tiene la suya ──────────────
  UPDATE public.customer_activity a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.customer_activity b WHERE b.customer_id = v_buena.id);

  UPDATE public.clientes_sin_producto a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.clientes_sin_producto b WHERE b.customer_id = v_buena.id);

  -- El código del ticket: si queda en la deshabilitada, el ingreso a la app lo
  -- resuelve a la principal igual (`puntos_cliente_por_documento`).
  UPDATE public.puntos_codigo_acceso a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.puntos_codigo_acceso b WHERE b.customer_id = v_buena.id);

  -- La revisión que hablaba de ESTA ficha suelta queda resuelta al fusionarla.
  -- Las que traen número se mueven: siguen siendo sobre un cliente que existe.
  DELETE FROM public.clientes_por_revisar
   WHERE customer_id = p_huerfana AND erp_id IS NULL;
  UPDATE public.clientes_por_revisar SET customer_id = v_buena.id
   WHERE customer_id = p_huerfana;

  -- Fichas que ya se habían fusionado en ésta apuntan ahora a la principal.
  UPDATE public.customers SET fusionada_en_id = v_buena.id WHERE fusionada_en_id = p_huerfana;

  -- ── Deshabilitar, no borrar ──────────────────────────────────────────────
  -- El nombre se conserva: es lo que hace que la próxima factura escrita igual
  -- se ligue a la principal en vez de abrir otra ficha suelta.
  UPDATE public.customers
     SET fusionada_en_id = v_buena.id, deshabilitada_at = now(), nit = NULL,
         updated_at = now()
   WHERE id = p_huerfana;

  INSERT INTO public.audit_logs
    (action, target_id, user_id, user_name, source, severity, details)
  VALUES ('CLIENTE_DUPLICADO_FUSIONADO', p_huerfana::text,
          (SELECT public.auth_employee_id()),
          coalesce((SELECT e.name FROM public.employees e
                     WHERE e.id = (SELECT public.auth_employee_id())), 'Sistema'),
          CASE WHEN (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role'
               THEN 'SYSTEM' ELSE 'ADMIN_PANEL' END, 'INFO',
          jsonb_build_object(
            'huerfana_id', p_huerfana, 'huerfana_nombre', v_h.name,
            'destino_id', v_buena.id, 'destino_nombre', v_buena.name,
            'erp_id', p_erp_id, 'facturas_movidas', v_movidas,
            'deshabilitada', true,
            'ficha_antes', to_jsonb(v_h) - 'nombre_busq' - 'nombre_comp' - 'ids_busq' - 'ids_comp' - 'search_name',
            'movido', v_mov));

  RETURN json_build_object(
    'ok', true, 'facturas_movidas', v_movidas, 'movido', v_mov, 'deshabilitada', true,
    'huerfana', json_build_object('id', p_huerfana, 'name', v_h.name),
    'destino',  json_build_object('id', v_buena.id, 'name', v_buena.name,
                                  'erp_id', v_buena.erp_id));
END;
$function$;
