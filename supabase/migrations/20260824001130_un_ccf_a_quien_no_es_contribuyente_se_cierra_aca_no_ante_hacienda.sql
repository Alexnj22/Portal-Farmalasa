-- Un crédito fiscal a un cliente que no es contribuyente se cierra ACÁ, no ante
-- Hacienda.
--
-- ── El caso ───────────────────────────────────────────────────────────────
-- Una sala factura un CCF a alguien que no está inscrito en IVA. Hacienda lo
-- rechaza —el CCF es el documento ENTRE contribuyentes— y lo rechaza siempre,
-- porque el problema no es un dato de la ficha sino el tipo de documento. El
-- circuito nocturno no lo puede arreglar: `sincronizar-fichas-clientes` corrige
-- distrito, municipio, departamento, DUI y teléfono, y ninguno de esos cinco es
-- el que está mal.
--
-- Lo que quedaba era un documento rebotando todas las noches y una solicitud de
-- anulación que no se podía aprobar: el paso ante Hacienda lanzaba, la
-- excepción se llevaba por delante el APPROVED, y cada reintento reventaba en
-- el mismo punto.
--
-- ── Por qué no se invalida ante Hacienda ──────────────────────────────────
-- Porque Hacienda NUNCA LO RECIBIÓ. Un DTE existe cuando tiene sello de
-- recepción; sin sello no hay documento tributario emitido, hay un intento de
-- transmisión fallido. La invalidación aplica a un DTE CON sello — no hay a qué
-- apuntar. El sistema de origen lo dice sin rodeos: "Esta factura no ha sido
-- validada por MH no se puede validar la anulacion".
--
-- Y la salida NO es ponerle un cliente contribuyente para que entre y después
-- invalidarlo: eso documenta la operación con una parte que no compró, le
-- genera crédito fiscal a un tercero sin su consentimiento y consigue un sello
-- para un hecho que no ocurrió. Cambia un error formal por uno de fondo.
--
-- La salida correcta es la que decidió el usuario el 2026-08-23: anular sólo en
-- el sistema, dejar constancia de por qué no se tramitó, y volver a facturar la
-- venta como Consumidor Final (COF), que es el documento que correspondía.
--
-- ── Por qué es una función y no un INSERT desde la pantalla ───────────────
-- `dte_excluidas_del_barrido` nació SIN policy de INSERT a propósito
-- (20260807024258): «que una factura deje de intentarse es una decisión, no
-- algo que se haga desde la pantalla sin dejar rastro». Esto no afloja esa
-- regla — la cumple: la decisión sigue sin poder escribirse a mano, y la única
-- puerta valida el caso, escribe quién y por qué, y deja el rastro en la
-- bitácora. La tabla sigue sin policy de INSERT.
--
-- ── Los cuatro frenos ─────────────────────────────────────────────────────
-- Esta función saca un documento del circuito fiscal, así que se niega salvo
-- que el caso sea EXACTAMENTE el decidido:
--
--  1. Sin sello válido. Si Hacienda lo selló, SÍ hay algo que invalidar y esto
--     sería enterrar un documento vivo. Es el freno que no se negocia.
--  2. Es un CCF. La regla del usuario es sobre el crédito fiscal; un COF
--     rechazado es otro problema y merece otra decisión.
--  3. El receptor NO es contribuyente. Se exige que las DOS señales coincidan
--     —la categoría de la ficha y la ausencia de NRC—. Si se contradicen, no se
--     toma el atajo: un desacuerdo entre los dos campos es justo cuando no se
--     quiere una decisión automática. Medido hoy: 0 fichas «Consumidor» con
--     NRC, y 3 contribuyentes sin NRC (que por la categoría quedan fuera, que
--     es lo correcto).
--  4. Ya está anulada en el sistema. Marcar «solventado» una venta VIVA la
--     sacaría de la cola de Hacienda sin haberla anulado: quedaría una venta
--     vigente que nunca se transmite y que nadie vuelve a mirar. `service_role`
--     queda exento de este freno y sólo de éste, porque es quien ACABA de
--     anularla y el espejo del portal lo escribe el sync un minuto después.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.marcar_solventado_internamente(
  p_invoice_id bigint,
  p_actor      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_si         public.sales_invoices%ROWTYPE;
  v_categoria  text;
  v_nrc        text;
  v_es_cron    boolean := (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role';
  v_actor      text;
  v_ya_estaba  boolean;
  v_motivo     constant text :=
    'Crédito fiscal emitido a un cliente que no es contribuyente. Hacienda lo '
    'rechazó y nunca lo recibió, así que no hay sello que invalidar: se anula '
    'sólo en el sistema y la venta se vuelve a facturar como Consumidor Final '
    '(COF).';
BEGIN
  -- `service_role` es el proceso automático: ya es de confianza. Para cualquier
  -- otro, el permiso de Facturación de siempre.
  IF NOT v_es_cron
     AND NOT (SELECT public.auth_has_module_permission('facturacion','can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para editar Facturación';
  END IF;

  SELECT * INTO v_si FROM public.sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACTURA_NO_EXISTE'; END IF;

  -- Freno 1 — el que no se negocia. Un sello son 40 caracteres: `IS NOT NULL`
  -- da por bueno el 'undefined' que esta columna llegó a guardar.
  IF length(v_si.recibido_mh) = 40 THEN
    RAISE EXCEPTION 'TIENE_SELLO: Hacienda sí recibió este documento, hay que invalidarlo ante Hacienda.';
  END IF;

  -- Freno 2
  IF v_si.tipo_documento IS DISTINCT FROM 'CCF' THEN
    RAISE EXCEPTION 'NO_ES_CCF: esta salida es sólo para el crédito fiscal emitido a quien no es contribuyente.';
  END IF;

  -- Freno 3
  SELECT c.categoria, c.nrc INTO v_categoria, v_nrc
    FROM public.customers c WHERE c.id = v_si.customer_id;
  IF v_categoria IN ('Contribuyente', 'Gran Contribuyente')
     OR (v_nrc IS NOT NULL AND btrim(v_nrc) <> '') THEN
    RAISE EXCEPTION 'RECEPTOR_ES_CONTRIBUYENTE: el crédito fiscal le corresponde, no se cierra por acá.';
  END IF;

  -- Freno 4
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
            'cliente_categoria', v_categoria,
            'estado', v_si.estado,
            'motivo', v_motivo,
            'ya_estaba_excluida', v_ya_estaba));

  RETURN json_build_object(
    'ok', true,
    'invoice_id', p_invoice_id,
    'correlativo', v_si.correlativo,
    'ya_estaba_excluida', v_ya_estaba,
    'motivo', v_motivo,
    'instruccion', 'Hay que volver a facturar esta venta como Consumidor Final (COF).');
END;
$function$;

COMMENT ON FUNCTION public.marcar_solventado_internamente(bigint, text) IS
  'Cierra un CCF emitido a un no contribuyente que Hacienda nunca recibio: lo saca del barrido y de la cola, con motivo y rastro. Se niega si tiene sello.';

REVOKE EXECUTE ON FUNCTION public.marcar_solventado_internamente(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marcar_solventado_internamente(bigint, text) TO authenticated, service_role;
