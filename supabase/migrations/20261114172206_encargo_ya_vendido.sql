SET lock_timeout = '5s';

-- «Ya se vendió» (2026-11-14, pedido del usuario): el encargo se cobró en
-- caja como una venta normal y nadie lo pasó por el portal. Medido ese día:
-- E-000018 (Basaglar, $83.05) se facturó el 12-nov en la misma sala, por el
-- mismo monto, a nombre de un familiar — buscarlo por el nombre lo perdía.
-- Si alguien aprieta «Cobrar», el dinero se cuenta dos veces.
--
-- La venta se reconoce por la sala, el producto, el monto (precio × cantidad)
-- y la fecha (desde que se anotó); el nombre del cliente es sólo una pista.
-- El renglón de la factura queda amarrado al encargo (uno por encargo, y un
-- renglón no sirve para dos). Sin FK: sales_invoice_items es tabla caliente.

ALTER TABLE public.app_encargos ADD COLUMN IF NOT EXISTS venta_item_id bigint;
COMMENT ON COLUMN public.app_encargos.venta_item_id IS
  'Renglón de sales_invoice_items con el que se vendió el encargo fuera del portal («Ya se vendió»). Sin FK a propósito: tabla caliente.';
CREATE UNIQUE INDEX IF NOT EXISTS app_encargos_venta_item_uq ON public.app_encargos (venta_item_id) WHERE venta_item_id IS NOT NULL;

-- Las ventas que pueden ser la del encargo, de mejor a peor.
-- Devuelve { "<id encargo>": [ {item_id, factura, fecha, hora, cliente, producto, cantidad, total,
--            mismo_producto, mismo_monto, mismo_cliente, mismo_apellido, puntos} ] }.
-- Encargos que no se pueden manejar o que no están para esto quedan fuera.
CREATE OR REPLACE FUNCTION public.encargos_ventas_candidatas(p_ids bigint[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  WITH enc AS (
    SELECT e.id, e.branch_id, e.product_id, e.customer_id,
           CASE WHEN e.precio_unitario IS NOT NULL THEN round(e.precio_unitario * e.cantidad, 2) END AS monto,
           (e.created_at AT TIME ZONE 'America/El_Salvador')::date AS desde,
           (SELECT array_agg(w) FROM unnest(regexp_split_to_array(upper(public.norm_search(coalesce(c.name, ''))), '\s+')) w
             WHERE length(w) >= 4) AS palabras
      FROM public.app_encargos e
      LEFT JOIN public.customers c ON c.id = e.customer_id
     WHERE e.id = ANY (p_ids)
       AND e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
       AND e.pago_estado <> 'pagado' AND e.reserva_id IS NULL AND e.venta_item_id IS NULL
       AND public.encargo_puede_manejar(e.branch_id)
  ), cand AS (
    SELECT enc.id AS encargo_id, ii.id AS item_id,
           si.tipo_documento || ' ' || coalesce(nullif(ltrim(split_part(btrim(si.correlativo), '_', 1), '0'), ''), si.erp_invoice_id::text) AS factura,
           si.fecha, si.hora, si.cliente, ii.descripcion AS producto, ii.cantidad, ii.total_linea AS total,
           (enc.product_id IS NOT NULL AND ii.erp_product_id = enc.product_id) AS mismo_producto,
           (enc.monto IS NOT NULL AND abs(ii.total_linea - enc.monto) <= 0.011) AS mismo_monto,
           (si.customer_id IS NOT NULL AND si.customer_id = enc.customer_id) AS mismo_cliente,
           EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(upper(public.norm_search(coalesce(si.cliente, ''))), '\s+')) w
                    WHERE w = ANY (enc.palabras)) AS mismo_apellido
      FROM enc
      JOIN public.sales_invoices si ON si.branch_id = enc.branch_id AND si.fecha BETWEEN enc.desde AND (now() AT TIME ZONE 'America/El_Salvador')::date
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
     WHERE public.venta_valida(si.estado)
       AND ((enc.product_id IS NOT NULL AND ii.erp_product_id = enc.product_id)
            OR (enc.monto IS NOT NULL AND abs(ii.total_linea - enc.monto) <= 0.011))
       AND NOT EXISTS (SELECT 1 FROM public.app_encargos o WHERE o.venta_item_id = ii.id)
  ), puntuadas AS (
    SELECT c.*, (CASE WHEN mismo_producto THEN 3 ELSE 0 END + CASE WHEN mismo_monto THEN 2 ELSE 0 END
                 + CASE WHEN mismo_cliente THEN 3 WHEN mismo_apellido THEN 1 ELSE 0 END) AS puntos,
           row_number() OVER (PARTITION BY encargo_id ORDER BY
             (CASE WHEN mismo_producto THEN 3 ELSE 0 END + CASE WHEN mismo_monto THEN 2 ELSE 0 END
              + CASE WHEN mismo_cliente THEN 3 WHEN mismo_apellido THEN 1 ELSE 0 END) DESC, fecha DESC, hora DESC) AS n
      FROM cand c
  )
  SELECT coalesce(json_object_agg(encargo_id, lista), '{}'::json) INTO v
    FROM (SELECT encargo_id, json_agg(json_build_object(
                   'item_id', item_id, 'factura', factura, 'fecha', fecha, 'hora', hora, 'cliente', cliente,
                   'producto', producto, 'cantidad', cantidad, 'total', total, 'mismo_producto', mismo_producto,
                   'mismo_monto', mismo_monto, 'mismo_cliente', mismo_cliente, 'mismo_apellido', mismo_apellido,
                   'puntos', puntos) ORDER BY n) AS lista
            FROM puntuadas WHERE n <= 8 GROUP BY encargo_id) t;
  RETURN v;
