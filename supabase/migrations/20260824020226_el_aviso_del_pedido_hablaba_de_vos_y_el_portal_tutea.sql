-- El portal TUTEA. El aviso decia «Escribi».
--
-- `gate:design` vigila el trato en el fuente del frontend (categoria
-- `copy-trato`, DESIGN.md §26.7) y por eso cazo el «Intenta» del widget. Pero no
-- lee SQL, y este aviso lo redacta una funcion de Postgres: el mismo defecto, en
-- el unico lugar donde el gate no puede verlo.
--
-- Vale la pena anotarlo: **un gate protege el texto que puede leer**. Todo copy
-- que viva dentro de una funcion de la base queda fuera de su alcance y hay que
-- revisarlo a mano — es la misma clase de hueco que el de los rotulos que viven
-- en `supabase/` (CLAUDE.md, «un rotulo no es una clave»).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.pedir_dato_a_la_sala(
  p_customer_id bigint,
  p_campo       text DEFAULT 'email',
  p_motivo_mh   text DEFAULT NULL,
  p_valor_actual text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cliente  text;
  v_invoice  bigint;
  v_branch   bigint;
  v_sala     text;
  v_corr     text;
  v_id       uuid;
  v_avisados integer := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_has_module_permission('facturacion','can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para pedir datos de facturacion';
  END IF;

  SELECT c.name INTO v_cliente FROM public.customers c WHERE c.id = p_customer_id;
  IF v_cliente IS NULL THEN RAISE EXCEPTION 'CLIENTE_NO_EXISTE'; END IF;

  -- La sucursal donde se EMITIO el documento — no una «sucursal del cliente»,
  -- que no existe: un cliente compra en varias salas y la que puede averiguar
  -- el correo es la que lo tuvo enfrente.
  SELECT si.id, si.branch_id, si.correlativo INTO v_invoice, v_branch, v_corr
    FROM public.sales_invoices si
   WHERE si.customer_id = p_customer_id
     AND length(si.recibido_mh) IS DISTINCT FROM 40
     AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
   ORDER BY si.fecha DESC, si.hora DESC
   LIMIT 1;

  IF v_invoice IS NULL THEN
    RETURN json_build_object('ok', false, 'avisados', 0,
                             'motivo', 'sin documento pendiente que ubique la sala');
  END IF;
  SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_branch;

  -- Un solo pedido vivo. Si ya hay uno, no se duplica ni se vuelve a avisar:
  -- la corrida detecta el mismo caso cada noche, y un aviso por persona por
  -- noche sobre lo mismo es como se ensena a no mirar la campana.
  SELECT p.id INTO v_id FROM public.dte_datos_pedidos p
   WHERE p.customer_id = p_customer_id AND p.campo = p_campo AND p.estado = 'PENDIENTE';
  IF v_id IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'pedido_id', v_id, 'avisados', 0,
                             'motivo', 'ya habia un pedido abierto');
  END IF;

  INSERT INTO public.dte_datos_pedidos
      (invoice_id, customer_id, branch_id, campo, motivo_mh, valor_actual, correlativo)
  VALUES (v_invoice, p_customer_id, v_branch, p_campo, p_motivo_mh, p_valor_actual, v_corr)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
  SELECT e.id, 'DTE_DATO_PEDIDO',
         'Falta el correo de un cliente',
         'La venta ' || coalesce(nullif(btrim(v_corr), ''), 'de ' || v_sala) ||
         ' no se puede completar: el correo de «' || v_cliente || '» no es valido. ' ||
         'Escribe el correo correcto desde Inicio y el portal termina el resto.',
         '/',
         jsonb_build_object('pedido_id', v_id, 'customer_id', p_customer_id,
                            'cliente', v_cliente, 'correlativo', v_corr,
                            'sala', v_sala, 'motivo_mh', p_motivo_mh),
         v_branch
    FROM public.employees e
   WHERE e.branch_id = v_branch AND e.status = 'ACTIVO';

  GET DIAGNOSTICS v_avisados = ROW_COUNT;

  -- Cero destinatarios NO es un exito: el pedido no le llego a nadie y el
  -- documento se queda trabado sin que nadie lo sepa.
  IF v_avisados = 0 THEN
    RETURN json_build_object('ok', false, 'pedido_id', v_id, 'avisados', 0,
                             'sala', v_sala, 'motivo', 'la sala no tiene a nadie activo');
  END IF;

  RETURN json_build_object('ok', true, 'pedido_id', v_id, 'avisados', v_avisados,
                           'sala', v_sala, 'correlativo', v_corr);
END;
$function$;

