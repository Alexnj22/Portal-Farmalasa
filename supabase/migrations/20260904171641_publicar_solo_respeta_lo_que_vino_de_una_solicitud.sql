SET lock_timeout = '5s';

-- Qué frena al barrido de publicar, y qué no.
--
-- Antes: `manual_at IS NULL`, o sea que CUALQUIER edición a mano congelaba la
-- fila para siempre. Medido el 2026-09-04: de las 416 filas con borrador
-- frenado, 365 eran la revisión de agosto (hecha entre el 3 y el 11, con el
-- recálculo del día 1) y NINGUNA traía motivo declarado. Congelar la revisión
-- de un mes contra el cálculo del siguiente no es proteger una decisión: es
-- volver permanente algo que se hizo para ese ciclo. Y como el recálculo salta
-- la sala entera si tiene pendientes, dos salas iban a quedarse sin recalcular
-- en silencio.
--
-- Ahora: frena `ajuste_solicitud_id` (alguien lo pidió, escribió por qué y otra
-- persona lo aprobó) o `manual_motivo` (alguien declaró que este producto es una
-- excepción, y el cálculo YA usa ese motivo — «lo buscan» como piso, «cliente
-- fijo» como demanda, «ya no rota» como fecha de corte). Las dos son decisiones
-- que nadie volvió a mirar y que el cálculo no puede deducir.
CREATE OR REPLACE FUNCTION public.publish_stock_params(
  p_erp_sucursal_id integer DEFAULT NULL::integer,
  p_erp_product_ids integer[] DEFAULT NULL::integer[],
  p_published_by text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count        INTEGER;
  v_bodega_count INTEGER := 0;
  v_omitidas     INTEGER := 0;
  v_now          TIMESTAMPTZ := NOW();
  v_publisher    TEXT := (SELECT auth.email());
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos']))
     AND (p_erp_sucursal_id IS NULL
          OR p_erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id())) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: tu permiso es solo para tu sucursal';
  END IF;

  -- Cuántas deja quietas el barrido por ser una decisión sellada. Se cuenta
  -- ANTES de publicar para poder decirlo: una publicación que calla lo que no
  -- hizo se lee como "publicó todo".
  IF p_erp_product_ids IS NULL THEN
    SELECT COUNT(*) INTO v_omitidas
    FROM product_stock_params psp
    WHERE psp.draft_status     = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (psp.ajuste_solicitud_id IS NOT NULL OR psp.manual_motivo IS NOT NULL)
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id);
  END IF;

  WITH par_ordenado AS (
    SELECT
      psp.id,
      LEAST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0))    AS lo,
      GREATEST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0)) AS hi
    FROM product_stock_params psp
    WHERE psp.draft_status     = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND (p_erp_product_ids IS NULL OR psp.erp_product_id  = ANY(p_erp_product_ids))
      -- El BARRIDO no pisa una DECISIÓN —una solicitud aprobada, o un motivo
      -- declarado—; la publicación DIRIGIDA a productos concretos sí, porque
      -- alguien los eligió uno por uno. Una edición a mano de la revisión del
      -- mes no es ninguna de las dos y se publica como cualquier otra.
      AND (p_erp_product_ids IS NOT NULL
           OR (psp.ajuste_solicitud_id IS NULL AND psp.manual_motivo IS NULL))
  ),
  con_min AS (
    SELECT id, hi, GREATEST(lo, CASE WHEN hi > 1 THEN 1 ELSE 0 END) AS n_min
    FROM par_ordenado
  ),
  par AS (
    SELECT id, n_min,
           CASE WHEN n_min >= 1 THEN GREATEST(hi, n_min + 1) ELSE hi END AS n_max
    FROM con_min
  ),
  published AS (
    UPDATE product_stock_params psp
    SET
      abc_class                = psp.draft_abc_class,
      daily_velocity           = psp.draft_velocity,
      velocity_30d             = psp.draft_velocity_30d,
      cv                       = psp.draft_cv,
      demand_variability       = psp.draft_demand_variability,
      min_units                = par.n_min,
      max_units                = par.n_max,
      units_sold_6m            = psp.draft_units_sold,
      revenue_6m               = psp.draft_revenue,
      data_days                = psp.draft_data_days,
      calculated_at            = psp.draft_calculated_at,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_abc_class          = NULL,
      draft_demand_variability = NULL,
      draft_cv                 = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      published_at             = v_now,
      published_by             = v_publisher,
      updated_at               = v_now
    FROM par
    WHERE par.id = psp.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM published;

  IF p_erp_sucursal_id IS DISTINCT FROM 6 THEN
    WITH branch_sums AS (
      SELECT
        s.erp_product_id,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_min ELSE s.min_units END, 0))::integer AS eff_min,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_max ELSE s.max_units END, 0))::integer AS eff_max,
        SUM(COALESCE(s.min_units, 0))::integer AS pub_min,
        SUM(COALESCE(s.max_units, 0))::integer AS pub_max
      FROM product_stock_params s
      WHERE s.erp_sucursal_id != 6
        AND s.is_hidden IS NOT TRUE
        AND (p_erp_product_ids IS NULL OR s.erp_product_id = ANY(p_erp_product_ids))
      GROUP BY s.erp_product_id
      HAVING
        SUM(COALESCE(s.min_units, 0)) > 0
        OR SUM(COALESCE(s.max_units, 0)) > 0
        OR EXISTS (
          SELECT 1 FROM product_stock_params b
          WHERE b.erp_sucursal_id = 6
            AND b.erp_product_id  = s.erp_product_id
            AND b.draft_status    = 'pending'
        )
    ),
    -- La escalera, IDÉNTICA para los dos pares (es la de
    -- `sync_bodega_draft_from_branch_stmt`): primero el MIN sube a 1 si el MAX
    -- pasa de 1, después el MAX sube a MIN+1 si el MIN llegó a 1. Sale siempre
    -- un par que cumple `chk_min_lt_max` y `psp_draft_pair_valid`.
    bodega_min AS (
      SELECT
        erp_product_id,
        GREATEST(eff_min, CASE WHEN eff_max > 1 THEN 1 ELSE 0 END) AS d_min,
        eff_max,
        GREATEST(pub_min, CASE WHEN pub_max > 1 THEN 1 ELSE 0 END) AS n_min,
        pub_max
      FROM branch_sums
    ),
    bodega AS (
      SELECT
        erp_product_id,
        d_min,
        CASE WHEN d_min >= 1 THEN GREATEST(eff_max, d_min + 1) ELSE eff_max END AS d_max,
        n_min,
        CASE WHEN n_min >= 1 THEN GREATEST(pub_max, n_min + 1) ELSE pub_max END AS n_max
      FROM bodega_min
    )
    INSERT INTO product_stock_params AS psp (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_min, draft_max, draft_status,
      published_at, published_by, updated_at
    )
    SELECT
      erp_product_id, 6,
      n_min,
      n_max,
      CASE WHEN d_min != n_min OR d_max != n_max THEN d_min ELSE NULL END,
      CASE WHEN d_min != n_min OR d_max != n_max THEN d_max ELSE NULL END,
      CASE WHEN d_min != n_min OR d_max != n_max THEN 'pending' ELSE 'none' END,
      v_now, v_publisher, v_now
    FROM bodega
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units    = EXCLUDED.min_units,
      max_units    = EXCLUDED.max_units,
      draft_min    = EXCLUDED.draft_min,
      draft_max    = EXCLUDED.draft_max,
      draft_status = EXCLUDED.draft_status,
      published_at = EXCLUDED.published_at,
      published_by = EXCLUDED.published_by,
      updated_at   = EXCLUDED.updated_at
    WHERE psp.is_hidden IS NOT TRUE
      AND (psp.min_units, psp.max_units, psp.draft_min, psp.draft_max, psp.draft_status)
       IS DISTINCT FROM
          (EXCLUDED.min_units, EXCLUDED.max_units, EXCLUDED.draft_min, EXCLUDED.draft_max, EXCLUDED.draft_status);

    GET DIAGNOSTICS v_bodega_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',                        true,
    'published',                 v_count,
    'bodega_updated',            v_bodega_count,
    'omitidas_por_ajuste_manual', v_omitidas,
    'at',                        v_now
  );
END;
$function$;
