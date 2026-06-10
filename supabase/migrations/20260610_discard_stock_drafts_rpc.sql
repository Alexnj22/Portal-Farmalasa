-- RPC para descartar todos los borradores pendientes de una sucursal.
-- "Descartar" = revertir draft_min/max al valor publicado (min_units/max_units)
-- y poner draft_status = 'none'. No borra nada — los valores publicados siguen intactos.
-- Descarta tanto 'pending' como 'sparse_data' (ambos son borradores no publicados).

CREATE OR REPLACE FUNCTION public.discard_stock_drafts(p_erp_sucursal_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE product_stock_params
  SET
    draft_min    = COALESCE(min_units, 0),
    draft_max    = COALESCE(max_units, 0),
    draft_status = 'none',
    updated_at   = now()
  WHERE erp_sucursal_id = p_erp_sucursal_id
    AND draft_status IN ('pending', 'sparse_data');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.discard_stock_drafts(integer) TO authenticated, service_role;
