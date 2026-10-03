SET lock_timeout = '5s';

-- Plan de alcance F4, MIN·MAX (2026-10-02). Decisión del usuario: Jefe/a de
-- Compras ve MIN·MAX sólo de Bodega, no sala por sala; las otras salas, al
-- desplegar un producto y dentro del pedido.
--
--   · Contexto de un producto (`get_minmax_contexto_producto`,
--     `contexto_de_solicitud_minmax`): no pedían NADA — cualquiera con sesión
--     leía ventas y existencias de cualquier producto en cualquier sala. Son
--     el detalle de una solicitud de cambio de MIN·MAX: la pide la sala para
--     sí misma y la revisa quien aprueba. Ahora: la sala propia, o MIN·MAX, o
--     la bandeja de esas solicitudes. Siguen cruzando salas para quien tiene
--     MIN·MAX: es «desplegar el producto», que la decisión permite.
--   · Resúmenes de costo de una sala (`get_inventory_cost_summary`,
--     `get_draft_cost_estimate`): sólo la sala propia salvo MIN·MAX en red.
--     Devuelven NULL y no un error: la pestaña trata un error del resumen como
--     fallo de la carga entera, y un NULL sólo esconde el resumen.
--     `get_draft_cost_estimate` además no pasaba por `auth_ve_costos()`, a
--     diferencia de su hermana.
--   · `get_stagnant_inventory` y su envoltura `_jsonb`: no las llama nadie.

