-- F2.4 — Descartar un borrador tiene que dejar la fila limpia.
--
-- discard_stock_drafts tocaba 3 columnas de 11:
--   draft_min = COALESCE(min_units,0), draft_max = COALESCE(max_units,0),
--   draft_status = 'none'
-- y dejaba intactas draft_abc_class, draft_velocity, draft_velocity_30d,
-- draft_cv, draft_demand_variability, draft_units_sold, draft_revenue,
-- draft_data_days y draft_calculated_at. De ahi salen las 7,605 filas con
-- residuo de borrador: el badge ABC y la velocidad de un borrador DESCARTADO
-- seguian mostrandose como si fueran los vigentes.
--
-- Ademas copiaba el par publicado a las columnas de borrador, que es justo lo
-- que fabrica el residuo (y lo que podia chocar contra psp_draft_pair_valid).
-- Ahora las anula: es el mismo resultado en pantalla porque get_stock_analysis
-- cierra con `COALESCE(..., 0)`.
--
-- ══ EL BACKFILL NO PUEDE SER "ANULAR LAS 9 COLUMNAS" ══
--
-- El plan pedia anular el residuo de las filas existentes. Medido antes de
-- hacerlo: NO se puede a ciegas. get_stock_analysis usa las columnas de
-- borrador como FALLBACK de lectura, sin mirar draft_status:
--
--   minmax_effective(COALESCE(psp.min_units, psp.draft_min, 0), psp.manual_min)
--   COALESCE(psp.daily_velocity, psp.draft_velocity)
--   COALESCE(psp.units_sold_6m,  psp.draft_units_sold)
--
-- O sea que para una fila nunca publicada (columna viva en NULL) el borrador es
-- el UNICO dato que hay. Anularlo a ciegas hubiera blanqueado:
--   · 1,325 filas que pasarian a mostrar MIN 0
--   · 1,317 idem con MAX
--   · 4,456 que perderian la velocidad y las unidades vendidas
--   · 2,550 que perderian el badge ABC
-- ...sin que nadie hubiera descartado nada.
--
-- Asi que el backfill anula CADA columna de borrador solo si su columna viva ya
-- tiene valor — o sea, solo la copia redundante. Cambio visible: cero, y se
-- verifica comparando la salida de get_stock_analysis antes y despues.
--
-- Lo que queda (filas con la columna viva en NULL y borrador con datos, casi
-- todas ex-'sparse_data') se limpia solo: el reset de F2.5 las pone en 'none'
-- con los draft_* en NULL en el proximo recalculo de su sucursal, que es
-- correcto — un producto sin NINGUNA venta en la ventana no deberia seguir
-- mostrando la velocidad que tuvo en junio.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.discard_stock_drafts(p_erp_sucursal_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  UPDATE product_stock_params
  SET
    draft_min                = NULL,
    draft_max                = NULL,
    draft_abc_class          = NULL,
    draft_velocity           = NULL,
    draft_velocity_30d       = NULL,
    draft_cv                 = NULL,
    draft_demand_variability = NULL,
    draft_units_sold         = NULL,
    draft_revenue            = NULL,
    draft_data_days          = NULL,
    draft_calculated_at      = NULL,
    draft_status             = 'none',
    updated_at               = now()
  WHERE erp_sucursal_id = p_erp_sucursal_id
    AND draft_status IN ('pending', 'sparse_data');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.discard_stock_drafts(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.discard_stock_drafts(integer) TO authenticated, service_role;


-- Backfill quirurgico: cada columna de borrador se anula SOLO si su columna
-- viva ya tiene el dato. Nunca se borra el unico valor que existe.
UPDATE public.product_stock_params
SET
  draft_min                = CASE WHEN min_units          IS NOT NULL THEN NULL ELSE draft_min END,
  draft_max                = CASE WHEN max_units          IS NOT NULL THEN NULL ELSE draft_max END,
  draft_abc_class          = CASE WHEN abc_class          IS NOT NULL THEN NULL ELSE draft_abc_class END,
  draft_velocity           = CASE WHEN daily_velocity     IS NOT NULL THEN NULL ELSE draft_velocity END,
  draft_velocity_30d       = CASE WHEN velocity_30d       IS NOT NULL THEN NULL ELSE draft_velocity_30d END,
  draft_cv                 = CASE WHEN cv                 IS NOT NULL THEN NULL ELSE draft_cv END,
  draft_demand_variability = CASE WHEN demand_variability IS NOT NULL THEN NULL ELSE draft_demand_variability END,
  draft_units_sold         = CASE WHEN units_sold_6m      IS NOT NULL THEN NULL ELSE draft_units_sold END,
  draft_revenue            = CASE WHEN revenue_6m         IS NOT NULL THEN NULL ELSE draft_revenue END,
  draft_data_days          = CASE WHEN data_days          IS NOT NULL THEN NULL ELSE draft_data_days END,
  draft_calculated_at      = CASE WHEN calculated_at      IS NOT NULL THEN NULL ELSE draft_calculated_at END
WHERE draft_status IS DISTINCT FROM 'pending'
  AND (
       (min_units          IS NOT NULL AND draft_min                IS NOT NULL)
    OR (max_units          IS NOT NULL AND draft_max                IS NOT NULL)
    OR (abc_class          IS NOT NULL AND draft_abc_class          IS NOT NULL)
    OR (daily_velocity     IS NOT NULL AND draft_velocity           IS NOT NULL)
    OR (velocity_30d       IS NOT NULL AND draft_velocity_30d       IS NOT NULL)
    OR (cv                 IS NOT NULL AND draft_cv                 IS NOT NULL)
    OR (demand_variability IS NOT NULL AND draft_demand_variability IS NOT NULL)
    OR (units_sold_6m      IS NOT NULL AND draft_units_sold         IS NOT NULL)
    OR (revenue_6m         IS NOT NULL AND draft_revenue            IS NOT NULL)
    OR (data_days          IS NOT NULL AND draft_data_days          IS NOT NULL)
    OR (calculated_at      IS NOT NULL AND draft_calculated_at      IS NOT NULL)
  );
