-- Un pago que nombra dos veces la misma factura tiene que decirlo con palabras.
--
-- Encontrado auditando: mandar `[{doc:1, monto:10}, {doc:1, monto:10}]` chocaba
-- contra el índice único y devolvía **«duplicate key value violates unique
-- constraint "compra_pago_aplicado_pago_id_document_id_key"»**. El freno
-- funcionaba —no se guardó nada de más— pero quien lo lee no puede saber qué
-- hizo mal, y un mensaje así en una pantalla de plata parece una falla del
-- sistema en vez de un dato repetido.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.registrar_pago_compra(
    p_emisor_nit text, p_fecha date, p_forma text, p_referencia text,
    p_aplicaciones jsonb, p_nota text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_emp uuid; v_pago bigint; v_total numeric(12,2) := 0; r record; v_saldo numeric(12,2);
  v_repetidas integer;
BEGIN
  IF NOT public.auth_has_module_permission('cuentas_por_pagar','can_edit') THEN
    RAISE EXCEPTION 'No tenés permiso para registrar pagos.';
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Tu usuario no está activo.'; END IF;

  IF p_aplicaciones IS NULL OR jsonb_array_length(p_aplicaciones) = 0 THEN
    RAISE EXCEPTION 'Un pago tiene que decir a qué facturas se aplica.';
  END IF;

  -- La misma factura dos veces en el mismo pago: se dice antes de escribir
  -- nada, en vez de dejar que reviente el índice único.
  SELECT count(*) INTO v_repetidas FROM (
      SELECT (x->>'document_id')::bigint AS doc
        FROM jsonb_array_elements(p_aplicaciones) x
       GROUP BY 1 HAVING count(*) > 1) z;
  IF v_repetidas > 0 THEN
    RAISE EXCEPTION 'Una misma factura no puede ir dos veces en el mismo pago.';
  END IF;

  -- El monto del pago es la SUMA de lo aplicado, no un número aparte: así no
  -- puede haber un pago de $500 repartido en $300.
  SELECT sum((x->>'monto')::numeric) INTO v_total
    FROM jsonb_array_elements(p_aplicaciones) x;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'El monto del pago tiene que ser mayor que cero.';
  END IF;

  INSERT INTO public.compra_pagos (emisor_nit, fecha, monto, forma, referencia, nota, registrado_por)
  VALUES (p_emisor_nit, p_fecha, v_total, p_forma, nullif(btrim(p_referencia),''), nullif(btrim(p_nota),''), v_emp)
  RETURNING id INTO v_pago;

  FOR r IN SELECT (x->>'document_id')::bigint AS doc, (x->>'monto')::numeric AS monto
             FROM jsonb_array_elements(p_aplicaciones) x
  LOOP
    IF r.monto IS NULL OR r.monto <= 0 THEN
      RAISE EXCEPTION 'Cada aplicación tiene que ser mayor que cero.';
    END IF;

    SELECT (d.monto - d.aplicado - d.en_tramite) INTO v_saldo
      FROM public.compra_deuda_documentos d
     WHERE d.document_id = r.doc AND d.emisor_nit = p_emisor_nit;

    IF v_saldo IS NULL THEN
      RAISE EXCEPTION 'La factura % no es deuda de ese proveedor.', r.doc;
    END IF;
    -- `v_saldo` ya descuenta lo que otros pagos pendientes reservaron sobre esa
    -- factura: dos pagos en trámite no pueden sumar más de lo que se debe.
    IF r.monto > v_saldo THEN
      RAISE EXCEPTION 'A la factura % sólo le quedan % por pagar.', r.doc, v_saldo;
    END IF;

    INSERT INTO public.compra_pago_aplicado (pago_id, document_id, monto)
    VALUES (v_pago, r.doc, r.monto);
  END LOOP;

  RETURN v_pago;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_pago_compra(text, date, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_pago_compra(text, date, text, text, jsonb, text) TO authenticated, service_role;
