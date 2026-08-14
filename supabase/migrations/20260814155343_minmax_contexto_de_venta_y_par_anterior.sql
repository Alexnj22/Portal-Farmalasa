SET lock_timeout = '5s';

-- ── 1. Lo que hacía falta para decidir un MIN·MAX ───────────────────────────
-- «Vendidas en 6 meses» sola no distingue un producto que dejó de venderse de
-- uno que vende poco y constante: 26 unidades pueden ser 26 el mes pasado o 26
-- repartidas y la última hace ocho meses. Las dos que faltaban —lo del mes en
-- curso y la fecha de la última venta— son justo las que separan «bajó» de «se
-- murió». Pedido del usuario el 2026-08-14.
--
-- Se guardan EN la solicitud, como ya se guardaba `current_sales_6m`: quien
-- aprueba tiene que ver el mismo retrato que vio quien propuso, y el centro de
-- solicitudes pinta muchas filas sin poder salir a consultar por cada una.
ALTER TABLE public.minmax_change_requests
  ADD COLUMN IF NOT EXISTS current_sales_mes   numeric,
  ADD COLUMN IF NOT EXISTS current_ultima_venta date;

COMMENT ON COLUMN public.minmax_change_requests.current_sales_mes IS
  'Unidades vendidas en el mes EN CURSO por esa sala, al momento de crear la solicitud.';
COMMENT ON COLUMN public.minmax_change_requests.current_ultima_venta IS
  'Fecha de la última venta del producto en esa sala, al momento de crear la solicitud.';

