SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El pago del asegurado de Mapfre, amarrado a su factura (2026-10-19).
--
-- Una venta a Mapfre se factura AL CRÉDITO por lo que paga la aseguradora, y lo
-- que paga el asegurado se descuenta con PUNTOS de lealtad: el sistema de la
-- caja no tiene otro descuento, y a la ficha de Mapfre no le afecta porque no
-- acumula (`customers.acumula_puntos = false`). En la factura ese descuento es
-- un renglón con `erp_product_id = 0`, y su `total_linea` es exactamente lo que
-- pagó el asegurado — las 54 facturas válidas de 2026 tienen UNO, medido.
--
-- Hasta hoy ese pago se anotaba como «Otro · mapfre» y nada lo ataba a la
-- factura: del 1-sep al 15-oct, 7 de 14 facturas no tenían un ingreso igual ese
-- día ($103.29). Ahora:
--   · el ingreso nace de la FACTURA y su monto lo pone el renglón de puntos;
--   · el asegurado sale del listado de clientes;
--   · una factura se cobra una sola vez (índice único sobre las vivas);
--   · la sala ve las facturas de Mapfre sin su cobro.
--
-- Plan: docs/PLAN-INGRESOS-Y-RESERVAS-2026-10-17.md (parte 2).
-- ═══════════════════════════════════════════════════════════════════════════

-- Sin FK a `sales_invoices` a propósito: es tabla caliente y una FK le pide un
-- candado al crearla (incidente 2026-07-08). El amarre lo valida la función.
ALTER TABLE public.caja_movimientos_portal
  ADD COLUMN IF NOT EXISTS invoice_id bigint,
  ADD COLUMN IF NOT EXISTS customer_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS caja_movimientos_portal_mapfre_una_vez
  ON public.caja_movimientos_portal (invoice_id)
  WHERE tipo_codigo = 'MAPFRE' AND anulado_at IS NULL;

INSERT INTO public.caja_tipos_movimiento
  (codigo, etiqueta, sentido, pide_boleta, pide_persona, foto, lleva_comprobante, leyenda, orden, activo, identifica_receptor)
VALUES
  ('MAPFRE', 'Pago de asegurado Mapfre', 'ENTRADA', false, false, 'NO', true,
   'Se elige la factura de Mapfre y el asegurado: el monto lo pone la factura.', 25, true, false)
ON CONFLICT (codigo) DO NOTHING;

-- La ficha de Mapfre, por su número del sistema de origen (nunca por nombre).
CREATE OR REPLACE FUNCTION public.mapfre_customer_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT id FROM public.customers WHERE erp_id = '19713' LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.mapfre_customer_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapfre_customer_id() TO authenticated, service_role;

