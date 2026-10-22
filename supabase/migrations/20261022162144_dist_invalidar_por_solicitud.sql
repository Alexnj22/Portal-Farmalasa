SET lock_timeout = '5s';

-- Distribución · H3 · invalidar ante Hacienda pasa por una solicitud.
--
-- Hasta hoy cualquiera con el permiso de vender en Distribución —el vendedor
-- de ruta— podía invalidar ante Hacienda cualquier venta sellada, de
-- cualquier vendedor: cobrar en efectivo, facturar, y esa noche deshacer el
-- documento. Decisión del dueño (2026-10-22): «se manda solicitud como en el
-- portal». O sea el mismo circuito que las solicitudes de facturación de las
-- farmacias y que el descuento de Distribución (DIST_DESCUENTO):
--
--   · el vendedor PIDE (`dist_pedir_invalidacion`): queda una solicitud
--     DIST_INVALIDACION en `approval_requests`, y avisa a quien puede decidir;
--   · decide quien tiene `requests_distribucion` con can_approve, nunca quien
--     la pidió. Rechazar es `dist_rechazar_invalidacion` (con motivo). Aprobar
--     lo hace la edge function `distribucion-dte` (acción
--     `resolver_invalidacion`), porque firmar el evento necesita el
--     certificado; al terminar llama `dist_cerrar_invalidacion`.
--   · Mientras se aplica, la solicitud lleva el arriendo de
--     `reclamar_solicitud` (3 min), igual que `aplicar-solicitud-facturacion`.
--
-- Hacienda recibe como responsable a quien APRUEBA (su nombre y DUI): es quien
-- decidió.

-- ── El tipo nuevo ───────────────────────────────────────────────────────────
-- NOT VALID + VALIDATE: el ADD no recorre la tabla con el candado fuerte.
ALTER TABLE public.approval_requests DROP CONSTRAINT IF EXISTS approval_requests_type_check;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_type_check
  CHECK (type = ANY (ARRAY['PERMISSION','VACATION','SICK_LEAVE','SCHEDULE_CHANGE','SHIFT_CHANGE',
    'OTHER','PERMIT','DISABILITY','OVERTIME','ADVANCE','CERTIFICATE','ANNULMENT_REQUEST',
    'PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST',
    'INVENTORY_TRANSFER_REQUEST','INVENTORY_TRANSFER_PUSH','INVENTORY_DISCARD_REQUEST',
    'INVENTORY_LOAD_REQUEST','MINMAX_CHANGE_REQUEST','CAJA_MOVIMIENTO_CHANGE',
    'ABONO_CREDITO_CHANGE','ABONO_APROBACION','DIST_DESCUENTO',
    'CAJA_INGRESO_AUTORIZACION','DIST_INVALIDACION']::text[])) NOT VALID;
ALTER TABLE public.approval_requests VALIDATE CONSTRAINT approval_requests_type_check;

-- Una sola solicitud abierta por documento.
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_una_invalidacion_por_documento
  ON public.approval_requests ((metadata ->> 'dte_id'))
  WHERE status = 'PENDING' AND type = 'DIST_INVALIDACION';

