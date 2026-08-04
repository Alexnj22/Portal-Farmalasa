-- Dos correcciones a Ventas > Productos (continuación de 20260804004950):
--
-- 1. ÚLTIMA VENTA EXACTA. El agregado mensual no guardaba el día de la última
--    venta, así que para todo producto sin ventas en el mes en curso la vista
--    mostraba el ÚLTIMO DÍA del último mes con ventas (hasta ~30 días de
--    optimismo, y movía los umbrales de color de 180/365 días). Ahora
--    product_sales_monthly_agg lleva `ultima_venta` (MAX(si.fecha) del grupo),
--    rebuild/refresh la mantienen, y get_product_sales_agg la usa con fallback
--    al fin de mes para filas aún sin backfill.
--
-- 2. MAPEO DE SUCURSALES DESDE LA TABLA. branch_to_erp era un VALUES harcodeado
--    dentro del RPC — un duplicado a mano de erp_sucursal_map (verificado
--    idéntico: 4→1, 25→2, 27→3, 28→4, 2→5, 29→7). Ahora sale de la tabla,
--    excluyendo es_bodega (la Bodega no vende; el harcodeo la omitía).

SET lock_timeout = '5s';

ALTER TABLE public.product_sales_monthly_agg
  ADD COLUMN IF NOT EXISTS ultima_venta date;

