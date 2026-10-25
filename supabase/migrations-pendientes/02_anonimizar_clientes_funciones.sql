-- ══════════════════════════════════════════════════════════════════════════
-- Anonimizar a un cliente A PEDIDO (derecho de cancelación) — 2/3: funciones.
--
-- Rige desde que se aplique. Requiere 01_anonimizar_clientes_tablas.sql.
--
--   datos_anonimizacion_evaluar   (interna) EL juez: ¿se puede?, ¿qué se toca?
--   datos_anonimizacion           vista previa + estado, para la pantalla
--   datos_anonimizar_cliente      la anonimización (una transacción)
--   datos_anonimizacion_archivos  qué archivos quedan por borrar (reintento)
--   datos_anonimizacion_archivos_hechos  (service_role) los marca borrados
--   datos_resguardo_leer          leer lo resguardado: permiso + motivo + bitácora
--   datos_documento_anonimizado   ¿este documento pidió anonimizarse? (sí/no)
--   datos_reactivar_cliente       si vuelve: restaura SU ficha (sin los puntos)
--   update_customer_fiscal        + candado: una ficha anónima no se edita
--
-- ── Qué se hace con cada tabla que cuelga de `customers` ────────────────────
-- (las 55 FKs medidas en producción el 2026-10-24; «resguardo» = la fila
-- entera va a `clientes_resguardo` antes de borrarla o vaciarla)
--
-- CONSERVAR TAL CUAL — la ley obliga o es un libro contable/fiscal:
--   sales_invoices (+ renglones), cotizaciones, bitacora_dispensaciones (libro
--   de receta), creditos_de_clientes, creditos_pagos, dte_datos_pedidos,
--   dte_clientes_siempre_se_envian, preventas, app_reservas_pagos, app_encargos,
--   app_reservas (salvo `direccion_entrega` y la receta que nunca valió, abajo),
--   todo el libro de puntos (puntos_cuenta, puntos_lote, puntos_salida,
--   puntos_anulacion_gastada, puntos_irregularidad, puntos_cambio_cliente,
--   puntos_cambio_pendiente, puntos_fusion, puntos_premios, puntos_observacion,
--   encuesta_cliente_incentivos): el historial NO se borra, el saldo se cierra
--   con una salida 'ajuste'. app_cliente_referidos: es historial de premios y
--   sólo lleva ids y un código. customer_activity: agregados sin datos
--   personales. clientes_sin_producto, clientes_mayoristas(+historial,
--   resumen_mensual): estado comercial sin datos personales.
--   customers.fusionada_en_id: la ficha fusionada se anonimiza también.
--
-- RESGUARDO + BORRAR — tienen valor legal o son contenido de la persona:
--   consentimientos_cliente, app_cliente_aceptaciones (evidencia del Art. 54),
--   customers_changelog y espejo_conflictos (guardan valores viejos de la
--   ficha: el DUI, el teléfono…), clientes_por_revisar (nombre y `datos`),
--   app_chat_mensajes, app_chat_conversaciones (las que no tienen
--   incumplimientos), app_cliente_preregistros, app_cliente_avisos,
--   app_cliente_correos, app_cliente_correo_envios, app_cliente_fotos (+ el
--   archivo), app_cliente_muestras, app_tratamientos (dato de salud inferido).
--
-- RESGUARDO + VACIAR — la fila es un registro que tiene que seguir existiendo:
--   customers (la ficha), reclamos_clientes (folio ante la autoridad: se vacían
--   nombre y teléfono), encuesta_cliente_respuestas (la respuesta sigue
--   contando en la estadística, sin contacto ni ficha), app_chat_conversaciones
--   con incumplimientos (de ella cuelga la medida del personal: queda la cáscara
--   sin texto), app_reservas (`direccion_entrega`; y `receta_ruta` sólo si la
--   receta nunca respaldó una dispensación).
--
-- BORRAR SIN RESGUARDO — son credenciales o telemetría, no datos de la persona:
--   app_cliente_sesiones (tokens), wallet_registros (tokens de aviso),
--   puntos_codigo_acceso (código de entrada), app_cliente_referido_codigo,
--   app_historias_vistas. app_errores: se le quita el `customer_id`.
--
-- solicitudes_datos (la propia solicitud) NO se toca: es la prueba de que se
-- respondió (Art. 54) y sólo la ve el módulo de datos personales. Sí se copia
-- al resguardo, para que el expediente de la anonimización esté completo.
--
-- audit_logs tampoco: es append-only por diseño y es la bitácora legal.
--
-- ── Lo que NO se puede anonimizar (bloqueos) ───────────────────────────────
-- Persona jurídica (la ley protege a personas naturales), ficha genérica de
-- mostrador, ficha fusionada (se anonimiza la principal), documento que no
-- coincide con el cotejado, y obligaciones vigentes: créditos con saldo,
-- reservas/encargos/preventas abiertas, saldo a favor sin usar. Mientras la
-- relación exista, la ley permite (y el negocio necesita) conservar los datos.
--
-- Verificado en el entorno de pruebas (bbfotmyuvmrtmbuqxmhf) con execute_sql —
-- ver el informe de la tanda: ficha con facturas, chat y puntos.
-- ══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

