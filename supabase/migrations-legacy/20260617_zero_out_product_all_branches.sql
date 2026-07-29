-- zero_out_product_all_branches: pone 0/0 en todas las sucursales y bodega para un producto.
-- Acción desde bodega: permite retirar un producto de toda la red en un solo paso.
-- Equivalente a que cada sucursal publique 0/0 manualmente.

CREATE OR REPLACE FUNCTION public.zero_out_product_all_branches(
  p_erp_product_id integer,
  p_published_by   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_now   TIMESTAMPTZ := NOW();
  v_count INTEGER;
BEGIN
  -- Pone 0/0 publicado en todas las sucursales y bodega, limpia drafts y overrides manuales
  INSERT INTO product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    draft_min, draft_max, draft_status,
    manual_min, manual_max,
    published_at, published_by, updated_at
  )
  SELECT
    p_erp_product_id,
    erp_sucursal_id,
    0, 0,
    NULL, NULL, 'none',
    NULL, NULL,
    v_now, p_published_by, v_now
  FROM (VALUES (1),(2),(3),(4),(5),(6),(7)) AS t(erp_sucursal_id)
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = 0,
    max_units    = 0,
    draft_min    = NULL,
    draft_max    = NULL,
    draft_status = 'none',
    manual_min   = NULL,
    manual_max   = NULL,
    published_at = v_now,
    published_by = p_published_by,
    updated_at   = v_now
  WHERE product_stock_params.is_hidden IS NOT TRUE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',      true,
    'updated', v_count,
    'at',      v_now
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.zero_out_product_all_branches(integer, text) TO authenticated, service_role;
