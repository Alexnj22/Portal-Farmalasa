-- fn_psp_capture_history corría como usuario autenticado → RLS bloqueaba el INSERT en
-- product_stock_params_history (que solo tenía política SELECT).
-- SECURITY DEFINER hace que corra como el dueño de la función (postgres), bypass RLS.
CREATE OR REPLACE FUNCTION public.fn_psp_capture_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.min_units IS DISTINCT FROM NEW.min_units
   OR OLD.max_units IS DISTINCT FROM NEW.max_units
   OR OLD.daily_velocity IS DISTINCT FROM NEW.daily_velocity) THEN
    INSERT INTO product_stock_params_history
      (erp_product_id, erp_sucursal_id,
       min_units, max_units, daily_velocity, velocity_30d,
       abc_class, demand_variability, cv, calculated_at)
    VALUES
      (OLD.erp_product_id, OLD.erp_sucursal_id,
       OLD.min_units, OLD.max_units, OLD.daily_velocity, OLD.velocity_30d,
       OLD.abc_class, OLD.demand_variability, OLD.cv, OLD.calculated_at);
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_psp_capture_history() TO authenticated, service_role;