-- ── Normalizar un documento (igual que la huella) ──────────────────────────
CREATE OR REPLACE FUNCTION public.datos_doc_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$ SELECT nullif(upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), '') $$;
REVOKE EXECUTE ON FUNCTION public.datos_doc_norm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.datos_doc_norm(text) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- EL juez. Lo llaman la vista previa Y la anonimización: si pudieran contestar
-- distinto, la pantalla diría «se puede» y el botón lo rechazaría.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.datos_anonimizacion_evaluar(p_solicitud uuid, p_customer bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_s public.solicitudes_datos;
  v_c public.customers;
  v_bloqueos text[] := '{}';
  v_fichas bigint[];
  v_docs_sol text[];
  v_docs_ficha text[];
  v_sin_doc boolean := false;
  v_puntos integer := 0;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_n integer;
  v_conteos jsonb;
BEGIN
  SELECT * INTO v_s FROM public.solicitudes_datos WHERE id = p_solicitud;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('puede', false, 'bloqueos', jsonb_build_array('La solicitud no existe.'));
  END IF;
  IF v_s.estado <> 'RESUELTA' OR coalesce(v_s.negada, false) THEN
    v_bloqueos := v_bloqueos || 'Sólo se anonimiza desde una solicitud RESUELTA a favor (no negada).';
  END IF;
  IF NOT ('cancelacion' = ANY (coalesce(v_s.derechos, '{}'))) THEN
    v_bloqueos := v_bloqueos || 'La solicitud no pide cancelación.';
  END IF;

  SELECT * INTO v_c FROM public.customers WHERE id = p_customer;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('puede', false, 'bloqueos', to_jsonb(v_bloqueos || 'La ficha no existe.'::text));
  END IF;

  IF v_c.anonimizada_at IS NOT NULL THEN
    v_bloqueos := v_bloqueos || 'Esta ficha ya está anonimizada.';
  END IF;
  IF v_c.deshabilitada_at IS NOT NULL THEN
    v_bloqueos := v_bloqueos || format('Es una ficha fusionada en la #%s: se anonimiza la principal.', v_c.fusionada_en_id);
  END IF;
  IF public.es_cliente_mostrador(v_c.name, v_c.erp_id) THEN
    v_bloqueos := v_bloqueos || 'Es la ficha genérica de mostrador: no es de una persona.';
  END IF;
  IF v_c.tipo_persona = 'juridica' THEN
    v_bloqueos := v_bloqueos || 'Es una persona jurídica: el derecho de cancelación es de las personas naturales.';
  END IF;

  -- ¿Es la ficha de QUIEN pidió? El documento cotejado (y el escrito en la
  -- hoja) contra el DUI, el NIT y el pasaporte de la ficha. Nunca sobre una
  -- ficha cualquiera: con documentos que no coinciden, no se anonimiza.
  SELECT coalesce(array_agg(DISTINCT d) FILTER (WHERE d IS NOT NULL), '{}') INTO v_docs_sol
    FROM unnest(ARRAY[public.datos_doc_norm(v_s.identidad_numero), public.datos_doc_norm(v_s.solicitante_numero)]) d;
  SELECT coalesce(array_agg(DISTINCT d) FILTER (WHERE d IS NOT NULL), '{}') INTO v_docs_ficha
    FROM unnest(ARRAY[public.datos_doc_norm(v_c.dui), public.datos_doc_norm(v_c.nit), public.datos_doc_norm(v_c.pasaporte)]) d;
  IF cardinality(v_docs_sol) = 0 THEN
    v_bloqueos := v_bloqueos || 'La solicitud no tiene el número del documento cotejado.';
  ELSIF cardinality(v_docs_ficha) = 0 THEN
    v_sin_doc := true;   -- se permite, con un motivo escrito
  ELSIF NOT (v_docs_ficha && v_docs_sol) THEN
    v_bloqueos := v_bloqueos || 'El documento de la ficha no coincide con el cotejado en la solicitud.';
  END IF;

  v_fichas := ARRAY[v_c.id] || coalesce((SELECT array_agg(id ORDER BY id) FROM public.customers
                                          WHERE fusionada_en_id = v_c.id), '{}');

  -- Obligaciones vigentes.
  SELECT count(*) INTO v_n FROM public.creditos_de_clientes WHERE customer_id = ANY (v_fichas) AND saldo > 0;
  IF v_n > 0 THEN
    v_bloqueos := v_bloqueos || format('Tiene %s crédito(s) con saldo: es una obligación vigente, se conserva hasta saldarla.', v_n);
  END IF;
  SELECT count(*) INTO v_n FROM public.app_reservas
   WHERE customer_id = ANY (v_fichas) AND estado IN ('en_revision', 'pendiente', 'lista');
  IF v_n > 0 THEN
    v_bloqueos := v_bloqueos || format('Tiene %s reserva(s) abierta(s): hay que cerrarlas primero.', v_n);
  END IF;
  SELECT count(*) INTO v_n FROM public.app_reservas
   WHERE customer_id = ANY (v_fichas) AND coalesce(saldo_favor, 0) > 0
     AND saldo_favor_usado_at IS NULL AND saldo_favor_devuelto_at IS NULL
     AND (saldo_favor_vence IS NULL OR saldo_favor_vence >= v_hoy);
  IF v_n > 0 THEN
    v_bloqueos := v_bloqueos || 'Tiene saldo a favor sin usar: hay que usarlo o devolverlo primero.';
  END IF;
  SELECT count(*) INTO v_n FROM public.app_encargos
   WHERE customer_id = ANY (v_fichas) AND estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo');
  IF v_n > 0 THEN
    v_bloqueos := v_bloqueos || format('Tiene %s encargo(s) abierto(s): hay que cerrarlos primero.', v_n);
  END IF;
  SELECT count(*) INTO v_n FROM public.preventas
   WHERE customer_id = ANY (v_fichas) AND estado IN ('enviando', 'viva', 'sin_enlace');
  IF v_n > 0 THEN
    v_bloqueos := v_bloqueos || format('Tiene %s preventa(s) en curso.', v_n);
  END IF;

  SELECT coalesce(sum(restantes), 0)::integer INTO v_puntos
    FROM public.puntos_lote WHERE customer_id = ANY (v_fichas) AND restantes > 0;

  v_conteos := jsonb_build_object(
    'conserva', jsonb_build_object(
      'facturas',        (SELECT count(*) FROM public.sales_invoices WHERE customer_id = ANY (v_fichas)),
      'dispensaciones',  (SELECT count(*) FROM public.bitacora_dispensaciones WHERE customer_id = ANY (v_fichas)),
      'creditos',        (SELECT count(*) FROM public.creditos_de_clientes WHERE customer_id = ANY (v_fichas)),
      'cotizaciones',    (SELECT count(*) FROM public.cotizaciones WHERE customer_id = ANY (v_fichas)),
      'reservas',        (SELECT count(*) FROM public.app_reservas WHERE customer_id = ANY (v_fichas)),
      'movimientos_puntos', (SELECT count(*) FROM public.puntos_lote WHERE customer_id = ANY (v_fichas))
                          + (SELECT count(*) FROM public.puntos_salida WHERE customer_id = ANY (v_fichas))),
    'resguarda', jsonb_build_object(
      'consentimientos', (SELECT count(*) FROM public.consentimientos_cliente WHERE customer_id = ANY (v_fichas))
                       + (SELECT count(*) FROM public.app_cliente_aceptaciones WHERE customer_id = ANY (v_fichas)),
      'cambios_de_ficha', (SELECT count(*) FROM public.customers_changelog WHERE customer_id = ANY (v_fichas)),
      'reclamos',        (SELECT count(*) FROM public.reclamos_clientes WHERE customer_id = ANY (v_fichas)),
      'encuestas',       (SELECT count(*) FROM public.encuesta_cliente_respuestas WHERE customer_id = ANY (v_fichas)),
      'solicitudes',     1),
    'borra', jsonb_build_object(
      'mensajes_chat',   (SELECT count(*) FROM public.app_chat_mensajes m JOIN public.app_chat_conversaciones c
                            ON c.id = m.conversacion_id WHERE c.customer_id = ANY (v_fichas)),
      'conversaciones',  (SELECT count(*) FROM public.app_chat_conversaciones WHERE customer_id = ANY (v_fichas)),
      'sesiones_app',    (SELECT count(*) FROM public.app_cliente_sesiones WHERE customer_id = ANY (v_fichas)),
      'avisos',          (SELECT count(*) FROM public.app_cliente_avisos WHERE customer_id = ANY (v_fichas)),
      'correos',         (SELECT count(*) FROM public.app_cliente_correos WHERE customer_id = ANY (v_fichas)),
      'fotos',           (SELECT count(*) FROM public.app_cliente_fotos WHERE customer_id = ANY (v_fichas)),
      'tratamientos',    (SELECT count(*) FROM public.app_tratamientos WHERE customer_id = ANY (v_fichas)),
      'preregistros',    (SELECT count(*) FROM public.app_cliente_preregistros WHERE customer_id = ANY (v_fichas)),
      'tarjeta_wallet',  (SELECT count(*) FROM public.wallet_registros WHERE customer_id = ANY (v_fichas)))
  );

  RETURN jsonb_build_object(
    'puede', cardinality(v_bloqueos) = 0,
    'bloqueos', to_jsonb(v_bloqueos),
    'requiere_motivo_sin_documento', v_sin_doc,
    'ficha', jsonb_build_object('id', v_c.id, 'name', v_c.name, 'erp_id', v_c.erp_id,
                                'categoria', v_c.categoria, 'tipo_persona', v_c.tipo_persona,
                                'tiene_ficha_en_caja', v_c.erp_id IS NOT NULL),
    'fichas', to_jsonb(v_fichas),
    'puntos_que_se_pierden', v_puntos,
    'conteos', v_conteos);
END $$;
REVOKE EXECUTE ON FUNCTION public.datos_anonimizacion_evaluar(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.datos_anonimizacion_evaluar(uuid, bigint) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- Vista previa + estado, para la pantalla. Sin `p_customer` propone las fichas
-- cuyo documento coincide con el de la solicitud (la búsqueda por documento es
-- un barrido de ~28K fichas: es una acción rara de una persona, no un listado).
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.datos_anonimizacion(p_solicitud uuid, p_customer bigint DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_s public.solicitudes_datos;
  v_docs text[];
  v_ids bigint[];
  v_hecha json;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['datos_personales'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_s FROM public.solicitudes_datos WHERE id = p_solicitud;
  IF NOT FOUND THEN RAISE EXCEPTION 'La solicitud no existe'; END IF;

  SELECT json_agg(json_build_object(
           'id', a.id, 'customer_id', a.customer_id, 'fichas', a.fichas,
           'anonimizada_at', a.anonimizada_at, 'puntos_perdidos', a.puntos_perdidos,
           'resumen', a.resumen, 'reactivada_at', a.reactivada_at,
           'archivos_pendientes', cardinality(a.archivos_pendientes),
           'archivos_borrados_at', a.archivos_borrados_at,
           'caja_pendientes', (SELECT count(*) FROM public.customers_changelog cl
                                WHERE cl.id = ANY (a.changelog_ids) AND cl.erp_synced_at IS NULL
                                  AND cl.descartado_at IS NULL),
           'caja_total', cardinality(a.changelog_ids),
           'lecturas', (SELECT count(*) FROM public.clientes_resguardo_lecturas l WHERE l.anonimizacion_id = a.id))
         ORDER BY a.id)
    INTO v_hecha
    FROM public.clientes_anonimizados a WHERE a.solicitud_id = p_solicitud;

  IF p_customer IS NOT NULL THEN
    v_ids := ARRAY[p_customer];
  ELSE
    SELECT coalesce(array_agg(DISTINCT d) FILTER (WHERE d IS NOT NULL), '{}') INTO v_docs
      FROM unnest(ARRAY[public.datos_doc_norm(v_s.identidad_numero), public.datos_doc_norm(v_s.solicitante_numero)]) d;
    SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}') INTO v_ids
      FROM public.customers c
     WHERE c.deshabilitada_at IS NULL AND c.anonimizada_at IS NULL
       AND cardinality(v_docs) > 0
       AND (public.datos_doc_norm(c.dui) = ANY (v_docs)
         OR public.datos_doc_norm(c.nit) = ANY (v_docs)
         OR public.datos_doc_norm(c.pasaporte) = ANY (v_docs));
  END IF;

  RETURN json_build_object(
    'hecha', coalesce(v_hecha, '[]'::json),
    'candidatos', coalesce((SELECT json_agg(public.datos_anonimizacion_evaluar(p_solicitud, i) ORDER BY i)
                              FROM unnest(v_ids) i), '[]'::json));
END $$;
REVOKE EXECUTE ON FUNCTION public.datos_anonimizacion(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.datos_anonimizacion(uuid, bigint) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- La anonimización. Una transacción: o queda todo, o no queda nada.
-- Devuelve los archivos del almacenamiento que hay que borrar (el SQL no puede
-- borrar objetos de Storage; lo hace la edge function `anonimizar-cliente`).
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.datos_anonimizar_cliente(
  p_solicitud uuid, p_customer bigint, p_confirmacion text, p_sin_documento_motivo text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_emp_nombre text;
  v_eval jsonb;
  v_fichas bigint[];
  v_f bigint;
  v_id bigint;
  v_s public.solicitudes_datos;
  v_c public.customers;
  v_motivo text := nullif(btrim(coalesce(p_sin_documento_motivo, '')), '');
  v_puntos_total integer := 0;
  v_vencen integer;
  v_salida bigint;
  v_changelog bigint[] := '{}';
  v_nuevos bigint[];
  v_archivos text[] := '{}';
  v_conv bigint[];
  v_resumen jsonb;
  v_doc text;
  v_anon_name text;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['datos_personales'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF upper(btrim(coalesce(p_confirmacion, ''))) <> 'ANONIMIZAR' THEN
    RAISE EXCEPTION 'Para confirmar, escribe ANONIMIZAR.';
  END IF;

  -- La ficha se bloquea ANTES de evaluar: entre la evaluación y la escritura
  -- un sync no puede cambiarla (el hueco leer→escribir).
  PERFORM 1 FROM public.customers WHERE id = p_customer OR fusionada_en_id = p_customer FOR UPDATE;
  SELECT * INTO v_s FROM public.solicitudes_datos WHERE id = p_solicitud FOR SHARE;

  v_eval := public.datos_anonimizacion_evaluar(p_solicitud, p_customer);
  IF NOT (v_eval ->> 'puede')::boolean THEN
    RAISE EXCEPTION '%', v_eval -> 'bloqueos' ->> 0;
  END IF;
  IF (v_eval ->> 'requiere_motivo_sin_documento')::boolean AND (v_motivo IS NULL OR length(v_motivo) < 15) THEN
    RAISE EXCEPTION 'La ficha no tiene documento: escribe por qué es la de esta persona (al menos 15 caracteres).';
  END IF;
  v_fichas := ARRAY(SELECT jsonb_array_elements_text(v_eval -> 'fichas')::bigint);
  SELECT name INTO v_emp_nombre FROM public.employees WHERE id = v_emp;

  INSERT INTO public.clientes_anonimizados (customer_id, fichas, solicitud_id, anonimizada_por, sin_documento_motivo)
  VALUES (p_customer, v_fichas, p_solicitud, v_emp,
          CASE WHEN (v_eval ->> 'requiere_motivo_sin_documento')::boolean THEN v_motivo END)
  RETURNING id INTO v_id;

  -- ── 1 · La solicitud, al expediente (no se toca: es la prueba) ──────────
  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  VALUES (v_id, p_customer, 'solicitudes_datos', v_s.id::text, 'vaciada', to_jsonb(v_s));
  -- 'vaciada' aquí significa «copiada»: la solicitud queda intacta en su tabla.

  -- ── 2 · Las huellas (antes de borrar nada: salen de los datos de hoy) ───
  INSERT INTO public.clientes_anonimizados_huellas (tipo, huella, customer_id, anonimizacion_id)
  SELECT 'documento', h, p_customer, v_id FROM (
    SELECT DISTINCT public.datos_huella('documento', d) h
      FROM public.customers c,
           LATERAL unnest(ARRAY[c.dui, c.nit, c.pasaporte, v_s.identidad_numero, v_s.solicitante_numero]) d
     WHERE c.id = ANY (v_fichas)) x
   WHERE h IS NOT NULL
  ON CONFLICT (tipo, huella) DO UPDATE SET customer_id = EXCLUDED.customer_id,
                                           anonimizacion_id = EXCLUDED.anonimizacion_id, created_at = now();
  INSERT INTO public.clientes_anonimizados_huellas (tipo, huella, customer_id, anonimizacion_id)
  SELECT DISTINCT 'nombre', public.datos_huella('nombre', c.name), p_customer, v_id
    FROM public.customers c WHERE c.id = ANY (v_fichas) AND public.datos_huella('nombre', c.name) IS NOT NULL
  ON CONFLICT (tipo, huella) DO UPDATE SET customer_id = EXCLUDED.customer_id,
                                           anonimizacion_id = EXCLUDED.anonimizacion_id, created_at = now();

  -- ── 3 · Resguardo + borrar ───────────────────────────────────────────────
  -- Un macro por tabla sería más corto, pero escrito a mano se lee qué pasa
  -- con cada una: que es justo lo que alguien va a preguntar.
  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'consentimientos_cliente', t.id::text, 'borrada', to_jsonb(t)
    FROM public.consentimientos_cliente t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.consentimientos_cliente WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'app_cliente_aceptaciones', t.id::text, 'borrada', to_jsonb(t)
    FROM public.app_cliente_aceptaciones t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.app_cliente_aceptaciones WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'espejo_conflictos', t.id::text, 'borrada', to_jsonb(t)
    FROM public.espejo_conflictos t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.espejo_conflictos WHERE customer_id = ANY (v_fichas);

  -- El historial de cambios guarda los valores VIEJOS (el DUI, el teléfono…).
  -- Va ANTES de escribir los renglones nuevos de la caja. Y borrar lo
  -- pendiente es lo correcto: lo que se iba a mandar a la caja era un dato que
  -- ahora se quita.
  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'customers_changelog', t.id::text, 'borrada', to_jsonb(t)
    FROM public.customers_changelog t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.customers_changelog WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'clientes_por_revisar', t.id::text, 'borrada', to_jsonb(t)
    FROM public.clientes_por_revisar t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.clientes_por_revisar WHERE customer_id = ANY (v_fichas);

  -- Chat: los mensajes se van (con sus reacciones, en cascada); la
  -- conversación también, salvo que de ella cuelgue un incumplimiento —la
  -- medida del personal—, y entonces queda la cáscara sin texto.
  SELECT coalesce(array_agg(id), '{}') INTO v_conv FROM public.app_chat_conversaciones WHERE customer_id = ANY (v_fichas);
  v_archivos := v_archivos || coalesce((SELECT array_agg(m.foto_ruta) FROM public.app_chat_mensajes m
                                         WHERE m.conversacion_id = ANY (v_conv) AND m.foto_ruta IS NOT NULL), '{}');
  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, c.customer_id, 'app_chat_mensajes', m.id::text, 'borrada', to_jsonb(m)
    FROM public.app_chat_mensajes m JOIN public.app_chat_conversaciones c ON c.id = m.conversacion_id
   WHERE m.conversacion_id = ANY (v_conv);
  UPDATE public.app_chat_mensajes SET respuesta_a = NULL
   WHERE respuesta_a IN (SELECT id FROM public.app_chat_mensajes WHERE conversacion_id = ANY (v_conv));
  DELETE FROM public.app_chat_mensajes WHERE conversacion_id = ANY (v_conv);
  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, c.customer_id, 'app_chat_conversaciones', c.id::text,
         CASE WHEN EXISTS (SELECT 1 FROM public.app_chat_incumplimientos i WHERE i.conversacion_id = c.id)
              THEN 'vaciada' ELSE 'borrada' END, to_jsonb(c)
    FROM public.app_chat_conversaciones c WHERE c.id = ANY (v_conv);
  DELETE FROM public.app_chat_conversaciones c
   WHERE c.id = ANY (v_conv)
     AND NOT EXISTS (SELECT 1 FROM public.app_chat_incumplimientos i WHERE i.conversacion_id = c.id);
  UPDATE public.app_chat_conversaciones
     SET ultimo_texto = NULL, calificacion_comentario = NULL, etiquetas = NULL
   WHERE id = ANY (v_conv);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'app_cliente_fotos', t.customer_id::text, 'borrada', to_jsonb(t)
    FROM public.app_cliente_fotos t WHERE t.customer_id = ANY (v_fichas);
  v_archivos := v_archivos || coalesce((SELECT array_agg(ruta) FROM public.app_cliente_fotos
                                         WHERE customer_id = ANY (v_fichas) AND ruta IS NOT NULL), '{}');
  DELETE FROM public.app_cliente_fotos WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'app_cliente_preregistros', t.id::text, 'borrada', to_jsonb(t)
    FROM public.app_cliente_preregistros t WHERE t.customer_id = ANY (v_fichas);
  -- El preregistro se lleva en cascada sus sesiones; las aceptaciones ya se
  -- resguardaron arriba.
  DELETE FROM public.app_cliente_preregistros WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'app_cliente_avisos', t.id::text, 'borrada', to_jsonb(t)
    FROM public.app_cliente_avisos t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.app_cliente_avisos WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'app_cliente_correos', t.id::text, 'borrada', to_jsonb(t)
    FROM public.app_cliente_correos t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.app_cliente_correos WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'app_cliente_correo_envios', t.id::text, 'borrada', to_jsonb(t)
    FROM public.app_cliente_correo_envios t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.app_cliente_correo_envios WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'app_cliente_muestras', t.id::text, 'borrada', to_jsonb(t)
    FROM public.app_cliente_muestras t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.app_cliente_muestras WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'app_tratamientos', t.id::text, 'borrada', to_jsonb(t)
    FROM public.app_tratamientos t WHERE t.customer_id = ANY (v_fichas);
  DELETE FROM public.app_tratamientos WHERE customer_id = ANY (v_fichas);

  -- ── 4 · Resguardo + vaciar ───────────────────────────────────────────────
  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'reclamos_clientes', t.id::text, 'vaciada',
         jsonb_build_object('id', t.id, 'cliente_nombre', t.cliente_nombre, 'cliente_telefono', t.cliente_telefono)
    FROM public.reclamos_clientes t WHERE t.customer_id = ANY (v_fichas);
  UPDATE public.reclamos_clientes SET cliente_nombre = NULL, cliente_telefono = NULL, updated_at = now()
   WHERE customer_id = ANY (v_fichas);

  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, t.customer_id, 'encuesta_cliente_respuestas', t.id::text, 'vaciada',
         jsonb_build_object('id', t.id, 'customer_id', t.customer_id, 'contacto_nombre', t.contacto_nombre,
                            'telefono', t.telefono, 'telefono_hash', t.telefono_hash)
    FROM public.encuesta_cliente_respuestas t WHERE t.customer_id = ANY (v_fichas);
  UPDATE public.encuesta_cliente_respuestas
     SET customer_id = NULL, contacto_nombre = NULL, telefono = NULL, telefono_hash = NULL
   WHERE customer_id = ANY (v_fichas);

  -- Reservas: la dirección de entrega es suya y no la exige ninguna ley. La
  -- receta se conserva si respaldó una dispensación (aprobada); la que nunca
  -- valió (vencida, cancelada o rechazada) se borra — la misma regla que
  -- «borrar mi cuenta» de la app.
  INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
  SELECT v_id, r.customer_id, 'app_reservas', r.id::text, 'vaciada',
         jsonb_build_object('id', r.id, 'direccion_entrega', r.direccion_entrega,
                            'receta_ruta', CASE WHEN r.receta_estado IS DISTINCT FROM 'aprobada'
                                                 AND (r.estado IN ('vencida', 'cancelada') OR r.receta_estado = 'rechazada')
                                                THEN r.receta_ruta END)
    FROM public.app_reservas r
   WHERE r.customer_id = ANY (v_fichas)
     AND (r.direccion_entrega IS NOT NULL OR r.receta_ruta IS NOT NULL);
  v_archivos := v_archivos || coalesce((
    SELECT array_agg(format('recetas/%s/%s/', r.branch_id, r.id))
      FROM public.app_reservas r
     WHERE r.customer_id = ANY (v_fichas) AND r.receta_ruta IS NOT NULL
       AND r.receta_estado IS DISTINCT FROM 'aprobada'
       AND (r.estado IN ('vencida', 'cancelada') OR r.receta_estado = 'rechazada')), '{}');
  UPDATE public.app_reservas r
     SET direccion_entrega = NULL,
         receta_ruta = CASE WHEN r.receta_estado IS DISTINCT FROM 'aprobada'
                             AND (r.estado IN ('vencida', 'cancelada') OR r.receta_estado = 'rechazada')
                            THEN NULL ELSE r.receta_ruta END
   WHERE r.customer_id = ANY (v_fichas)
     AND (r.direccion_entrega IS NOT NULL OR r.receta_ruta IS NOT NULL);

  -- ── 5 · Borrar sin resguardo (credenciales y telemetría) ────────────────
  DELETE FROM public.app_cliente_sesiones WHERE customer_id = ANY (v_fichas);
  DELETE FROM public.wallet_registros WHERE customer_id = ANY (v_fichas);
  DELETE FROM public.puntos_codigo_acceso WHERE customer_id = ANY (v_fichas);
  DELETE FROM public.app_cliente_referido_codigo WHERE customer_id = ANY (v_fichas);
  DELETE FROM public.app_historias_vistas WHERE customer_id = ANY (v_fichas);
  UPDATE public.app_errores SET customer_id = NULL WHERE customer_id = ANY (v_fichas);

  -- Las carpetas enteras del almacenamiento: las fotos del chat y del perfil
  -- se suben numeradas y sólo la última queda anotada en una fila.
  SELECT v_archivos || coalesce(array_agg(x), '{}') INTO v_archivos
    FROM (SELECT format('chat/%s/', f) x FROM unnest(v_fichas) f
          UNION ALL SELECT format('perfil/%s/', f) FROM unnest(v_fichas) f) y;

  -- ── 6 · Los puntos se pierden ────────────────────────────────────────────
  -- El mismo mecanismo que el vencimiento (`puntos_vencer_lotes`): una salida
  -- que consume los lotes, sin borrar historial. Tipo 'ajuste' con su motivo,
  -- para que el libro diga POR QUÉ salieron. Una cuenta fusionada en otra se
  -- salta: sus lotes ya viven en la principal, y el trigger
  -- `puntos_redirigir_libro` mandaría la salida allá.
  FOREACH v_f IN ARRAY v_fichas LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.puntos_cuenta WHERE customer_id = v_f AND fusionada_en IS NOT NULL);
    PERFORM 1 FROM public.puntos_lote WHERE customer_id = v_f AND restantes > 0 FOR UPDATE;
    SELECT coalesce(sum(restantes), 0)::integer INTO v_vencen FROM public.puntos_lote
     WHERE customer_id = v_f AND restantes > 0;
    CONTINUE WHEN v_vencen <= 0;
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, motivo)
    VALUES (v_f, 'ajuste', v_vencen,
            format('Datos anonimizados a pedido del titular (solicitud %s): los puntos se pierden', v_s.folio_txt))
    RETURNING id INTO v_salida;
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos)
    SELECT v_salida, l.id, l.restantes FROM public.puntos_lote l WHERE l.customer_id = v_f AND l.restantes > 0
    ON CONFLICT (salida_id, lote_id) DO UPDATE SET puntos = puntos_salida_lote.puntos + EXCLUDED.puntos;
    UPDATE public.puntos_lote SET restantes = 0 WHERE customer_id = v_f AND restantes > 0;
    UPDATE public.puntos_cuenta
       SET saldo = greatest(saldo - v_vencen, 0), usados = usados + v_vencen, updated_at = now()
     WHERE customer_id = v_f;
    v_puntos_total := v_puntos_total + v_vencen;
  END LOOP;

  -- ── 7 · La ficha ─────────────────────────────────────────────────────────
  -- Se resguarda la fila ENTERA (to_jsonb) y se vacía. `acepta_programa_puntos
  -- = false` es «salió del programa» (cl. 12.2): `ventas_elegibles_puntos` ya
  -- no le acumula. `acumula_puntos` NO se toca: lo leen otros procesos vivos
  -- (ver memoria «un flag de datos despierta a un cron vivo»).
  FOREACH v_f IN ARRAY v_fichas LOOP
    SELECT * INTO v_c FROM public.customers WHERE id = v_f;
    INSERT INTO public.clientes_resguardo (anonimizacion_id, customer_id, tabla, fila_id, accion, datos)
    VALUES (v_id, v_f, 'customers', v_f::text, 'vaciada', to_jsonb(v_c));
    v_anon_name := 'CLIENTE ANÓNIMO #' || v_f;
    UPDATE public.customers SET
        name = v_anon_name, dui = NULL, nit = NULL, nrc = NULL, pasaporte = NULL,
        phone = NULL, telefono2 = NULL, email = NULL, direccion = NULL,
        fecha_nacimiento = NULL, notes = NULL,
        acepta_promociones = false, acepta_programa_puntos = false,
        anonimizada_at = now(), updated_at = now()
     WHERE id = v_f;
    -- El trigger `customers_tipo_persona` recalcula por el nombre nuevo; el
    -- tipo de persona no identifica a nadie y se deja como estaba.
    UPDATE public.customers SET tipo_persona = v_c.tipo_persona, tipo_persona_revisar = v_c.tipo_persona_revisar
     WHERE id = v_f AND (tipo_persona, tipo_persona_revisar) IS DISTINCT FROM (v_c.tipo_persona, v_c.tipo_persona_revisar);

    -- ── 8 · La ficha de la caja: el mismo camino que una edición del portal.
    -- Renglones en `customers_changelog`; los empuja `push-cliente-erp` (cron
    -- `drain-cliente-erp-queue`, cada 10 min). Ese empuje lee la ficha entera,
    -- cambia sólo estos campos y reenvía los 21, así que lo demás no se pierde.
    -- `valor_anterior` va NULL a propósito: el valor viejo vive en el resguardo,
    -- no en una tabla que lee media plataforma.
    IF v_c.erp_id IS NOT NULL THEN
      WITH ins AS (
        INSERT INTO public.customers_changelog (customer_id, campo, valor_anterior, valor_nuevo, changed_by, changed_by_nombre)
        SELECT v_f, x.campo, NULL, x.valor, v_emp, 'Anonimización a pedido del titular'
          FROM (VALUES ('name', v_anon_name), ('dui', NULL), ('nit', NULL), ('nrc', NULL),
                       ('pasaporte', NULL), ('phone', NULL), ('telefono2', NULL),
                       ('email', NULL), ('direccion', NULL)) AS x(campo, valor)
        RETURNING id)
      SELECT array_agg(id) INTO v_nuevos FROM ins;
      v_changelog := v_changelog || coalesce(v_nuevos, '{}');
    END IF;
  END LOOP;

  v_resumen := (v_eval -> 'conteos') || jsonb_build_object(
    'fichas', to_jsonb(v_fichas),
    'en_caja', (SELECT count(*) FROM public.customers WHERE id = ANY (v_fichas) AND erp_id IS NOT NULL));
  UPDATE public.clientes_anonimizados
     SET puntos_perdidos = v_puntos_total, changelog_ids = v_changelog,
         archivos_pendientes = (SELECT coalesce(array_agg(DISTINCT a), '{}') FROM unnest(v_archivos) a WHERE a IS NOT NULL),
         resumen = v_resumen
   WHERE id = v_id;

  INSERT INTO public.audit_logs (action, target_id, user_id, user_name, source, severity, details)
  VALUES ('ANONIMIZAR_CLIENTE', p_customer::text, v_emp, coalesce(v_emp_nombre, 'Portal'), 'ADMIN_PANEL', 'WARNING',
          jsonb_build_object('folio', v_s.folio_txt, 'solicitud_id', p_solicitud, 'anonimizacion_id', v_id,
                             'fichas', v_fichas, 'puntos_perdidos', v_puntos_total,
                             'sin_documento', v_motivo IS NOT NULL));

  RETURN json_build_object(
    'anonimizacion_id', v_id, 'customer_id', p_customer, 'fichas', v_fichas,
    'puntos_perdidos', v_puntos_total, 'caja_renglones', cardinality(v_changelog),
    'archivos', (SELECT archivos_pendientes FROM public.clientes_anonimizados WHERE id = v_id));
END $$;
REVOKE EXECUTE ON FUNCTION public.datos_anonimizar_cliente(uuid, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.datos_anonimizar_cliente(uuid, bigint, text, text) TO authenticated, service_role;

-- ── Archivos: qué falta y marcar hecho ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.datos_anonimizacion_archivos(p_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['datos_personales'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT json_build_object('id', id, 'fichas', fichas, 'archivos', archivos_pendientes)
            FROM public.clientes_anonimizados WHERE id = p_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.datos_anonimizacion_archivos(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.datos_anonimizacion_archivos(bigint) TO authenticated, service_role;

-- La llama SÓLO la edge function, con la llave del servidor, después de borrar.
CREATE OR REPLACE FUNCTION public.datos_anonimizacion_archivos_hechos(p_id bigint, p_fallidos text[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE public.clientes_anonimizados
     SET archivos_pendientes = coalesce(p_fallidos, '{}'),
         archivos_borrados_at = CASE WHEN coalesce(cardinality(p_fallidos), 0) = 0 THEN now() END
   WHERE id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION public.datos_anonimizacion_archivos_hechos(bigint, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.datos_anonimizacion_archivos_hechos(bigint, text[]) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- Leer el resguardo. Tres llaves: el permiso del módulo, un motivo escrito y
-- la constancia. Cada lectura deja su fila en `clientes_resguardo_lecturas` y
-- en `audit_logs`, ANTES de devolver nada: si la constancia no se puede
-- escribir, no se lee.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.datos_resguardo_leer(p_anonimizacion bigint, p_motivo text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_emp_nombre text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_a public.clientes_anonimizados;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['datos_personales'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'Escribe el motivo de la consulta (al menos 10 caracteres): queda registrado.';
  END IF;
  SELECT * INTO v_a FROM public.clientes_anonimizados WHERE id = p_anonimizacion;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa anonimización'; END IF;
  SELECT name INTO v_emp_nombre FROM public.employees WHERE id = v_emp;

  INSERT INTO public.clientes_resguardo_lecturas (anonimizacion_id, customer_id, employee_id, employee_nombre, motivo)
  VALUES (v_a.id, v_a.customer_id, v_emp, v_emp_nombre, v_motivo);
  INSERT INTO public.audit_logs (action, target_id, user_id, user_name, source, severity, details)
  VALUES ('LEER_RESGUARDO_CLIENTE', v_a.customer_id::text, v_emp, coalesce(v_emp_nombre, 'Portal'), 'ADMIN_PANEL', 'WARNING',
          jsonb_build_object('anonimizacion_id', v_a.id, 'motivo', v_motivo));

  RETURN json_build_object(
    'anonimizacion_id', v_a.id, 'customer_id', v_a.customer_id,
    'anonimizada_at', v_a.anonimizada_at, 'reactivada_at', v_a.reactivada_at,
    'filas', coalesce((SELECT json_agg(json_build_object('tabla', r.tabla, 'fila_id', r.fila_id,
                                                          'accion', r.accion, 'datos', r.datos)
                                       ORDER BY r.tabla, r.id)
                         FROM public.clientes_resguardo r WHERE r.anonimizacion_id = v_a.id), '[]'::json),
    'lecturas', coalesce((SELECT json_agg(json_build_object('quien', l.employee_nombre, 'cuando', l.created_at,
                                                            'motivo', l.motivo) ORDER BY l.id)
                            FROM public.clientes_resguardo_lecturas l WHERE l.anonimizacion_id = v_a.id), '[]'::json));
END $$;
REVOKE EXECUTE ON FUNCTION public.datos_resguardo_leer(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.datos_resguardo_leer(bigint, text) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- ¿Este documento pidió anonimizar sus datos? Sí/no y nada más — ni nombre ni
-- ficha. La usan el buscador de Clientes, el de solicitudes y la app (con la
-- llave del servidor). Para quien tiene el módulo de datos personales devuelve
-- además qué anonimización es, que es lo que necesita para reactivarla.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.datos_documento_anonimizado(p_documento text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
  v_datos boolean;
  v_h record;
BEGIN
  v_datos := v_servidor OR (SELECT public.auth_can_edit_any(ARRAY['datos_personales']));
  IF NOT v_datos AND NOT (SELECT public.auth_has_module_permission('clientes', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF public.datos_doc_norm(p_documento) IS NULL OR length(public.datos_doc_norm(p_documento)) < 7 THEN
    RETURN json_build_object('anonimizado', false);
  END IF;
  SELECT h.anonimizacion_id, a.customer_id, a.anonimizada_at INTO v_h
    FROM public.clientes_anonimizados_huellas h
    JOIN public.clientes_anonimizados a ON a.id = h.anonimizacion_id AND a.reactivada_at IS NULL
   WHERE h.tipo = 'documento' AND h.huella = public.datos_huella('documento', p_documento);
  IF NOT FOUND THEN RETURN json_build_object('anonimizado', false); END IF;
  IF v_datos THEN
    RETURN json_build_object('anonimizado', true, 'anonimizacion_id', v_h.anonimizacion_id,
                             'customer_id', v_h.customer_id, 'anonimizada_at', v_h.anonimizada_at);
  END IF;
  RETURN json_build_object('anonimizado', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.datos_documento_anonimizado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.datos_documento_anonimizado(text) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- Si vuelve: reactiva SU MISMA ficha. Lo pide él con su documento, que se
-- compara contra la huella. Se restauran la ficha (y las fusionadas), los
-- consentimientos y las aceptaciones, y los campos que se habían vaciado
-- (reclamos, encuestas, dirección de reservas). Las facturas nunca se movieron:
-- siguen en el mismo id, así que el historial y el nivel vuelven solos.
--
-- NO vuelve: los puntos (decisión del usuario), ni lo que era de la app
-- (sesiones, chat, avisos, fotos, correos, tratamientos): eso se borró, y el
-- resguardo lo guarda como constancia, no para reponerlo. El historial de
-- cambios de la ficha tampoco: reponerlo pendiente lo volvería a mandar a la caja.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.datos_reactivar_cliente(p_documento text, p_motivo text, p_solicitud uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_emp_nombre text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_a public.clientes_anonimizados;
  v_r record;
  v_old public.customers;
  v_anon public.customers;
  v_changelog bigint[] := '{}';
  v_nuevos bigint[];
  v_conflicto text;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['datos_personales'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'Escribe cómo se comprobó que es la persona (al menos 10 caracteres).';
  END IF;
  SELECT a.* INTO v_a
    FROM public.clientes_anonimizados_huellas h
    JOIN public.clientes_anonimizados a ON a.id = h.anonimizacion_id AND a.reactivada_at IS NULL
   WHERE h.tipo = 'documento' AND h.huella = public.datos_huella('documento', p_documento)
   FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Con ese documento no hay datos anonimizados.';
  END IF;
  IF p_solicitud IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.solicitudes_datos WHERE id = p_solicitud) THEN
    RAISE EXCEPTION 'La solicitud indicada no existe';
  END IF;
  SELECT name INTO v_emp_nombre FROM public.employees WHERE id = v_emp;
  PERFORM 1 FROM public.customers WHERE id = ANY (v_a.fichas) FOR UPDATE;

  -- La ficha (y las fusionadas en ella), desde su fila resguardada.
  FOR v_r IN SELECT datos FROM public.clientes_resguardo
              WHERE anonimizacion_id = v_a.id AND tabla = 'customers' ORDER BY id
  LOOP
    v_old := jsonb_populate_record(NULL::public.customers, v_r.datos);
    SELECT * INTO v_anon FROM public.customers WHERE id = v_old.id;

    -- El nombre y el NIT son únicos. Si mientras estuvo anónima se abrió otra
    -- ficha con ellos, se dice cuál: unirlas es una decisión de una persona.
    SELECT format('la ficha #%s (%s)', c.id, CASE WHEN upper(btrim(c.name)) = upper(btrim(v_old.name)) THEN 'mismo nombre' ELSE 'mismo NIT' END)
      INTO v_conflicto
      FROM public.customers c
     WHERE c.id <> v_old.id
       AND (upper(btrim(c.name)) = upper(btrim(v_old.name)) OR (v_old.nit IS NOT NULL AND c.nit = v_old.nit))
     LIMIT 1;
    IF v_conflicto IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede reactivar todavía: después de anonimizarla se abrió %. Primero fusiónalas desde Clientes.', v_conflicto;
    END IF;

    UPDATE public.customers SET
        name = v_old.name, dui = v_old.dui, nit = v_old.nit, nrc = v_old.nrc, pasaporte = v_old.pasaporte,
        phone = v_old.phone, telefono2 = v_old.telefono2, email = v_old.email, direccion = v_old.direccion,
        fecha_nacimiento = v_old.fecha_nacimiento, notes = v_old.notes,
        acepta_promociones = v_old.acepta_promociones, acepta_programa_puntos = v_old.acepta_programa_puntos,
        anonimizada_at = NULL, updated_at = now()
     WHERE id = v_old.id;
    UPDATE public.customers SET tipo_persona = v_old.tipo_persona, tipo_persona_revisar = v_old.tipo_persona_revisar
     WHERE id = v_old.id;

    -- La caja: los mismos renglones que la anonimización, con los datos de vuelta.
    IF v_anon.erp_id IS NOT NULL THEN
      WITH ins AS (
        INSERT INTO public.customers_changelog (customer_id, campo, valor_anterior, valor_nuevo, changed_by, changed_by_nombre)
        SELECT v_old.id, x.campo, x.antes, x.valor, v_emp, 'Reactivación a pedido del titular'
          FROM (VALUES ('name', v_anon.name, v_old.name), ('dui', NULL, v_old.dui), ('nit', NULL, v_old.nit),
                       ('nrc', NULL, v_old.nrc), ('pasaporte', NULL, v_old.pasaporte), ('phone', NULL, v_old.phone),
                       ('telefono2', NULL, v_old.telefono2), ('email', NULL, v_old.email),
                       ('direccion', NULL, v_old.direccion)) AS x(campo, antes, valor)
         WHERE x.valor IS DISTINCT FROM x.antes
        RETURNING id)
      SELECT array_agg(id) INTO v_nuevos FROM ins;
      v_changelog := v_changelog || coalesce(v_nuevos, '{}');
    END IF;
  END LOOP;

  -- Consentimientos y aceptaciones: la evidencia de lo que dijo, de vuelta en
  -- su tabla. Las aceptaciones pierden el enlace a la sesión o el preregistro,
  -- que ya no existen.
  INSERT INTO public.consentimientos_cliente
  SELECT (jsonb_populate_record(NULL::public.consentimientos_cliente, r.datos)).*
    FROM public.clientes_resguardo r
   WHERE r.anonimizacion_id = v_a.id AND r.tabla = 'consentimientos_cliente'
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.app_cliente_aceptaciones
  SELECT (jsonb_populate_record(NULL::public.app_cliente_aceptaciones,
            r.datos || jsonb_build_object('preregistro_id', NULL, 'sesion_id', NULL))).*
    FROM public.clientes_resguardo r
   WHERE r.anonimizacion_id = v_a.id AND r.tabla = 'app_cliente_aceptaciones'
  ON CONFLICT (id) DO NOTHING;

  -- Lo vaciado vuelve a su fila (si la fila sigue existiendo).
  UPDATE public.reclamos_clientes t
     SET cliente_nombre = r.datos ->> 'cliente_nombre', cliente_telefono = r.datos ->> 'cliente_telefono', updated_at = now()
    FROM public.clientes_resguardo r
   WHERE r.anonimizacion_id = v_a.id AND r.tabla = 'reclamos_clientes' AND t.id::text = r.fila_id;
  UPDATE public.encuesta_cliente_respuestas t
     SET customer_id = (r.datos ->> 'customer_id')::bigint, contacto_nombre = r.datos ->> 'contacto_nombre',
         telefono = r.datos ->> 'telefono', telefono_hash = r.datos ->> 'telefono_hash'
    FROM public.clientes_resguardo r
   WHERE r.anonimizacion_id = v_a.id AND r.tabla = 'encuesta_cliente_respuestas' AND t.id::text = r.fila_id;
  -- La receta borrada no vuelve: el archivo ya no existe.
  UPDATE public.app_reservas t SET direccion_entrega = r.datos ->> 'direccion_entrega'
    FROM public.clientes_resguardo r
   WHERE r.anonimizacion_id = v_a.id AND r.tabla = 'app_reservas' AND t.id::text = r.fila_id
     AND r.datos ->> 'direccion_entrega' IS NOT NULL;

  -- Sin huellas: el buscador deja de decir «pidió anonimizarse» y una factura
  -- con su nombre vuelve a ligarse por el nombre, como cualquier otra.
  DELETE FROM public.clientes_anonimizados_huellas WHERE anonimizacion_id = v_a.id;

  UPDATE public.clientes_anonimizados
     SET reactivada_at = now(), reactivada_por = v_emp, reactivacion_motivo = v_motivo,
         reactivacion_solicitud = p_solicitud, reactivacion_changelog_ids = v_changelog
   WHERE id = v_a.id;

  INSERT INTO public.audit_logs (action, target_id, user_id, user_name, source, severity, details)
  VALUES ('REACTIVAR_CLIENTE', v_a.customer_id::text, v_emp, coalesce(v_emp_nombre, 'Portal'), 'ADMIN_PANEL', 'WARNING',
          jsonb_build_object('anonimizacion_id', v_a.id, 'motivo', v_motivo, 'solicitud_id', p_solicitud,
                             'puntos_no_vuelven', v_a.puntos_perdidos));

  RETURN json_build_object('customer_id', v_a.customer_id, 'anonimizacion_id', v_a.id,
                           'caja_renglones', cardinality(v_changelog), 'puntos_perdidos', v_a.puntos_perdidos);
END $$;
REVOKE EXECUTE ON FUNCTION public.datos_reactivar_cliente(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.datos_reactivar_cliente(text, text, uuid) TO authenticated, service_role;
