-- F1.2 — Defensa en profundidad: que un par MIN/MAX invalido no pueda existir.
--
-- El fix del cliente (F1.1, ArrowLeft desde MAX) cierra EL camino conocido.
-- Esto cierra la clase entera, en los tres lugares donde el par se escribe:
--
--   a) CHECK sobre las columnas de borrador, alineado con chk_min_lt_max.
--   b) sync_bodega_draft_from_branch_stmt: la Σ de Bodega nunca puede quedar
--      con MAX <= MIN.
--   c) publish_stock_params: normalizar el PAR, en vez de derivar MIN y MAX
--      por separado con reglas que se contradicen entre si.
--
-- Bug reproducido contra prod (BEGIN…ROLLBACK) antes de esto:
--   CASO2 [draft_min=12, draft_max=12] guardaba OK y el publish ABORTABA EL
--   LOTE ENTERO por chk_min_lt_max — una celda mal editada dejaba sin publicar
--   a toda la sucursal.
--
-- (a) LAS 4 FILAS QUE EL PLAN DABA POR 0. El plan decia "hoy 0 filas violarian
-- el CHECK nuevo (verificado)". Son 4: erp_product_id 121/1924/3904/4718 en
-- Salud 1, todas draft_min=1 draft_max=1 con draft_status='none' desde el
-- 2026-06-19. Es residuo de borrador descartado (el bug F2.4: discard limpia
-- 3 de las 9 columnas draft_*), no un borrador vivo — con draft_status='none'
-- nadie las lee: ni la UI (hasDraft = draft_status==='pending'), ni el trigger
-- de Bodega, ni publish. Se anulan aca porque si no, el VALIDATE falla.
-- El resto del residuo (4,258 filas con par de borrador y draft_status<>'pending')
-- es valido para el CHECK y se limpia en F2.4.
--
-- NOTA: el orden importa. Primero se limpian las 4 filas y se reemplazan los
-- dos escritores (trigger de Bodega y publish); el CHECK va AL FINAL, cuando ya
-- nadie puede producir un par invalido.

SET lock_timeout = '5s';

UPDATE public.product_stock_params
SET draft_min = NULL, draft_max = NULL
WHERE draft_status IS DISTINCT FROM 'pending'
  AND draft_min IS NOT NULL AND draft_max IS NOT NULL
  AND NOT ((draft_min = 0 AND draft_max <= 1) OR (draft_min >= 1 AND draft_max > draft_min));


-- (b) El trigger de Bodega.
--
-- Ya clampeaba el MIN hacia arriba (Σmin=0 con Σmax>1 ⇒ MIN=1) pero no el MAX:
-- si la Σ de MAX quedaba <= la Σ de MIN, el UPSERT violaba chk_min_lt_max y el
-- trigger abortaba... y con el, la escritura de la SUCURSAL que lo disparo.
-- Por eso CASO1 se veia como "rechazado al guardar por psp_draft_max_gte_min".
--
-- Aca se LEVANTA el MAX, no se ordena el par: estas dos columnas son sumas de
-- sucursales, no dos casillas que alguien pudo haber llenado al reves.
--
-- (Esta version del trigger es la vigente en este punto de la historia; la
-- migracion 20260729_minmax_bodega_resync_desfase, del mismo dia, le agrega la
-- Σ publicada para que una fila de Bodega no nazca con min_units en NULL.)

