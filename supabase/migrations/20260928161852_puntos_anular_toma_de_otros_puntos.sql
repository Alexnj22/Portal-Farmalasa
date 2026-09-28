SET lock_timeout = '5s';

-- ═══ Anular una compra quita sus puntos aunque ya se hayan usado ═══════════
-- Decisión del usuario (2026-09-28): si la compra anulada ya no tiene sus
-- puntos —el cliente los canjeó—, se toman de sus OTROS puntos, los más viejos
-- primero. Sólo lo que de verdad no alcanza queda como «no recuperado» (en
-- Avisos): la cuenta nunca queda en negativo.
--
-- Ejemplo: Juan gana 50 con la compra A, los canjea y le quedan 100 de otras
-- compras. Se anula A: antes quedaba en 100 con 50 «no recuperados»; ahora
-- queda en 50 y no hay aviso.
--
-- Y el movimiento se dice claro: «compra anulada · <documento>», más «sus
-- puntos ya se habían usado; se tomaron de sus otros puntos» o «faltaron N»
-- cuando corresponde. Reescrita desde la definición VIVA.
CREATE OR REPLACE FUNCTION public.puntos_anular_venta(p_invoice_id bigint, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  l record; v_salida bigint;
  v_propios integer;   -- lo que queda en el lote de ESA compra
  v_otros integer := 0;  -- lo que se toma de otras compras
  v_saldo integer;
  v_falta integer;
  v_doc text;
  v_motivo text;
BEGIN
  SELECT * INTO l FROM public.puntos_lote WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', true, 'accion', 'ninguna', 'motivo', 'esa venta nunca dio puntos en el portal');
  END IF;

  -- La cuenta tomada: el saldo que se lee es el que se descuenta.
  SELECT saldo INTO v_saldo FROM public.puntos_cuenta WHERE customer_id = l.customer_id FOR UPDATE;
  v_saldo := coalesce(v_saldo, 0);
  v_propios := l.restantes;
  v_otros := least(l.puntos - v_propios, greatest(v_saldo - v_propios, 0));
  v_falta := l.puntos - v_propios - v_otros;

  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'ok', true, 'dio', l.puntos,
                             'se_quitan', v_propios + v_otros, 'de_otras_compras', v_otros,
                             'ya_gastados', v_falta);
  END IF;

  IF v_propios + v_otros > 0 THEN
    SELECT correlativo INTO v_doc FROM public.sales_invoices WHERE id = p_invoice_id;
    v_motivo := 'compra anulada' || coalesce(' · ' || v_doc, '')
      || CASE WHEN v_otros > 0 THEN ' · sus puntos ya se habían usado; se tomaron de sus otros puntos' ELSE '' END
      || CASE WHEN v_falta > 0 THEN format(' · faltaron %s', v_falta) ELSE '' END;

    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, invoice_id, sucursal, motivo)
    VALUES (l.customer_id, 'anulacion', v_propios + v_otros, p_invoice_id, l.sucursal, v_motivo)
    RETURNING id INTO v_salida;

    IF v_propios > 0 THEN
      UPDATE public.puntos_lote SET restantes = 0 WHERE id = l.id;
      INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos) VALUES (v_salida, l.id, v_propios);
    END IF;
    IF v_otros > 0 THEN
      -- De las otras compras, las más viejas primero (el lote propio ya está en 0).
      IF public.puntos_consumir(l.customer_id, v_otros, v_salida) <> v_otros THEN
        RAISE EXCEPTION 'El libro no cuadra al anular la venta %', p_invoice_id;
      END IF;
    END IF;

    UPDATE public.puntos_cuenta
       SET saldo = saldo - (v_propios + v_otros), usados = usados + (v_propios + v_otros), updated_at = now()
     WHERE customer_id = l.customer_id;
  END IF;

  -- Lo que ni con sus otros puntos alcanzó: queda a la vista en Avisos. Es
  -- además la marca de «ya procesada» para el barrido cuando no se quitó nada.
  IF v_falta > 0 THEN
    INSERT INTO public.puntos_anulacion_gastada (invoice_id, customer_id, sucursal, dio, no_recuperados)
    VALUES (p_invoice_id, l.customer_id, l.sucursal, l.puntos, v_falta)
    ON CONFLICT (invoice_id) DO NOTHING;
  END IF;

  RETURN json_build_object('ok', true,
    'accion', CASE WHEN v_falta = 0 THEN 'retirados enteros'
                   WHEN v_propios + v_otros = 0 THEN 'no tenía puntos para quitar'
                   ELSE 'retirados en parte' END,
    'dio', l.puntos, 'se_quitaron', v_propios + v_otros, 'de_otras_compras', v_otros,
    'no_recuperados', v_falta);
END;
$function$;