-- Definiciones vivas + DIST_INVALIDACION.
CREATE OR REPLACE FUNCTION public.modulo_de_aprobacion(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN p_type = ANY (ARRAY['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                             'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
      THEN 'requests_facturacion'
    WHEN p_type = ANY (ARRAY['INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST'])
      THEN 'requests_inventario'
    WHEN p_type = ANY (ARRAY['CAJA_MOVIMIENTO_CHANGE', 'CAJA_INGRESO_AUTORIZACION'])
      THEN 'requests_caja'
    WHEN p_type = ANY (ARRAY['ABONO_CREDITO_CHANGE', 'ABONO_APROBACION'])
      THEN 'requests_cuentas_por_cobrar'
    WHEN p_type = ANY (ARRAY['DIST_DESCUENTO', 'DIST_INVALIDACION'])
      THEN 'requests_distribucion'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.es_solicitud_operativa(p_type text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_type = ANY (ARRAY[
    'ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
    'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST',
    'INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST',
    'INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH',
    'CAJA_MOVIMIENTO_CHANGE', 'CAJA_INGRESO_AUTORIZACION',
    'ABONO_CREDITO_CHANGE', 'ABONO_APROBACION',
    'DIST_DESCUENTO', 'DIST_INVALIDACION'
  ]);
$function$;

-- ── Avisar (la misma forma que dist_pedir_descuento) ───────────────────────
CREATE OR REPLACE FUNCTION public.dist_avisar(p_dest uuid[], p_titulo text, p_cuerpo text, p_link text,
                                              p_tipo text, p_metadata jsonb, p_por uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF p_dest IS NULL OR array_length(p_dest, 1) IS NULL THEN RETURN; END IF;
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, created_by)
    SELECT d, p_tipo, p_titulo, p_cuerpo, p_link, p_metadata, p_por FROM unnest(p_dest) d;
    -- El push es un aviso: si falla, lo escrito ya quedó.
    BEGIN
        PERFORM net.http_post(
            url := public.push_function_url(), headers := public.push_function_headers(),
            body := jsonb_build_object('title', p_titulo, 'message', p_cuerpo, 'url', p_link,
                                       'target_type', 'EMPLOYEE', 'target_value', to_jsonb(p_dest)));
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'dist: push no enviado: %', SQLERRM;
    END;
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_avisar(uuid[], text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_avisar(uuid[], text, text, text, text, jsonb, uuid) TO service_role;

-- ── Pedir ───────────────────────────────────────────────────────────────────
-- p_accion: 'anular' (se deshizo la venta, CAT-024 tipo 2) o 'corregir' (se
-- emite un documento que lo reemplaza, tipo 1).
CREATE OR REPLACE FUNCTION public.dist_pedir_invalidacion(p_dte bigint, p_accion text, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo      uuid := public.auth_employee_id();
    d         public.dist_dte%ROWTYPE;
    v_plazo   json;
    v_cliente text;
    v_vend    uuid;
    v_quien   text;
    v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
    v_x       public.dist_cxc%ROWTYPE;
    v_efe     numeric := 0;
    v_favor   numeric := 0;
    v_id      uuid;
    v_dest    uuid[];
    v_titulo  text;
    v_cuerpo  text;
    v_link    text;
BEGIN
    IF v_yo IS NULL OR NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes vender en Distribución';
    END IF;
    IF p_accion NOT IN ('anular', 'corregir') THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: acción desconocida';
    END IF;
    IF v_motivo IS NULL THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: escribe por qué hay que %', CASE p_accion WHEN 'anular' THEN 'deshacer la venta' ELSE 'corregir el documento' END;
    END IF;
    SELECT * INTO d FROM public.dist_dte WHERE id = p_dte FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_INVALIDACION: no existe ese documento'; END IF;
    IF d.estado <> 'sellado' OR d.tipo NOT IN ('01', '03') OR d.pedido_id IS NULL THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: sólo se invalida una venta sellada por Hacienda';
    END IF;
    IF d.invalidacion_estado IN ('pendiente', 'procesada') THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: este documento ya se está invalidando';
    END IF;
    IF EXISTS (SELECT 1 FROM public.dist_pedidos WHERE reemplaza_dte_id = p_dte AND estado <> 'anulado') THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: ya hay una corrección abierta para este documento';
    END IF;
    IF EXISTS (SELECT 1 FROM public.approval_requests
                WHERE type = 'DIST_INVALIDACION' AND status = 'PENDING' AND metadata->>'dte_id' = p_dte::text) THEN
        RAISE EXCEPTION 'DIST_INVALIDACION_PEDIDA: ya hay una solicitud esperando decisión para este documento';
    END IF;
    -- Una nota de crédito ya devolvió parte (a la deuda o a favor del
    -- cliente): invalidar el original encima devolvería lo mismo dos veces.
    -- Hacienda tampoco lo acepta: primero se invalida la nota.
    IF EXISTS (SELECT 1 FROM public.dist_devoluciones dv JOIN public.dist_dte n ON n.id = dv.nota_id
                WHERE dv.dte_origen_id = p_dte AND dv.estado = 'emitida'
                  AND n.estado NOT IN ('descartado', 'rechazado', 'invalidado')) THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: este documento tiene una nota de crédito: primero hay que invalidar la nota';
    END IF;
    v_plazo := public.dist_plazo_invalidacion_de(p_dte);
    IF v_plazo->>'estado' = 'vencido' THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: venció el plazo para invalidar este documento (%)', v_plazo->>'limite';
    END IF;

    SELECT c.nombre, p.vendedor_id INTO v_cliente, v_vend
      FROM public.dist_pedidos p JOIN public.dist_clientes c ON c.id = p.cliente_id WHERE p.id = d.pedido_id;

    -- Qué pasaría con el dinero, para que quien decide lo vea antes.
    IF p_accion = 'anular' THEN
        -- Lo cobrado al vender sale del documento (resumen.pagos), igual que
        -- en dist_reintegrar_documento.
        SELECT coalesce(sum((x->>'montoPago')::numeric) FILTER (WHERE x->>'codigo' = '01'), 0),
               coalesce(sum((x->>'montoPago')::numeric) FILTER (WHERE x->>'codigo' NOT IN ('01', '13')), 0)
          INTO v_efe, v_favor FROM jsonb_array_elements(coalesce(d.json->'resumen'->'pagos', '[]'::jsonb)) x;
        SELECT v_efe + coalesce(sum(ab.monto) FILTER (WHERE r.forma = '01'), 0),
               v_favor + coalesce(sum(ab.monto) FILTER (WHERE r.forma <> '01'), 0)
          INTO v_efe, v_favor
          FROM public.dist_cxc x JOIN public.dist_cxc_abonos ab ON ab.cxc_id = x.id
          JOIN public.dist_recibos r ON r.id = ab.recibo_id AND r.anulado_at IS NULL
         WHERE x.dte_id = p_dte;
    END IF;
    SELECT * INTO v_x FROM public.dist_cxc WHERE dte_id = p_dte;

    -- Sin `approver_id` al insertar, igual que DIST_DESCUENTO: el aviso lo
    -- manda esta función, no `notificar_solicitud_creada`.
    INSERT INTO public.approval_requests (employee_id, type, status, note, metadata)
    VALUES (v_yo, 'DIST_INVALIDACION', 'PENDING', v_motivo,
            jsonb_build_object('dte_id', p_dte, 'accion', p_accion, 'tipo_invalidacion', CASE p_accion WHEN 'anular' THEN 2 ELSE 1 END,
                               'pedido_id', d.pedido_id, 'vendedor_id', v_vend, 'cliente', v_cliente,
                               'tipo_documento', d.tipo, 'numero_control', d.numero_control, 'fec_emi', d.fec_emi,
                               'total', d.total_pagar, 'abonado', coalesce(v_x.abonado, 0),
                               'devolver_efectivo', round(v_efe, 2), 'a_favor', round(v_favor, 2),
                               'plazo', v_plazo))
    RETURNING id INTO v_id;

    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.id <> v_yo
       AND public.puede_aprobar_modulo(e.id, 'requests_distribucion');
    IF array_length(v_dest, 1) = 1 THEN
        UPDATE public.approval_requests SET approver_id = v_dest[1] WHERE id = v_id;
    END IF;
    SELECT name INTO v_quien FROM public.employees WHERE id = v_yo;
    v_titulo := CASE p_accion WHEN 'anular' THEN 'Deshacer una venta' ELSE 'Corregir un documento' END;
    v_cuerpo := coalesce(v_quien, 'Un vendedor') || CASE p_accion WHEN 'anular' THEN ' pide deshacer ' ELSE ' pide corregir ' END
             || CASE d.tipo WHEN '03' THEN 'el Crédito Fiscal ' ELSE 'la Factura ' END || d.numero_control
             || ' de ' || coalesce(v_cliente, 'un cliente') || ' ($' || to_char(d.total_pagar, 'FM999,999,990.00') || ')'
             || ' — ' || left(v_motivo, 140);
    v_link := '/torogoz/solicitudes?solicitud=' || v_id;
    PERFORM public.dist_avisar(v_dest, v_titulo, v_cuerpo, v_link, 'REQUEST_PENDING',
        jsonb_build_object('request_id', v_id, 'request_type', 'DIST_INVALIDACION'), v_yo);

    RETURN json_build_object('solicitud_id', v_id, 'aprobadores', coalesce(array_length(v_dest, 1), 0));
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_pedir_invalidacion(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_pedir_invalidacion(bigint, text, text) TO authenticated, service_role;

-- ── Rechazar ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_rechazar_invalidacion(p_solicitud uuid, p_nota text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo   uuid := public.auth_employee_id();
    s      public.approval_requests%ROWTYPE;
    v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
    v_cuerpo text;
BEGIN
    IF v_yo IS NULL OR NOT public.puede_aprobar_modulo(v_yo, 'requests_distribucion') THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes decidir solicitudes de Distribución';
    END IF;
    SELECT * INTO s FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
    IF NOT FOUND OR s.type <> 'DIST_INVALIDACION' THEN RAISE EXCEPTION 'DIST_INVALIDACION: no existe esa solicitud'; END IF;
    IF s.status <> 'PENDING' THEN RAISE EXCEPTION 'DIST_SOLICITUD_RESUELTA: esa solicitud ya está resuelta'; END IF;
    IF s.employee_id = v_yo THEN RAISE EXCEPTION 'DIST_AUTOAPROBAR: no puedes decidir una solicitud que pediste tú'; END IF;
    IF v_nota IS NULL THEN RAISE EXCEPTION 'Una solicitud se rechaza con motivo: escribe por qué.'; END IF;
    IF s.metadata->>'aplicando_desde' IS NOT NULL
       AND (s.metadata->>'aplicando_desde')::timestamptz > now() - interval '180 seconds' THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: esta solicitud se está aplicando en este momento';
    END IF;
    UPDATE public.approval_requests
       SET status = 'REJECTED', approver_id = v_yo, approver_note = v_nota, updated_at = now()
     WHERE id = p_solicitud;
    v_cuerpo := 'El documento ' || coalesce(s.metadata->>'numero_control', '') || ' de '
             || coalesce(s.metadata->>'cliente', 'un cliente') || ' queda como estaba. ' || v_nota;
    PERFORM public.dist_avisar(ARRAY[s.employee_id], 'Solicitud rechazada', v_cuerpo,
        '/torogoz/solicitudes?solicitud=' || p_solicitud, 'REQUEST_DECIDED',
        jsonb_build_object('request_id', p_solicitud, 'request_type', 'DIST_INVALIDACION'), v_yo);
    RETURN json_build_object('solicitud_id', p_solicitud, 'estado', 'REJECTED');
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_rechazar_invalidacion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_rechazar_invalidacion(uuid, text) TO authenticated, service_role;

-- ── Cerrar una aprobada (la llama distribucion-dte con la llave de servicio) ─
CREATE OR REPLACE FUNCTION public.dist_cerrar_invalidacion(p_solicitud uuid, p_aprobador uuid, p_nota text, p_aplicado jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    s        public.approval_requests%ROWTYPE;
    v_cuerpo text;
    v_link   text;
BEGIN
    SELECT * INTO s FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
    IF NOT FOUND OR s.type <> 'DIST_INVALIDACION' OR s.status <> 'PENDING' THEN RETURN; END IF;
    UPDATE public.approval_requests
       SET status = 'APPROVED', approver_id = p_aprobador,
           approver_note = nullif(btrim(coalesce(p_nota, '')), ''),
           metadata = (metadata - 'aplicando_desde') || jsonb_build_object('aplicado', p_aplicado),
           updated_at = now()
     WHERE id = p_solicitud;
    IF s.metadata->>'accion' = 'corregir' THEN
        v_cuerpo := 'Ya puedes corregir el documento ' || coalesce(s.metadata->>'numero_control', '')
                 || ': se abrió una venta nueva con lo mismo. Al facturarla, la anterior se invalida ante Hacienda.';
        v_link := '/torogoz/venta/' || coalesce(p_aplicado->>'pedido_id', s.metadata->>'pedido_id');
    ELSE
        v_cuerpo := 'Se deshizo la venta ' || coalesce(s.metadata->>'numero_control', '') || ' de '
                 || coalesce(s.metadata->>'cliente', 'un cliente') || '.';
        v_link := '/torogoz/solicitudes?solicitud=' || p_solicitud;
    END IF;
    PERFORM public.dist_avisar(ARRAY[s.employee_id], 'Solicitud aprobada', v_cuerpo, v_link, 'REQUEST_DECIDED',
        jsonb_build_object('request_id', p_solicitud, 'request_type', 'DIST_INVALIDACION'), p_aprobador);
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_cerrar_invalidacion(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_cerrar_invalidacion(uuid, uuid, text, jsonb) TO service_role;