CREATE OR REPLACE FUNCTION public.get_minmax_contexto_producto(p_erp_product_id integer, p_erp_sucursal_id integer)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
      AND public.venta_valida(si.estado)
      AND si.fecha >= date_trunc('month', CURRENT_DATE)::date
  ),
  cerrados AS (
    SELECT MAX(COALESCE(a.ultima_venta,
                        ((a.year_month || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date)) AS ultima
    FROM public.product_sales_monthly_agg a
    WHERE a.erp_product_id = p_erp_product_id
      AND a.branch_id = (SELECT branch_id FROM sala)
  ),
  estante AS (
    SELECT
      COALESCE(SUM(i.cantidad::numeric * COALESCE(vf.factor,
                 NULLIF(split_part(LOWER(COALESCE(i.detalle, '')), 'x', 2), '')::numeric, 1))
               FILTER (WHERE NOT i.is_vencidos), 0) AS vivas,
      COALESCE(SUM(i.cantidad::numeric * COALESCE(vf.factor,
                 NULLIF(split_part(LOWER(COALESCE(i.detalle, '')), 'x', 2), '')::numeric, 1))
               FILTER (WHERE i.is_vencidos), 0)     AS vencidas
    FROM public.inventory i
    LEFT JOIN public.mv_product_factor vf
           ON vf.product_id = i.erp_product_id
          AND vf.pres_key   = UPPER(TRIM(i.presentacion))
    WHERE i.erp_product_id  = p_erp_product_id
      AND i.erp_sucursal_id = p_erp_sucursal_id
  )
  SELECT json_build_object(
    'unidades_mes', mes.unidades,
    -- GREATEST ignora los NULL: si nunca vendió, los dos son NULL y el
    -- resultado también — «sin ventas», no una fecha inventada.
    'ultima_venta', GREATEST(mes.ultima, cerrados.ultima),
    'existencia',          estante.vivas,
    'existencia_vencida',  estante.vencidas
  )
  FROM mes, cerrados, estante
  -- Sólo la sala propia, o quien tiene MIN·MAX o la bandeja de solicitudes
  -- (2026-10-02). Sin coincidencia devuelve NULL: el detalle queda vacío.
  WHERE p_erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())
     OR (SELECT public.auth_has_module_permission('minmax', 'can_view'))
     OR (SELECT public.auth_has_module_permission('requests_minmax', 'can_view'));
$function$
;

CREATE OR REPLACE FUNCTION public.contexto_de_solicitud_minmax(p_erp_product_id integer, p_erp_sucursal_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- DEFINER como `get_minmax_contexto_producto`, su vecina en el mismo detalle:
-- unidades vendidas y presentaciones de un producto, nada de personas. plpgsql
-- porque el plan de las ventas depende de los argumentos.
DECLARE
    v_branch bigint;
    v_meses  jsonb;
    v_pres   json;
    v_desp   json;
BEGIN
    IF p_erp_product_id IS NULL THEN RETURN NULL; END IF;
    -- La sala propia, o MIN·MAX, o la bandeja de solicitudes (2026-10-02).
    IF NOT (p_erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())
            OR (SELECT public.auth_has_module_permission('minmax', 'can_view'))
            OR (SELECT public.auth_has_module_permission('requests_minmax', 'can_view'))) THEN
        RETURN NULL;
    END IF;

    SELECT branch_id INTO v_branch FROM public.erp_sucursal_map
     WHERE erp_sucursal_id = p_erp_sucursal_id AND NOT es_bodega;
    v_meses := public.ventas_por_mes_de_producto(p_erp_product_id, v_branch);

    -- De la más chica (la base) a la más grande.
    SELECT json_agg(json_build_object('tipo', p.tipo, 'factor', p.factor) ORDER BY p.factor, p.tipo)
      INTO v_pres
      FROM (SELECT DISTINCT btrim(pres.tipo) AS tipo, pp.factor
              FROM public.product_precios pp
              JOIN public.presentaciones pres ON pres.id = pp.id_presentacion
             WHERE pp.product_id = p_erp_product_id AND pp.activo AND pp.factor > 0) p;

    -- La unidad en que el pedido despacha: el mismo canónico de Pedidos.
    SELECT json_build_object('tipo', u.tipo, 'etiqueta', u.etiqueta, 'factor', u.factor,
                             'multiplo', u.multiplo, 'unidades', u.unidades)
      INTO v_desp
      FROM public.unidad_de_despacho(ARRAY[p_erp_product_id]) u;

    RETURN json_build_object('ventas_meses', v_meses, 'presentaciones', v_pres, 'despacho', v_desp);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_inventory_cost_summary(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF coalesce(current_setting('request.jwt.claims', true), '') <> ''
       AND (SELECT auth.role()) <> 'service_role'
       AND NOT (coalesce((SELECT public.auth_has_module_permission('minmax', 'can_view')), false)
                AND public.auth_ve_costos()) THEN
        RETURN NULL;
    END IF;
    -- MIN·MAX de una sala: sólo la propia; todas (NULL) o una ajena, sólo con
    -- MIN·MAX en red (2026-10-02). Fuera de la JWT (service_role) no aplica.
    IF coalesce(current_setting('request.jwt.claims', true), '') <> ''
       AND (SELECT auth.role()) <> 'service_role'
       AND coalesce((SELECT public.auth_module_scope('minmax')), '') <> 'ALL'
       AND p_erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
        RETURN NULL;
    END IF;
    RETURN public.get_inventory_cost_summary_base(p_erp_sucursal_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_draft_cost_estimate(p_erp_sucursal_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT auth_has_module_permission('minmax', 'can_view') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere acceso a Min/Max';
  END IF;
  -- Es un COSTO: el mismo freno que su hermana `get_inventory_cost_summary`
  -- (2026-10-02), y sólo la sala propia salvo MIN·MAX en red. NULL y no error:
  -- la pestaña lo trata como «sin resumen».
  IF NOT public.auth_ve_costos()
     OR (coalesce((SELECT public.auth_module_scope('minmax')), '') <> 'ALL'
         AND p_erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id())) THEN
    RETURN NULL;
  END IF;

  WITH unit_costs AS (
    SELECT DISTINCT ON (product_id)
      product_id,
      (costo / factor::numeric) AS unit_cost
    FROM public.product_precios
    WHERE activo = true AND costo > 0 AND factor > 0
    ORDER BY product_id, factor ASC
  ),
  params AS (
    SELECT
      psp.erp_product_id,
      psp.min_units                                                                        AS pub_min,
      psp.max_units                                                                        AS pub_max,
      COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min END, psp.min_units) AS eff_min,
      COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max END, psp.max_units) AS eff_max,
      (psp.draft_status = 'pending' AND psp.draft_min IS NOT NULL)                        AS has_draft,
      uc.unit_cost
    FROM public.product_stock_params psp
    LEFT JOIN unit_costs uc ON uc.product_id = psp.erp_product_id
    WHERE psp.erp_sucursal_id = p_erp_sucursal_id
      AND psp.is_hidden IS NOT TRUE
      AND (psp.min_units IS NOT NULL OR (psp.draft_status = 'pending' AND psp.draft_min IS NOT NULL))
  )
  SELECT jsonb_build_object(
    'pub_min_cost',  ROUND(COALESCE(SUM(pub_min * unit_cost), 0)::numeric, 2),
    'pub_max_cost',  ROUND(COALESCE(SUM(pub_max * unit_cost), 0)::numeric, 2),
    'eff_min_cost',  ROUND(COALESCE(SUM(eff_min * unit_cost), 0)::numeric, 2),
    'eff_max_cost',  ROUND(COALESCE(SUM(eff_max * unit_cost), 0)::numeric, 2),
    'product_count', COUNT(*),
    'draft_count',   COUNT(*) FILTER (WHERE has_draft),
    'costed_pct',    CASE WHEN COUNT(*) > 0
                       THEN ROUND((COUNT(CASE WHEN unit_cost IS NOT NULL THEN 1 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)
                       ELSE 0 END
  ) INTO result FROM params;
  RETURN COALESCE(result, '{}'::jsonb);
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.get_stagnant_inventory(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_stagnant_inventory_jsonb(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stagnant_inventory(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_stagnant_inventory_jsonb(integer) TO service_role;
