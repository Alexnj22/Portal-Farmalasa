-- El cierre interno de un CCF a quien no es contribuyente exige el RECHAZO de
-- Hacienda escrito, y se decide en una función que no escribe.
--
-- Origen: 0000000115_CCF de Salud 5 (2026-10-05), primera corrida real del
-- camino automático. El caso estaba bien cerrado, pero al revisarlo aparecieron
-- dos huecos en el camino:
--
-- 1. `marcar_solventado_internamente` nunca miraba QUÉ contestó Hacienda: sólo
--    «no tiene sello + es CCF + receptor no contribuyente». Si `regularizar-dte`
--    no contestaba a tiempo (corte de 120 s, red), el atajo se tomaba igual, y
--    un CCF que sí había entrado —con el sello llegando tarde— se anulaba en el
--    sistema y quedaba VIGENTE ante Hacienda. Ahora hace falta el intento
--    rechazado en `dte_mh_intentos`, con la observación de `receptor/nrc`: el
--    defecto que hace imposible que entre. Un rechazo por otra cosa se corrige,
--    no se cierra por acá.
--
-- 2. La Edge Function escribía el cierre ANTES de anular (la auditoría del caso
--    dice `estado: FINALIZADA`). Si la anulación fallaba, la factura quedaba
--    viva y fuera del barrido nocturno. Por eso la decisión se separa en
--    `solventado_interno_aplica`, que no escribe: la función decide, anula, y
--    sólo con la anulación hecha llama a `marcar_solventado_internamente`.
--
-- La regla sigue viviendo entera en la base: `marcar_…` llama a la que decide,
-- así que no hay dos copias de los frenos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.solventado_interno_aplica(
  p_invoice_id     bigint,
  p_rechazo_desde  timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_si         public.sales_invoices%ROWTYPE;
  v_categoria  text;
  v_nrc        text;
  v_int        public.dte_mh_intentos%ROWTYPE;
BEGIN
  SELECT * INTO v_si FROM public.sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'freno', 'FACTURA_NO_EXISTE',
      'error', 'La factura no existe.');
  END IF;

  -- Freno 1 — el que no se negocia. Un sello son 40 caracteres: `IS NOT NULL`
  -- da por bueno el 'undefined' que esta columna llegó a guardar. Y se mira
  -- también en los intentos: el espejo puede venir un minuto atrás.
  IF length(v_si.recibido_mh) = 40
     OR EXISTS (SELECT 1 FROM public.dte_mh_intentos i
                 WHERE i.invoice_id = p_invoice_id AND length(i.sello) = 40) THEN
    RETURN json_build_object('ok', false, 'freno', 'TIENE_SELLO',
      'error', 'Hacienda sí recibió este documento, hay que invalidarlo ante Hacienda.');
  END IF;

  -- Freno 2
  IF v_si.tipo_documento IS DISTINCT FROM 'CCF' THEN
    RETURN json_build_object('ok', false, 'freno', 'NO_ES_CCF',
      'error', 'Esta salida es sólo para el crédito fiscal emitido a quien no es contribuyente.');
  END IF;

  -- Freno 3 — las dos señales: si se contradicen, no se toma el atajo.
  SELECT c.categoria, c.nrc INTO v_categoria, v_nrc
    FROM public.customers c WHERE c.id = v_si.customer_id;
  IF v_categoria IN ('Contribuyente', 'Gran Contribuyente')
     OR (v_nrc IS NOT NULL AND btrim(v_nrc) <> '') THEN
    RETURN json_build_object('ok', false, 'freno', 'RECEPTOR_ES_CONTRIBUYENTE',
      'error', 'El crédito fiscal le corresponde a este cliente, no se cierra por acá.');
  END IF;

  -- Freno 5 — Hacienda CONTESTÓ, y lo que contestó es el defecto que no se
  -- arregla. Se mira el ÚLTIMO intento: si después del rechazo hubo otro, manda
  -- ése. `p_rechazo_desde` lo pasa quien acaba de pedir el envío, para que un
  -- rechazo viejo no cuente como respuesta de un envío que no terminó.
  SELECT * INTO v_int FROM public.dte_mh_intentos i
   WHERE i.invoice_id = p_invoice_id
     AND (p_rechazo_desde IS NULL OR i.created_at >= p_rechazo_desde)
   ORDER BY i.created_at DESC, i.id DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'freno', 'SIN_RESPUESTA_DE_HACIENDA',
      'error', 'No hay una respuesta de Hacienda escrita para este envío: no se sabe si entró, así que no se anula.');
  END IF;
  IF v_int.ok IS DISTINCT FROM false THEN
    RETURN json_build_object('ok', false, 'freno', 'NO_ES_RECHAZO',
      'error', 'El último envío a Hacienda no fue un rechazo.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(coalesce(v_int.observaciones, '{}'::text[])) o
                  WHERE o ILIKE '%receptor/nrc%') THEN
    RETURN json_build_object('ok', false, 'freno', 'RECHAZO_POR_OTRA_COSA',
      'error', 'Hacienda la rechazó por otro motivo, no por el NRC del receptor: '
               || coalesce(v_int.error, v_int.descripcion_msg, 'sin detalle')
               || '. Eso se corrige y se reenvía.');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'invoice_id', p_invoice_id,
    'intento_id', v_int.id,
    'categoria', v_categoria,
    'motivo',
      'Crédito fiscal emitido a un cliente que no es contribuyente. Hacienda lo '
      'rechazó y nunca lo recibió, así que no hay sello que invalidar: se anula '
      'sólo en el sistema y la venta se vuelve a facturar como Consumidor Final '
      '(COF).',
    'instruccion', 'Hay que volver a facturar esta venta como Consumidor Final (COF).');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.solventado_interno_aplica(bigint, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solventado_interno_aplica(bigint, timestamptz) TO authenticated, service_role;

-- Misma firma a propósito: cambiarla dejaría la vieja viva con sus permisos.
CREATE OR REPLACE FUNCTION public.marcar_solventado_internamente(p_invoice_id bigint, p_actor text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_si         public.sales_invoices%ROWTYPE;
  v_es_cron    boolean := (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role';
  v_actor      text;
  v_ya_estaba  boolean;
  v_decision   json;
  v_motivo     text;
BEGIN
  -- `service_role` es el proceso automático: ya es de confianza. Para cualquier
  -- otro, el permiso de Facturación de siempre.
  IF NOT v_es_cron
     AND NOT (SELECT public.auth_has_module_permission('facturacion','can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para editar Facturación';
  END IF;

  SELECT * INTO v_si FROM public.sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACTURA_NO_EXISTE'; END IF;

  -- Frenos 1, 2, 3 y 5 viven en la que decide: una sola copia.
  v_decision := public.solventado_interno_aplica(p_invoice_id);
  IF NOT coalesce((v_decision->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '%: %', v_decision->>'freno', v_decision->>'error';
  END IF;
  v_motivo := v_decision->>'motivo';

  -- Freno 4 — una persona sólo cierra lo que ya está anulado. El proceso
  -- automático llama recién DESPUÉS de anular en el sistema, cuando el espejo
  -- todavía puede decir FINALIZADA por un minuto.
  IF NOT v_es_cron AND v_si.estado IS DISTINCT FROM 'NULA' THEN
    RAISE EXCEPTION 'NO_ESTA_ANULADA: primero se anula la venta en el sistema.';
  END IF;

  v_actor := coalesce(
    nullif(btrim(coalesce(p_actor, '')), ''),
    (SELECT e.name FROM public.employees e WHERE e.id = (SELECT public.auth_employee_id())),
    'Sistema');

  -- 1 · Que el barrido nocturno no lo vuelva a intentar. Esto es además lo que
  --     lo saca de Observaciones y de `dte_rechazos_vigentes`: las dos ya
  --     descuentan esta tabla.
  INSERT INTO public.dte_excluidas_del_barrido (invoice_id, motivo, excluida_por)
  VALUES (p_invoice_id, v_motivo, v_actor)
  ON CONFLICT (invoice_id) DO NOTHING;
  v_ya_estaba := NOT FOUND;

  -- 2 · Y que salga de la cola de anuladas por resolver, con el motivo escrito
  --     donde lo lee quien recorre esa lista. Append-only: si ya tenía una
  --     resolución vieja, ésta se suma y es la que manda por ser la última.
  INSERT INTO public.sales_invoice_resolutions (invoice_id, comment, resolved_by)
  VALUES (p_invoice_id, 'Solventado internamente. ' || v_motivo, v_actor);

  INSERT INTO public.audit_logs
    (action, target_id, user_id, user_name, source, severity, branch_id, details)
  VALUES ('DTE_SOLVENTADO_INTERNAMENTE', p_invoice_id::text,
          (SELECT public.auth_employee_id()), v_actor,
          CASE WHEN v_es_cron THEN 'SYSTEM' ELSE 'ADMIN_PANEL' END,
          'WARNING', v_si.branch_id,
          json_build_object(
            'correlativo', v_si.correlativo,
            'erp_invoice_id', v_si.erp_invoice_id,
            'tipo_documento', v_si.tipo_documento,
            'fecha', v_si.fecha,
            'total', v_si.total,
            'cliente', v_si.cliente,
            'cliente_categoria', v_decision->>'categoria',
            'estado', v_si.estado,
            'intento_rechazado', v_decision->'intento_id',
            'motivo', v_motivo,
            'ya_estaba_excluida', v_ya_estaba));

  RETURN json_build_object(
    'ok', true,
    'invoice_id', p_invoice_id,
    'correlativo', v_si.correlativo,
    'ya_estaba_excluida', v_ya_estaba,
    'motivo', v_motivo,
    'instruccion', v_decision->>'instruccion');
END;
$function$;