-- ─────────────────────────────────────────────────────────────────────────────
-- rebuild: reconstruye meses cerrados, ahora con ultima_venta
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rebuild_product_sales_monthly_agg(p_desde date, p_hasta date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_curr_month date;
    v_desde      date;
    v_hasta      date;
    v_written    integer;
BEGIN
    v_curr_month := date_trunc('month', CURRENT_DATE)::date;
    v_desde      := date_trunc('month', p_desde)::date;
    -- El mes EN CURSO nunca entra, y no es un detalle: la tabla significa "meses
    -- cerrados" y sus consumidores cuentan con eso. `get_product_sales_agg`
    -- toma la última venta histórica de la columna `ultima_venta` (el mes en
    -- curso lo cubre aparte con un scan en vivo), y los tres RPC de Pedidos
    -- suman `year_month >= hace 6 meses` sin tope superior, así que un mes a
    -- medio andar se les colaría en la demanda.
    v_hasta      := LEAST(date_trunc('month', p_hasta)::date,
                          (v_curr_month - interval '1 month')::date);
    IF v_desde > v_hasta THEN
        RETURN 0;
    END IF;

    WITH fresh AS (
        SELECT to_char(si.fecha, 'YYYY-MM')   AS year_month,
               si.branch_id,
               sii.erp_product_id,
               COALESCE(sii.presentacion, '') AS presentacion,
               MAX(sii.descripcion)           AS descripcion,
               SUM(sii.cantidad::numeric)     AS cantidad,
               SUM(CASE WHEN si.tipo_documento = 'CCF'
                        THEN sii.total_linea::numeric
                        ELSE sii.total_linea::numeric / 1.13
                   END)                       AS neto,
               MAX(si.fecha)                  AS ultima_venta
        FROM public.sales_invoice_items sii
        JOIN public.sales_invoices si ON si.id = sii.invoice_id
        WHERE sii.erp_product_id IS NOT NULL
          AND sii.erp_product_id <> 0
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
          AND si.fecha >= v_desde
          AND si.fecha <  (v_hasta + interval '1 month')::date
        GROUP BY 1, 2, 3, 4
    ),
    del AS (
        -- Las filas que la tabla tiene y las ventas ya no: una factura anulada
        -- después de agregarla, o una línea que el sincronizador corrigió.
        DELETE FROM public.product_sales_monthly_agg a
        WHERE a.year_month >= to_char(v_desde, 'YYYY-MM')
          AND a.year_month <= to_char(v_hasta, 'YYYY-MM')
          AND NOT EXISTS (SELECT 1 FROM fresh f
                          WHERE f.year_month     = a.year_month
                            AND f.branch_id      = a.branch_id
                            AND f.erp_product_id = a.erp_product_id
                            AND f.presentacion   = a.presentacion)
        RETURNING 1
    ),
    ins AS (
        INSERT INTO public.product_sales_monthly_agg
            (year_month, branch_id, erp_product_id, presentacion, descripcion, cantidad, neto, ultima_venta)
        SELECT year_month, branch_id, erp_product_id, presentacion, descripcion, cantidad, neto, ultima_venta
        FROM fresh
        ON CONFLICT (year_month, branch_id, erp_product_id, presentacion) DO UPDATE
        SET descripcion  = EXCLUDED.descripcion,
            cantidad     = EXCLUDED.cantidad,
            neto         = EXCLUDED.neto,
            ultima_venta = EXCLUDED.ultima_venta
        WHERE (product_sales_monthly_agg.descripcion, product_sales_monthly_agg.cantidad, product_sales_monthly_agg.neto, product_sales_monthly_agg.ultima_venta)
              IS DISTINCT FROM (EXCLUDED.descripcion, EXCLUDED.cantidad, EXCLUDED.neto, EXCLUDED.ultima_venta)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM del) + (SELECT count(*) FROM ins) INTO v_written;

    RETURN v_written;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- refresh incremental: igual, con ultima_venta
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_product_sales_monthly_agg(p_months_back integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_curr_month     date;
    v_from_date      date;
    v_watermark      timestamptz;
    v_new_watermark  timestamptz;
    v_written        integer;
    v_mes_marcado    date;
    v_reconstruidas  integer := 0;
BEGIN
    v_curr_month := date_trunc('month', CURRENT_DATE)::date;
    v_from_date  := (v_curr_month - (p_months_back || ' months')::interval)::date;

    -- ── Barrido de cierre de mes ───────────────────────────────────────────
    -- Va ANTES del corte por marca de agua de abajo: si el mes cambió hay que
    -- reconstruirlo aunque no haya nada nuevo que procesar.
    --
    -- Se guarda el mes en curso, no una fecha de "último barrido", para que el
    -- criterio sea el cambio de mes y no el paso del tiempo: si el cron estuvo
    -- caído dos meses, reconstruye los dos.
    SELECT (watermark AT TIME ZONE 'UTC')::date INTO v_mes_marcado
    FROM public.job_watermarks
    WHERE job_name = 'refresh_product_sales_monthly_agg:mes_en_curso';

    IF v_mes_marcado IS NOT NULL AND v_mes_marcado < v_curr_month THEN
        v_reconstruidas := public.rebuild_product_sales_monthly_agg(
            v_mes_marcado, (v_curr_month - interval '1 month')::date);
    END IF;

    IF v_mes_marcado IS DISTINCT FROM v_curr_month THEN
        INSERT INTO public.job_watermarks (job_name, watermark, updated_at)
        VALUES ('refresh_product_sales_monthly_agg:mes_en_curso',
                (v_curr_month::timestamp AT TIME ZONE 'UTC'), now())
        ON CONFLICT (job_name) DO UPDATE
        SET watermark = EXCLUDED.watermark, updated_at = now();
    END IF;

    -- ── Pasada incremental ─────────────────────────────────────────────────
    SELECT watermark INTO v_watermark
    FROM public.job_watermarks
    WHERE job_name = 'refresh_product_sales_monthly_agg';

    IF v_watermark IS NULL THEN
        v_watermark := v_from_date::timestamptz;
    END IF;

    v_new_watermark := now() - interval '15 minutes';

    IF v_new_watermark <= v_watermark THEN
        RETURN v_reconstruidas;
    END IF;

    WITH touched_invoices AS (
        SELECT si.id, si.fecha, si.branch_id
        FROM public.sales_invoices si
        WHERE si.updated_at > v_watermark
          AND si.updated_at <= v_new_watermark
          AND si.fecha >= v_from_date
          AND si.fecha <  v_curr_month
    ),
    affected_keys AS (
        SELECT DISTINCT
            to_char(ti.fecha, 'YYYY-MM')       AS year_month,
            ti.branch_id,
            sii.erp_product_id,
            COALESCE(sii.presentacion, '')     AS presentacion
        FROM public.sales_invoice_items sii
        JOIN touched_invoices ti ON ti.id = sii.invoice_id
        WHERE sii.erp_product_id IS NOT NULL
          AND sii.erp_product_id != 0
    ),
    fresh AS (
        SELECT
            to_char(si.fecha, 'YYYY-MM')       AS year_month,
            si.branch_id,
            sii.erp_product_id,
            COALESCE(sii.presentacion, '')     AS presentacion,
            MAX(sii.descripcion)               AS descripcion,
            SUM(sii.cantidad::numeric)         AS cantidad,
            SUM(CASE WHEN si.tipo_documento = 'CCF'
                     THEN sii.total_linea::numeric
                     ELSE sii.total_linea::numeric / 1.13
                END)                           AS neto,
            MAX(si.fecha)                      AS ultima_venta
        FROM public.sales_invoice_items sii
        JOIN public.sales_invoices si ON si.id = sii.invoice_id
        JOIN affected_keys ak
          ON ak.year_month    = to_char(si.fecha, 'YYYY-MM')
         AND ak.branch_id     = si.branch_id
         AND ak.erp_product_id = sii.erp_product_id
         AND ak.presentacion  = COALESCE(sii.presentacion, '')
        WHERE sii.erp_product_id IS NOT NULL
          AND sii.erp_product_id != 0
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
          AND si.fecha >= v_from_date
          AND si.fecha <  v_curr_month
        GROUP BY 1, 2, 3, 4
    ),
    del AS (
        DELETE FROM public.product_sales_monthly_agg a
        WHERE (a.year_month, a.branch_id, a.erp_product_id, a.presentacion) IN
              (SELECT year_month, branch_id, erp_product_id, presentacion FROM affected_keys)
          AND NOT EXISTS (SELECT 1 FROM fresh f
                          WHERE f.year_month     = a.year_month
                            AND f.branch_id      = a.branch_id
                            AND f.erp_product_id = a.erp_product_id
                            AND f.presentacion   = a.presentacion)
        RETURNING 1
    ),
    ins AS (
        INSERT INTO public.product_sales_monthly_agg
            (year_month, branch_id, erp_product_id, presentacion, descripcion, cantidad, neto, ultima_venta)
        SELECT year_month, branch_id, erp_product_id, presentacion, descripcion, cantidad, neto, ultima_venta
        FROM fresh
        ON CONFLICT (year_month, branch_id, erp_product_id, presentacion) DO UPDATE
        SET descripcion  = EXCLUDED.descripcion,
            cantidad     = EXCLUDED.cantidad,
            neto         = EXCLUDED.neto,
            ultima_venta = EXCLUDED.ultima_venta
        WHERE (product_sales_monthly_agg.descripcion, product_sales_monthly_agg.cantidad, product_sales_monthly_agg.neto, product_sales_monthly_agg.ultima_venta)
              IS DISTINCT FROM (EXCLUDED.descripcion, EXCLUDED.cantidad, EXCLUDED.neto, EXCLUDED.ultima_venta)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM del) + (SELECT count(*) FROM ins) INTO v_written;

    INSERT INTO public.job_watermarks (job_name, watermark, updated_at)
    VALUES ('refresh_product_sales_monthly_agg', v_new_watermark, now())
    ON CONFLICT (job_name) DO UPDATE SET watermark = EXCLUDED.watermark, updated_at = now();

    RETURN v_written + v_reconstruidas;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_product_sales_agg: ultima_venta exacta + mapeo desde erp_sucursal_map
-- (solo cambian branch_to_erp y last_sale_hist; el resto es idéntico a
-- 20260804004950)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_search text DEFAULT NULL::text)
 RETURNS TABLE(erp_product_id integer, descripcion text, cantidad numeric, neto numeric, costo_total numeric, presentaciones jsonb, ultima_venta date, ultima_venta_por_suc jsonb, laboratorio_id integer, laboratorio_nombre text, oculto_en_ventas boolean, oculto_por_first_names text, oculto_por_last_names text, oculto_at timestamp with time zone)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
WITH
-- El mapeo canónico vive en erp_sucursal_map (antes era un VALUES harcodeado,
-- duplicado a mano de esa tabla). Bodega afuera: no vende, y el harcodeo la
-- omitía — mantiene la semántica de "sin candidatos sin-venta" para ids raros.
branch_esid AS (
  SELECT m.erp_sucursal_id AS esid
  FROM public.erp_sucursal_map m
  WHERE m.branch_id = p_branch_id AND NOT m.es_bodega
),

bounds AS (
  SELECT
    date_trunc('month', CURRENT_DATE)::date AS curr_month,
    LEAST(p_ffin, date_trunc('month', CURRENT_DATE)::date - 1) AS past_to
),
-- Ventana de meses COMPLETOS (va al agregado mensual) + borde parcial
-- IZQUIERDO como rango de fechas. Un rango degenerado (from > to o NULL)
-- no devuelve filas — así los meses completos no se escanean en vivo.
bounds2 AS (
  SELECT curr_month, past_to,
    CASE WHEN p_fini = date_trunc('month', p_fini)::date
         THEN to_char(p_fini, 'YYYY-MM')
         ELSE to_char((date_trunc('month', p_fini) + interval '1 month')::date, 'YYYY-MM') END AS ym_full_from,
    CASE WHEN past_to = (date_trunc('month', past_to) + interval '1 month' - interval '1 day')::date
         THEN to_char(past_to, 'YYYY-MM')
         ELSE to_char((date_trunc('month', past_to) - interval '1 month')::date, 'YYYY-MM') END AS ym_full_to,
    CASE WHEN p_fini < curr_month AND p_fini <> date_trunc('month', p_fini)::date
         THEN p_fini END AS pl_from,
    CASE WHEN p_fini < curr_month AND p_fini <> date_trunc('month', p_fini)::date
         THEN LEAST(past_to, (date_trunc('month', p_fini) + interval '1 month' - interval '1 day')::date) END AS pl_to
  FROM bounds
),
-- Borde parcial DERECHO. GREATEST con pl_to+1 evita contar dos veces cuando
-- ambos bordes caen en el mismo mes; con p_fini cubre el caso p_fini=inicio
-- de mes con past_to a medio mismo mes (ahí el borde izquierdo no existe).
bounds3 AS (
  SELECT b.*,
    CASE WHEN p_fini < b.curr_month
              AND b.past_to <> (date_trunc('month', b.past_to) + interval '1 month' - interval '1 day')::date
         THEN GREATEST(date_trunc('month', b.past_to)::date, p_fini, COALESCE(b.pl_to + 1, p_fini)) END AS pr_from,
    CASE WHEN p_fini < b.curr_month
              AND b.past_to <> (date_trunc('month', b.past_to) + interval '1 month' - interval '1 day')::date
         THEN b.past_to END AS pr_to
  FROM bounds2 b
),

pres_partial AS (
  SELECT
    s.erp_product_id,
    MAX(s.descripcion) AS descripcion,
    s.presentacion,
    SUM(s.cantidad)    AS cantidad,
    SUM(s.neto)        AS neto
  FROM (
    SELECT
      sii.erp_product_id, sii.descripcion, sii.presentacion,
      sii.cantidad::numeric AS cantidad,
      CASE WHEN si.tipo_documento = 'CCF'
           THEN sii.total_linea::numeric
           ELSE sii.total_linea::numeric / 1.13
      END AS neto
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    CROSS JOIN bounds3 b
    WHERE si.fecha BETWEEN b.pl_from AND b.pl_to
      AND sii.erp_product_id IS NOT NULL
      AND sii.erp_product_id != 0
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND (p_search IS NULL OR p_search = '' OR public.norm_search(sii.descripcion) LIKE ALL (
            ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
          ))
    UNION ALL
    SELECT
      sii.erp_product_id, sii.descripcion, sii.presentacion,
      sii.cantidad::numeric AS cantidad,
      CASE WHEN si.tipo_documento = 'CCF'
           THEN sii.total_linea::numeric
           ELSE sii.total_linea::numeric / 1.13
      END AS neto
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    CROSS JOIN bounds3 b
    WHERE si.fecha BETWEEN b.pr_from AND b.pr_to
      AND sii.erp_product_id IS NOT NULL
      AND sii.erp_product_id != 0
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND (p_search IS NULL OR p_search = '' OR public.norm_search(sii.descripcion) LIKE ALL (
            ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
          ))
  ) s
  GROUP BY s.erp_product_id, s.presentacion
),

pres_past AS (
  SELECT
    a.erp_product_id,
    MAX(a.descripcion) AS descripcion,
    a.presentacion,
    SUM(a.cantidad)    AS cantidad,
    SUM(a.neto)        AS neto
  FROM public.product_sales_monthly_agg a
  CROSS JOIN bounds3 b
  WHERE p_fini < b.curr_month
    AND a.year_month >= b.ym_full_from
    AND a.year_month <= b.ym_full_to
    AND a.year_month <  to_char(b.curr_month, 'YYYY-MM')
    AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(a.descripcion) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
  GROUP BY a.erp_product_id, a.presentacion
),

pres_live AS (
  SELECT
    sii.erp_product_id,
    MAX(sii.descripcion)       AS descripcion,
    sii.presentacion,
    SUM(sii.cantidad::numeric) AS cantidad,
    SUM(CASE WHEN si.tipo_documento = 'CCF'
             THEN sii.total_linea::numeric
             ELSE sii.total_linea::numeric / 1.13
        END)                   AS neto
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha BETWEEN GREATEST(p_fini, date_trunc('month', CURRENT_DATE)::date) AND p_ffin
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(sii.descripcion) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
  GROUP BY sii.erp_product_id, sii.presentacion
),

-- El match por nombre presentación→product_precios resuelve factor Y costo de
-- la MISMA fila. El factor conserva su semántica aunque el costo de esa fila
-- esté sucio (costo > viñeta): la sanidad del costo se decide afuera.
pres AS (
  SELECT
    u2.erp_product_id,
    u2.descripcion,
    u2.presentacion,
    u2.cantidad,
    u2.neto,
    u2.precio_unitario_avg,
    COALESCE(m.factor, 1) AS factor,
    CASE WHEN m.costo IS NOT NULL AND (m.vineta = 0 OR m.costo <= m.vineta)
         THEN m.costo END AS costo_pres
  FROM (
    SELECT
      erp_product_id,
      MAX(descripcion) AS descripcion,
      presentacion,
      SUM(cantidad)    AS cantidad,
      SUM(neto)        AS neto,
      SUM(neto) / NULLIF(SUM(cantidad), 0) AS precio_unitario_avg
    FROM (
      SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_partial
      UNION ALL
      SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_past
      UNION ALL
      SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_live
    ) u
    GROUP BY erp_product_id, presentacion
  ) u2
  LEFT JOIN LATERAL (
    SELECT pp.factor, pp.costo, pp.vineta
    FROM public.product_precios pp
    JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
    WHERE pp.product_id = u2.erp_product_id
      AND pp.activo = true
      AND UPPER(u2.presentacion) LIKE UPPER(pr.tipo) || ' %'
    ORDER BY length(pr.tipo) DESC
    LIMIT 1
  ) m ON true
),

best_cost AS (
  SELECT
    product_id,
    COALESCE(
      MIN(costo) FILTER (WHERE vineta = 0 OR costo <= vineta),
      MIN(costo)
    ) AS costo
  FROM public.product_precios
  WHERE activo = true AND product_id IN (SELECT pres.erp_product_id FROM pres)
  GROUP BY product_id
),

prod_with_sales AS (
  SELECT
    p.erp_product_id,
    MAX(p.descripcion)  AS descripcion,
    SUM(p.cantidad)     AS cantidad,
    SUM(p.neto)         AS neto,
    -- Costo por la presentación VENDIDA; best_cost (mínimo sano del producto)
    -- solo de fallback cuando el nombre no matchea o la fila está sucia.
    CASE WHEN COUNT(COALESCE(p.costo_pres, bc.costo)) = 0 THEN NULL
         ELSE ROUND(SUM(COALESCE(p.costo_pres, bc.costo) * p.cantidad), 2) END AS costo_total,
    jsonb_agg(jsonb_build_object(
      'presentacion',        p.presentacion,
      'cantidad',            p.cantidad,
      'neto',                p.neto,
      'precio_unitario_avg', p.precio_unitario_avg,
      'factor',              COALESCE(p.factor, 1)
    )) AS presentaciones
  FROM pres p
  LEFT JOIN best_cost bc ON bc.product_id = p.erp_product_id
  GROUP BY p.erp_product_id
),

zero_sale_cands AS (
  SELECT pr.id AS erp_product_id, pr.nombre AS descripcion
  FROM public.products pr
  CROSS JOIN branch_esid be
  WHERE pr.activo = true
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(pr.nombre) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
    AND NOT EXISTS (SELECT 1 FROM prod_with_sales pws WHERE pws.erp_product_id = pr.id)
    AND (
      EXISTS (
        SELECT 1 FROM public.product_stock_params psp
        WHERE psp.erp_product_id = pr.id AND psp.erp_sucursal_id = be.esid
          AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
      )
      OR EXISTS (
        SELECT 1 FROM public.inventory inv
        WHERE inv.erp_product_id = pr.id AND inv.erp_sucursal_id = be.esid
          AND inv.is_vencidos = false AND inv.cantidad > 0
      )
    )
),

all_cands AS (
  SELECT pws.erp_product_id, pws.descripcion FROM prod_with_sales pws
  UNION ALL
  SELECT z.erp_product_id, z.descripcion FROM zero_sale_cands z
),

-- Restringido a los candidatos, y con el DÍA exacto: ultima_venta viene de la
-- columna del agregado (MAX(fecha) real del mes); el fin de mes queda solo de
-- fallback para filas viejas sin backfill.
last_sale_hist AS (
  SELECT
    a.erp_product_id AS prod_id, a.branch_id,
    MAX(COALESCE(a.ultima_venta,
                 ((a.year_month || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date)) AS last_date
  FROM public.product_sales_monthly_agg a
  WHERE a.erp_product_id IN (SELECT ac.erp_product_id FROM all_cands ac)
  GROUP BY a.erp_product_id, a.branch_id
),

last_sale_live AS (
  SELECT sii.erp_product_id AS prod_id, si.branch_id, MAX(si.fecha) AS last_date
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND sii.erp_product_id IN (SELECT ac.erp_product_id FROM all_cands ac)
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha >= date_trunc('month', CURRENT_DATE)::date
  GROUP BY sii.erp_product_id, si.branch_id
),

ultima_venta_agg AS MATERIALIZED (
  SELECT
    pb.prod_id,
    MAX(pb.last_date)                                             AS ultima_venta_global,
    MAX(pb.last_date) FILTER (WHERE pb.branch_id = p_branch_id)  AS ultima_venta_branch,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('branch_id', pb.branch_id, 'fecha', pb.last_date)
        ORDER BY pb.last_date DESC NULLS LAST
      ) FILTER (WHERE pb.last_date IS NOT NULL),
      '[]'::jsonb
    ) AS ultima_venta_por_suc
  FROM (
    SELECT prod_id, branch_id, MAX(last_date) AS last_date
    FROM (
      SELECT prod_id, branch_id, last_date FROM last_sale_hist
      UNION ALL
      SELECT prod_id, branch_id, last_date FROM last_sale_live
    ) u
    GROUP BY prod_id, branch_id
  ) pb
  GROUP BY pb.prod_id
)

SELECT
  ac.erp_product_id,
  COALESCE(pws.descripcion, ac.descripcion)::text AS descripcion,
  COALESCE(pws.cantidad,    0::numeric)           AS cantidad,
  COALESCE(pws.neto,        0::numeric)           AS neto,
  pws.costo_total,
  COALESCE(pws.presentaciones, '[]'::jsonb)       AS presentaciones,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END                                              AS ultima_venta,
  COALESCE(uva.ultima_venta_por_suc, '[]'::jsonb) AS ultima_venta_por_suc,
  p2.laboratorio_id,
  l2.nombre AS laboratorio_nombre,
  COALESCE(p2.oculto_en_ventas, false) AS oculto_en_ventas,
  emp.first_names AS oculto_por_first_names,
  emp.last_names  AS oculto_por_last_names,
  p2.oculto_at
FROM all_cands ac
LEFT JOIN prod_with_sales pws ON pws.erp_product_id = ac.erp_product_id
LEFT JOIN ultima_venta_agg uva ON uva.prod_id       = ac.erp_product_id
LEFT JOIN public.products p2 ON p2.id = ac.erp_product_id
LEFT JOIN public.laboratorios l2 ON l2.id = p2.laboratorio_id
LEFT JOIN public.employees emp ON emp.id = p2.oculto_por
ORDER BY
  (pws.erp_product_id IS NULL) ASC,
  COALESCE(pws.neto, 0)        DESC,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END DESC NULLS LAST;
$function$;