CREATE OR REPLACE FUNCTION public.sync_bodega_draft_from_branch_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_product_ids integer[];
  v_count integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT erp_product_id) INTO v_product_ids
    FROM new_rows WHERE erp_sucursal_id != 6;
  ELSE
    SELECT array_agg(DISTINCT n.erp_product_id) INTO v_product_ids
    FROM new_rows n
    JOIN old_rows o ON o.id = n.id
    WHERE n.erp_sucursal_id != 6
      AND (o.draft_min IS DISTINCT FROM n.draft_min
        OR o.draft_max IS DISTINCT FROM n.draft_max
        OR o.draft_status IS DISTINCT FROM n.draft_status
        OR o.min_units IS DISTINCT FROM n.min_units
        OR o.max_units IS DISTINCT FROM n.max_units
        OR o.is_hidden IS DISTINCT FROM n.is_hidden);
  END IF;

  IF v_product_ids IS NULL OR array_length(v_product_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  WITH sums AS (
    SELECT psp.erp_product_id,
      SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min ELSE psp.min_units END, 0))::integer AS bodega_min,
      SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max ELSE psp.max_units END, 0))::integer AS bodega_max,
      BOOL_AND(COALESCE(psp.draft_status, 'none') IS DISTINCT FROM 'pending') AS all_published
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id != 6
      AND psp.erp_product_id = ANY(v_product_ids)
      AND psp.is_hidden IS NOT TRUE
    GROUP BY psp.erp_product_id
  ),
  clamped_min AS (
    SELECT erp_product_id,
      GREATEST(bodega_min, CASE WHEN bodega_max > 1 THEN 1 ELSE 0 END) AS bodega_min,
      bodega_max,
      all_published
    FROM sums
  ),
  clamped AS (
    -- Con MIN >= 1 el invariante exige MAX > MIN (chk_min_lt_max / psp_draft_pair_valid).
    -- Con MIN = 0, el clamp de arriba garantiza MAX <= 1, que ya es valido.
    SELECT erp_product_id,
      bodega_min,
      GREATEST(bodega_max, CASE WHEN bodega_min >= 1 THEN bodega_min + 1 ELSE 0 END) AS bodega_max,
      all_published
    FROM clamped_min
  ),
  live_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_status, draft_min, draft_max,
      draft_calculated_at, updated_at
    )
    SELECT erp_product_id, 6, bodega_min, bodega_max, 'none', NULL, NULL, NOW(), NOW()
    FROM clamped WHERE all_published
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units           = EXCLUDED.min_units,
      max_units            = EXCLUDED.max_units,
      draft_status        = 'none',
      draft_min           = NULL,
      draft_max           = NULL,
      draft_calculated_at = EXCLUDED.draft_calculated_at,
      updated_at           = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  ),
  pending_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_min, draft_max, draft_status, draft_calculated_at, updated_at
    )
    SELECT erp_product_id, 6, bodega_min, bodega_max, 'pending', NOW(), NOW()
    FROM clamped WHERE NOT all_published
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      draft_min           = EXCLUDED.draft_min,
      draft_max           = EXCLUDED.draft_max,
      draft_status        = 'pending',
      draft_calculated_at = EXCLUDED.draft_calculated_at,
      updated_at           = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  )
  SELECT (SELECT count(*) FROM live_upsert) + (SELECT count(*) FROM pending_upsert) INTO v_count;

  RETURN NULL;
END;
$function$;


-- (c) publish_stock_params: normalizar el PAR.
--
-- Antes, MIN y MAX se derivaban por separado con dos reglas incompatibles:
--   min_units = GREATEST(LEAST(m, M), CASE WHEN M > 1 THEN 1 ELSE 0 END)  -- baja el MIN
--   max_units = GREATEST(M, m)                                            -- sube el MAX
-- Con m=M=12 daba (12,12) → chk_min_lt_max lo rechaza → ABORTA EL LOTE.
--
-- Ahora es un solo CTE que garantiza el invariante (m=0 ∧ M<=1) ∨ (m>=1 ∧ M>m):
--   1. se ordena el par (lo, hi) — un par invertido es un campo escrito al
--      reves, y ordenarlo es lo que la version anterior ya hacia de hecho;
--   2. MIN = GREATEST(lo, 1 si hi>1) — sube el MIN, nunca aplasta el MAX;
--   3. MAX = GREATEST(hi, MIN+1) cuando MIN>=1 — separa el par por 1.
--
-- Propiedad verificada sobre los 81 pares posibles de un grid con NULLs: para
-- TODO par que hoy produce un resultado valido (61 de 81), el resultado es
-- identico. Solo difiere en los 20 donde hoy el publish se cae.
--
-- El bloque de Bodega usa la misma idea pero levantando el MAX sin ordenar,
-- por lo mismo que el trigger: son sumas.
--
-- (Esta version es la vigente en este punto; la migracion
-- 20260729_minmax_f2_historial_datadays_sparse le quita el INSERT al historial
-- (F2.1) y le agrega el filtro de ocultos en branch_sums (F2.8).)