END $function$;

-- Amarra el encargo a esa venta y lo da por entregado: no entra dinero al
-- cajón (ya entró con la factura). Las mismas guardas de dinero que
-- «Ya no lo quiere»: nada pagado por el portal, ni cobro en caja vivo, ni
-- pago en línea en curso.
CREATE OR REPLACE FUNCTION public.encargo_ya_vendido(p_id bigint, p_item_id bigint, p_nota text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos; v_emp uuid := public.auth_employee_id();
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  ii public.sales_invoice_items; si public.sales_invoices; v_fact text;
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF e.estado NOT IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo') THEN
    RAISE EXCEPTION 'Ese encargo ya está cerrado.';
  END IF;
  IF e.pago_estado = 'pagado' THEN
    RAISE EXCEPTION 'Ese encargo ya se pagó por el portal: se entrega con «Retirar».';
  END IF;
  IF e.reserva_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se resuelve desde la reserva.', lpad(e.reserva_id::text, 6, '0');
  END IF;
  IF EXISTS (SELECT 1 FROM public.caja_movimientos_portal m WHERE m.encargo_id = e.id AND m.anulado_at IS NULL) THEN
    RAISE EXCEPTION 'Ese encargo tiene un cobro en caja del portal: no se puede amarrar a otra venta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas_pagos pg WHERE pg.encargo_id = e.id
               AND (pg.pagado_at IS NOT NULL OR pg.created_at > now() - interval '2 hours')) THEN
    RAISE EXCEPTION 'El cliente tiene un pago en línea en curso para ese encargo: espera a que se resuelva.';
  END IF;

  SELECT * INTO ii FROM public.sales_invoice_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa venta no existe.'; END IF;
  SELECT * INTO si FROM public.sales_invoices WHERE id = ii.invoice_id;
  IF si.branch_id IS DISTINCT FROM e.branch_id THEN RAISE EXCEPTION 'Esa venta es de otra sala.'; END IF;
  IF NOT public.venta_valida(si.estado) THEN RAISE EXCEPTION 'Esa venta está anulada.'; END IF;
  IF si.fecha < (e.created_at AT TIME ZONE 'America/El_Salvador')::date THEN
    RAISE EXCEPTION 'Esa venta es de antes de anotar el encargo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_encargos o WHERE o.venta_item_id = p_item_id AND o.id <> p_id) THEN
    RAISE EXCEPTION 'Esa venta ya está amarrada a otro encargo.';
  END IF;

  v_fact := si.tipo_documento || ' ' || coalesce(nullif(ltrim(split_part(btrim(si.correlativo), '_', 1), '0'), ''), si.erp_invoice_id::text);
  UPDATE public.app_encargos
     SET estado = 'entregado', venta_item_id = p_item_id, pago_estado = 'pagado',
         pagado_at = coalesce((si.fecha + coalesce(si.hora, '00:00'::time)) AT TIME ZONE 'America/El_Salvador', now()),
         cerrado_at = now(), updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || 'Se vendió en ' || v_fact
                              || coalesce(' (' || v_nota || ')', ''), 300)
   WHERE id = p_id;

  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_YA_VENDIDO', p_id::text,
          jsonb_build_object('antes', e.estado, 'factura_id', si.id, 'item_id', p_item_id, 'factura', v_fact,
                             'total', ii.total_linea, 'por_cobrar', e.anticipo, 'nota', v_nota), e.branch_id, 'ADMIN_PANEL');

  RETURN json_build_object('ok', true, 'id', p_id, 'factura', v_fact);
END $function$;

REVOKE EXECUTE ON FUNCTION public.encargos_ventas_candidatas(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargos_ventas_candidatas(bigint[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.encargo_ya_vendido(bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_ya_vendido(bigint, bigint, text) TO authenticated, service_role;
