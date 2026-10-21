-- Fusionar clientes ya no borra reservas ni encargos (auditoría 2026-10-21,
-- punto 1). La fusión los mueve a la ficha buena y las FK pasan a RESTRICT:
-- si algún día otro camino borra una ficha con reservas, falla en vez de
-- llevárselas en silencio.
SET lock_timeout = '5s';

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
BEGIN
  -- `service_role` es el proceso automático: ya es de confianza y no tiene
  -- empleado que resolver. Para cualquier otro, el permiso de siempre.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_h FROM public.customers WHERE id = p_huerfana FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUERFANA_NO_EXISTE'; END IF;

  -- Solo se borra una ficha SIN emparejar. Una con erp_id es la buena de
  -- alguien y borrarla sería perder el vínculo, no limpiarlo.
  IF v_h.erp_id IS NOT NULL THEN RAISE EXCEPTION 'HUERFANA_YA_EMPAREJADA'; END IF;
  IF public.es_cliente_mostrador(v_h.name, v_h.erp_id) THEN
    RAISE EXCEPTION 'ES_MOSTRADOR';
  END IF;

  SELECT * INTO v_buena FROM public.customers
   WHERE erp_id = p_erp_id AND id <> p_huerfana FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESTINO_NO_EXISTE'; END IF;

  -- Los puntos son saldo de una persona: no se mezclan de noche. Ver encabezado.
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
  -- dos veces y se va con el borrado.
  UPDATE public.dte_datos_pedidos d SET customer_id = v_buena.id
   WHERE d.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.dte_datos_pedidos o
                      WHERE o.customer_id = v_buena.id AND o.campo = d.campo
                        AND o.estado = 'PENDIENTE' AND d.estado = 'PENDIENTE');
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('pedidos_dte', v_n);

  -- Lo de la app de clientes y la sala (2026-10-21): reservas, encargos, sus
  -- cobros en línea y la preventa son dinero y compromisos de una persona.
  -- Antes se iban con el DELETE (ON DELETE CASCADE) y un anticipo pagado
  -- desaparecía sin rastro.
  UPDATE public.app_reservas SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('reservas', v_n);

  UPDATE public.app_encargos SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('encargos', v_n);

  UPDATE public.app_reservas_pagos SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('pagos_en_linea', v_n);

  UPDATE public.preventas SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('preventas', v_n);

  UPDATE public.app_cliente_muestras SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('muestras', v_n);

  -- La aceptación de términos es constancia legal: no se borra.
  UPDATE public.app_cliente_aceptaciones SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('aceptaciones', v_n);

  UPDATE public.app_tratamientos a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.app_tratamientos b WHERE b.customer_id = v_buena.id AND b.product_id = a.product_id);

  -- ── Una fila por cliente: sólo si la buena no tiene la suya ──────────────
  UPDATE public.customer_activity a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.customer_activity b WHERE b.customer_id = v_buena.id);

  UPDATE public.clientes_sin_producto a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.clientes_sin_producto b WHERE b.customer_id = v_buena.id);

  UPDATE public.puntos_codigo_acceso a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.puntos_codigo_acceso b WHERE b.customer_id = v_buena.id);

  -- La revisión que hablaba de ESTA ficha suelta queda resuelta al fusionarla.
  -- Las que traen número se mueven: siguen siendo sobre un cliente que existe.
  DELETE FROM public.clientes_por_revisar
   WHERE customer_id = p_huerfana AND erp_id IS NULL;
  UPDATE public.clientes_por_revisar SET customer_id = v_buena.id
   WHERE customer_id = p_huerfana;

  DELETE FROM public.customers WHERE id = p_huerfana;

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
            'movido', v_mov));

  RETURN json_build_object(
    'ok', true, 'facturas_movidas', v_movidas, 'movido', v_mov,
    'huerfana', json_build_object('id', p_huerfana, 'name', v_h.name),
    'destino',  json_build_object('id', v_buena.id, 'name', v_buena.name,
                                  'erp_id', v_buena.erp_id));
END;
$function$;

ALTER TABLE public.app_reservas DROP CONSTRAINT app_reservas_customer_id_fkey,
  ADD CONSTRAINT app_reservas_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.app_encargos DROP CONSTRAINT app_encargos_customer_id_fkey,
  ADD CONSTRAINT app_encargos_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.app_reservas_pagos DROP CONSTRAINT app_reservas_pagos_reserva_id_fkey,
  ADD CONSTRAINT app_reservas_pagos_reserva_id_fkey FOREIGN KEY (reserva_id) REFERENCES public.app_reservas(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.app_reservas VALIDATE CONSTRAINT app_reservas_customer_id_fkey;
ALTER TABLE public.app_encargos VALIDATE CONSTRAINT app_encargos_customer_id_fkey;
ALTER TABLE public.app_reservas_pagos VALIDATE CONSTRAINT app_reservas_pagos_reserva_id_fkey;