CREATE OR REPLACE FUNCTION public.publish_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[], p_published_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count        INTEGER;
  v_bodega_count INTEGER := 0;
  v_now          TIMESTAMPTZ := NOW();
  v_publisher    TEXT := (SELECT auth.email());
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
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
    RETURNING
      psp.erp_product_id, psp.erp_sucursal_id,
      psp.min_units, psp.max_units, psp.daily_velocity, psp.velocity_30d,
      psp.abc_class, psp.demand_variability, psp.cv, psp.calculated_at
  )
  INSERT INTO product_stock_params_history (
    erp_product_id, erp_sucursal_id, captured_at,
    min_units, max_units, daily_velocity, velocity_30d,
    abc_class, demand_variability, cv, calculated_at
  )
  SELECT
    erp_product_id, erp_sucursal_id, v_now,
    min_units, max_units, daily_velocity, velocity_30d,
    abc_class, demand_variability, cv, calculated_at
  FROM published;

  GET DIAGNOSTICS v_count = ROW_COUNT;

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
    bodega_min AS (
      SELECT
        erp_product_id, eff_min, eff_max, pub_min, pub_max,
        GREATEST(pub_min, CASE WHEN pub_max > 1 THEN 1 ELSE 0 END) AS n_min
      FROM branch_sums
    ),
    bodega AS (
      SELECT
        erp_product_id, eff_min, eff_max, pub_min, pub_max, n_min,
        GREATEST(pub_max, CASE WHEN n_min >= 1 THEN n_min + 1 ELSE 0 END) AS n_max
      FROM bodega_min
    )
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_min, draft_max, draft_status,
      published_at, published_by, updated_at
    )
    SELECT
      erp_product_id, 6,
      n_min,
      n_max,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_min ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_max ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN 'pending' ELSE 'none' END,
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
    WHERE product_stock_params.is_hidden IS NOT TRUE;

    GET DIAGNOSTICS v_bodega_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'published',      v_count,
    'bodega_updated', v_bodega_count,
    'at',             v_now
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) TO authenticated, service_role;


-- (a) El CHECK, ahora que los tres escritores no pueden producir un par invalido.
--
-- Reemplaza psp_draft_max_gte_min (max >= min, deja pasar max = min) por el
-- MISMO predicado que chk_min_lt_max ya impone sobre min_units/max_units.
-- NOT VALID + VALIDATE a proposito: si entre la verificacion y esta migracion
-- aparece una fila mala, falla el VALIDATE (sin lock exclusivo tomado) y no el
-- ALTER.
--
-- NO se toca psp_manual_max_gte_min: manual_min/manual_max de Bodega guardan un
-- DELTA sobre la Σ de sucursales, no un par MIN/MAX — el invariante no aplica.

ALTER TABLE public.product_stock_params DROP CONSTRAINT IF EXISTS psp_draft_max_gte_min;

ALTER TABLE public.product_stock_params
  ADD CONSTRAINT psp_draft_pair_valid CHECK (
    draft_min IS NULL
    OR draft_max IS NULL
    OR (draft_min = 0  AND draft_max <= 1)
    OR (draft_min >= 1 AND draft_max > draft_min)
  ) NOT VALID;

ALTER TABLE public.product_stock_params VALIDATE CONSTRAINT psp_draft_pair_valid;