-- ── 2. De dónde salen esos dos números ──────────────────────────────────────
-- El mes en curso NO está en `product_sales_monthly_agg` —esa tabla significa
-- «meses cerrados», lo dice `rebuild_product_sales_monthly_agg`—, así que va
-- por lectura viva de las facturas. La última venta cruza las dos: el máximo
-- del agregado (columna `ultima_venta`, con el fin de mes de reserva para las
-- filas viejas sin backfill) contra el máximo del mes en curso. Es la misma
-- receta de `get_product_sales_agg`, para un solo producto.
--
-- Las unidades se miden como en `calculate_stock_params` —`cantidad *
-- factor_unidades`— y no con el `cantidad` del agregado, que está en
-- presentaciones. Si las dos cifras de la pantalla no se miden igual, la
-- comparación entre ellas miente.
--
-- SECURITY DEFINER, y esta es la razón: `sales_invoices` exige `ventas.can_view`
-- para leerse. Hoy Jefe/a y Subjefe/a de Sala lo tienen, pero un rol que pueda
-- proponer un ajuste sin ese permiso vería «0 vendidas este mes» y «sin ventas»
-- —una respuesta que se lee como un hecho y es un permiso faltante
-- (`feedback_un_rpc_invoker_reusado_para_otro_publico_devuelve_cero`)—. Lo que
-- devuelve es un agregado de un producto en una sala, del mismo orden que el
-- `units_sold_6m` que la pantalla ya muestra desde `product_stock_params`.
CREATE OR REPLACE FUNCTION public.get_minmax_contexto_producto(
  p_erp_product_id  integer,
  p_erp_sucursal_id integer
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH sala AS (
    SELECT branch_id FROM public.erp_sucursal_map
    WHERE erp_sucursal_id = p_erp_sucursal_id AND NOT es_bodega
  ),
  mes AS (
    SELECT COALESCE(SUM(sii.cantidad::numeric * sii.factor_unidades), 0) AS unidades,
           MAX(si.fecha) AS ultima
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    WHERE sii.erp_product_id = p_erp_product_id
      AND si.branch_id = (SELECT branch_id FROM sala)
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND si.fecha >= date_trunc('month', CURRENT_DATE)::date
  ),
  cerrados AS (
    SELECT MAX(COALESCE(a.ultima_venta,
                        ((a.year_month || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date)) AS ultima
    FROM public.product_sales_monthly_agg a
    WHERE a.erp_product_id = p_erp_product_id
      AND a.branch_id = (SELECT branch_id FROM sala)
  )
  SELECT json_build_object(
    'unidades_mes', mes.unidades,
    -- GREATEST ignora los NULL: si nunca vendió, los dos son NULL y el
    -- resultado también — «sin ventas», no una fecha inventada.
    'ultima_venta', GREATEST(mes.ultima, cerrados.ultima)
  )
  FROM mes, cerrados;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_minmax_contexto_producto(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_minmax_contexto_producto(integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_minmax_contexto_producto(integer, integer) IS
  'Unidades vendidas en el mes en curso y fecha de la última venta de un producto en una sala. Alimenta el formulario de ajuste de MIN/MAX.';

-- ── 3. Aprobar devuelve TAMBIÉN el par que había ────────────────────────────
-- El historial de MIN·MAX de un producto mostraba «MIN — MAX —» en las
-- aprobaciones (visto el 2026-08-14 en CIPRO DENK): la bitácora escribía
-- `requested_min/requested_max` y el historial lee `old_min/new_min`. Para
-- escribir el «de → a» de verdad hace falta el par ANTERIOR, y el único que lo
-- tiene sin volver a consultar es esta función, justo antes de pisarlo.
--
-- No sirve `current_min`/`current_max` de la solicitud: los escribió el
-- navegador al crearla y pueden ser de hace días.
CREATE OR REPLACE FUNCTION public.approve_minmax_request(
  p_request_id bigint,
  p_decided_by text DEFAULT NULL::text,
  p_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.minmax_change_requests%ROWTYPE;
  v_now timestamptz := now();
  v_publisher text := (SELECT auth.email());
  v_is_hidden boolean;
  v_prev_min integer;
  v_prev_max integer;
BEGIN
  -- p_decided_by se recibe y se IGNORA (F4.2).
  UPDATE public.minmax_change_requests
  SET status='approved', decided_by=v_publisher, decided_at=v_now, decision_note=p_note
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_NO_PERMISSION';
  END IF;

  IF r.erp_sucursal_id = 6 THEN
    RAISE EXCEPTION 'BODEGA_NOT_APPROVABLE_HERE: Bodega deriva su MIN/MAX de la suma de sucursales (trg_bodega_draft_sync), no admite solicitudes directas';
  END IF;

  SELECT is_hidden,
         public.minmax_eff_min(min_units, max_units, manual_min, manual_max),
         public.minmax_eff_max(min_units, max_units, manual_min, manual_max)
    INTO v_is_hidden, v_prev_min, v_prev_max
  FROM public.product_stock_params
  WHERE erp_product_id = r.erp_product_id AND erp_sucursal_id = r.erp_sucursal_id;

  IF v_is_hidden IS TRUE THEN
    RAISE EXCEPTION 'PRODUCT_HIDDEN: el producto está oculto en Min/Max — quitale el ocultamiento antes de aprobar esta solicitud';
  END IF;

  INSERT INTO public.product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    manual_min, manual_max,
    published_at, published_by, updated_at
  )
  VALUES (
    r.erp_product_id, r.erp_sucursal_id,
    r.requested_min, r.requested_max,
    NULL, NULL,
    v_now, v_publisher, v_now
  )
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = EXCLUDED.min_units,
    max_units    = EXCLUDED.max_units,
    manual_min   = NULL,
    manual_max   = NULL,
    published_at = EXCLUDED.published_at,
    published_by = EXCLUDED.published_by,
    updated_at   = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'ok', true,
    'erp_product_id', r.erp_product_id,
    'erp_sucursal_id', r.erp_sucursal_id,
    'requested_by_id', r.requested_by_id,
    'requested_by_name', r.requested_by_name,
    'product_name', r.product_name,
    'requested_min', r.requested_min,
    'requested_max', r.requested_max,
    'previous_min', v_prev_min,
    'previous_max', v_prev_max
  );
END;
$function$;