-- ── Cuánto paga el asegurado de ESTA factura, y si se puede cobrar ─────────
-- La usa `operar-caja` antes de escribir nada: el monto lo pone la factura,
-- nunca el navegador.
CREATE OR REPLACE FUNCTION public.mapfre_cotizar(p_branch_id integer, p_invoice_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_si    public.sales_invoices%ROWTYPE;
  v_monto numeric;
  v_n     integer;
BEGIN
  SELECT * INTO v_si FROM public.sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa factura no existe.'; END IF;
  IF v_si.customer_id IS DISTINCT FROM public.mapfre_customer_id() THEN
    RAISE EXCEPTION 'Esa factura no es de Mapfre.';
  END IF;
  IF v_si.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa factura es de otra sala.'; END IF;
  IF NOT public.venta_valida(v_si.estado) THEN RAISE EXCEPTION 'Esa factura está anulada.'; END IF;

  SELECT round(sum(i.total_linea), 2), count(*) INTO v_monto, v_n
    FROM public.sales_invoice_items i
   WHERE i.invoice_id = v_si.id AND i.erp_product_id = 0;
  IF v_n = 0 OR coalesce(v_monto, 0) <= 0 THEN
    RAISE EXCEPTION 'Esa factura no trae la parte del asegurado (el descuento con puntos).';
  END IF;

  IF EXISTS (SELECT 1 FROM public.caja_movimientos_portal
              WHERE invoice_id = v_si.id AND tipo_codigo = 'MAPFRE' AND anulado_at IS NULL) THEN
    RAISE EXCEPTION 'Esa factura de Mapfre ya tiene su pago anotado.';
  END IF;

  RETURN json_build_object('invoice_id', v_si.id, 'correlativo', v_si.correlativo,
                           'fecha', v_si.fecha, 'monto', v_monto, 'total_mapfre', v_si.total);
END $function$;

REVOKE ALL ON FUNCTION public.mapfre_cotizar(integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mapfre_cotizar(integer, bigint) TO service_role;

-- ── Las facturas de Mapfre de la sala, y en qué quedó cada una ─────────────
--
-- `estado`:
--   POR_COBRAR      sin pago del asegurado
--   COBRADA         con su ingreso «Pago de asegurado Mapfre»
--   ANOTADA_COMO_OTRO  antes de que existiera el tipo, se anotó un «Otro» ese
--                   día, en esa sala y por el mismo monto. No se ofrece cobrar:
--                   ese dinero ya entró, y cobrarlo otra vez lo contaría doble.
CREATE OR REPLACE FUNCTION public.mapfre_facturas(p_branch_id integer, p_buscar text DEFAULT NULL, p_dias integer DEFAULT 60)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  -- Desde que el cobro existe (2026-10-19, decisión del usuario: «que tome en
  -- cuenta desde ahora»). Lo anterior se anotó como «Otro» y no se reabre.
  v_desde  date := greatest(v_hoy - greatest(least(coalesce(p_dias, 60), 120), 0), DATE '2026-10-19');
  v_buscar text := nullif(upper(btrim(coalesce(p_buscar, ''))), '');
  v_mapfre bigint := public.mapfre_customer_id();
  v_out    json;
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_mapfre IS NULL THEN RETURN '[]'::json; END IF;

  WITH f AS (
    SELECT si.id, si.fecha, si.hora, si.correlativo, si.total
      FROM public.sales_invoices si
     WHERE si.branch_id = p_branch_id AND si.customer_id = v_mapfre
       AND si.fecha >= v_desde AND public.venta_valida(si.estado)
  ), d AS (
    SELECT f.*,
           (SELECT round(sum(i.total_linea), 2) FROM public.sales_invoice_items i
             WHERE i.invoice_id = f.id AND i.erp_product_id = 0) AS asegurado,
           (SELECT json_agg(json_build_object('descripcion', i.descripcion, 'cantidad', i.cantidad) ORDER BY i.linea_num)
              FROM public.sales_invoice_items i
             WHERE i.invoice_id = f.id AND i.erp_product_id <> 0) AS productos
      FROM f
  ), c AS (
    SELECT d.*,
           (SELECT json_build_object('movimiento', m.id, 'monto', m.monto, 'forma_pago', m.forma_pago,
                                     'autorizacion', m.autorizacion, 'registrado_at', m.registrado_at,
                                     'asegurado', cu.name)
              FROM public.caja_movimientos_portal m
              LEFT JOIN public.customers cu ON cu.id = m.customer_id
             WHERE m.invoice_id = d.id AND m.tipo_codigo = 'MAPFRE' AND m.anulado_at IS NULL
             LIMIT 1) AS cobro,
           (SELECT json_build_object('movimiento', m.id, 'concepto', m.concepto, 'registrado_at', m.registrado_at)
              FROM public.caja_movimientos_portal m
             WHERE m.branch_id = p_branch_id AND m.fecha = d.fecha AND m.tipo = 'ENTRADA'
               AND m.anulado_at IS NULL AND coalesce(m.tipo_codigo, 'OTRO_ENTRADA') = 'OTRO_ENTRADA'
               AND abs(m.monto - d.asegurado) < 0.01
             ORDER BY m.id LIMIT 1) AS como_otro
      FROM d
     WHERE d.asegurado > 0
  )
  SELECT coalesce(json_agg(json_build_object(
           'id', c.id, 'fecha', c.fecha, 'hora', c.hora, 'correlativo', c.correlativo,
           'total_mapfre', c.total, 'asegurado', c.asegurado, 'productos', c.productos,
           'cobro', c.cobro, 'como_otro', CASE WHEN c.cobro IS NULL THEN c.como_otro END,
           'estado', CASE WHEN c.cobro IS NOT NULL THEN 'COBRADA'
                          WHEN c.como_otro IS NOT NULL THEN 'ANOTADA_COMO_OTRO'
                          ELSE 'POR_COBRAR' END)
         ORDER BY (c.cobro IS NULL AND c.como_otro IS NULL) DESC, c.fecha DESC, c.hora DESC), '[]'::json)
    INTO v_out
    FROM c
   WHERE v_buscar IS NULL
      OR c.correlativo ILIKE '%' || v_buscar || '%'
      OR EXISTS (SELECT 1 FROM json_array_elements(coalesce(c.productos, '[]'::json)) p
                  WHERE upper(p ->> 'descripcion') LIKE '%' || v_buscar || '%');
  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.mapfre_facturas(integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapfre_facturas(integer, text, integer) TO authenticated, service_role;
