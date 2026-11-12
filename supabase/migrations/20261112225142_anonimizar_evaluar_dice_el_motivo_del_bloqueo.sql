-- La evaluación de anonimizar decía el motivo del bloqueo con un error técnico.
-- `v_bloqueos text[] || 'literal'`: el literal sin tipo se lee como ARRAY, y
-- los 8 bloqueos escritos como texto fijo tiraban «malformed array literal»
-- en lugar de devolver el motivo. Con un candidato bloqueado, `datos_anonimizacion`
-- (que evalúa todos) fallaba entera y la pantalla no mostraba ninguno.
-- Encontrado probando en el entorno de pruebas el 2026-11-12; en producción
-- nunca se había usado (0 anonimizaciones). Sólo se agrega `::text` a cada literal;
-- el cuerpo es la definición viva de producción.
SET lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.datos_anonimizacion_evaluar(p_solicitud uuid, p_customer bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    v_bloqueos := v_bloqueos || 'Sólo se anonimiza desde una solicitud RESUELTA a favor (no negada).'::text;
  END IF;
  IF NOT ('cancelacion' = ANY (coalesce(v_s.derechos, '{}'))) THEN
    v_bloqueos := v_bloqueos || 'La solicitud no pide cancelación.'::text;
  END IF;

  SELECT * INTO v_c FROM public.customers WHERE id = p_customer;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('puede', false, 'bloqueos', to_jsonb(v_bloqueos || 'La ficha no existe.'::text));
  END IF;

  IF v_c.anonimizada_at IS NOT NULL THEN
    v_bloqueos := v_bloqueos || 'Esta ficha ya está anonimizada.'::text;
  END IF;
  IF v_c.deshabilitada_at IS NOT NULL THEN
    v_bloqueos := v_bloqueos || format('Es una ficha fusionada en la #%s: se anonimiza la principal.', v_c.fusionada_en_id);
  END IF;
  IF public.es_cliente_mostrador(v_c.name, v_c.erp_id) THEN
    v_bloqueos := v_bloqueos || 'Es la ficha genérica de mostrador: no es de una persona.'::text;
  END IF;
  IF v_c.tipo_persona = 'juridica' THEN
    v_bloqueos := v_bloqueos || 'Es una persona jurídica: el derecho de cancelación es de las personas naturales.'::text;
  END IF;

  -- ¿Es la ficha de QUIEN pidió? El documento cotejado (y el escrito en la
  -- hoja) contra el DUI, el NIT y el pasaporte de la ficha. Nunca sobre una
  -- ficha cualquiera: con documentos que no coinciden, no se anonimiza.
  SELECT coalesce(array_agg(DISTINCT d) FILTER (WHERE d IS NOT NULL), '{}') INTO v_docs_sol
    FROM unnest(ARRAY[public.datos_doc_norm(v_s.identidad_numero), public.datos_doc_norm(v_s.solicitante_numero)]) d;
  SELECT coalesce(array_agg(DISTINCT d) FILTER (WHERE d IS NOT NULL), '{}') INTO v_docs_ficha
    FROM unnest(ARRAY[public.datos_doc_norm(v_c.dui), public.datos_doc_norm(v_c.nit), public.datos_doc_norm(v_c.pasaporte)]) d;
  IF cardinality(v_docs_sol) = 0 THEN
    v_bloqueos := v_bloqueos || 'La solicitud no tiene el número del documento cotejado.'::text;
  ELSIF cardinality(v_docs_ficha) = 0 THEN
    v_sin_doc := true;   -- se permite, con un motivo escrito
  ELSIF NOT (v_docs_ficha && v_docs_sol) THEN
    v_bloqueos := v_bloqueos || 'El documento de la ficha no coincide con el cotejado en la solicitud.'::text;
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
    v_bloqueos := v_bloqueos || 'Tiene saldo a favor sin usar: hay que usarlo o devolverlo primero.'::text;
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
END $function$;
