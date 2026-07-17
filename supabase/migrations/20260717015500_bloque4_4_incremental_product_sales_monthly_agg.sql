SET lock_timeout = '5s';

-- Índice creado antes de esta migración vía execute_sql directo con CONCURRENTLY
-- (no puede correr dentro de la transacción de apply_migration). Este
-- CREATE INDEX IF NOT EXISTS es solo de seguimiento en el historial de
-- migraciones, no-op en ejecución real (mismo patrón que 4.1).
CREATE INDEX IF NOT EXISTS idx_sales_invoices_updated_at
  ON public.sales_invoices (updated_at);

-- Bloque 4.4: refresh_product_sales_monthly_agg() (cron cada hora, jobid 138) re-escaneaba
-- 3 meses completos de sales_invoice_items JOIN sales_invoices en CADA corrida (6.6-15.5s
-- promedio, hasta 32.8s en outliers), sin importar cuántas facturas cambiaron desde la
-- última corrida. El DELETE+INSERT ON CONFLICT ya era anti-churn correcto (WHERE IS DISTINCT
-- FROM) — el costo está en el CÁLCULO (el CTE `fresh`), no en la escritura.
--
-- Watermark: sales_invoice_items no tiene columna de auditoría propia, pero
-- sales_invoices.updated_at sí sirve de proxy confiable — verificado que sync-dte-sales
-- (único escritor real de sales_invoice_items) siempre bumpea updated_at de la factura padre
-- cuando sus items cambian (insert-only condicionado a factura nueva/con cambios), y que el
-- único UPDATE directo desde el frontend (facturacion.js: recibido_mh) no toca ninguna
-- columna que este agregado lea. Sin trigger que auto-actualice updated_at (confirmado).
--
-- Margen de seguridad de 15 min sobre el watermark (nunca avanza más allá de now()-15min):
-- protege contra la ventana de visibilidad de READ COMMITTED (una transacción que commitea
-- justo alrededor del instante que se captura como "ahora" podría no ser vista por el SELECT
-- de esta corrida) — el próximo run la recoge sin pérdida, a costo de 15 min de latencia
-- extra en un job que corre cada hora.
--
-- job_watermarks: tabla de bookkeeping puro para cron, sin exposición a la API (RLS
-- habilitada, sin policies, sin grants a anon/authenticated — mismo patrón que
-- login_rate_limit). Solo la toca la función SECURITY DEFINER (dueña: postgres, bypassea RLS).

CREATE TABLE public.job_watermarks (
  job_name   text PRIMARY KEY,
  watermark  timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_watermarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_watermarks FROM PUBLIC, anon, authenticated;

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
BEGIN
    v_curr_month := date_trunc('month', CURRENT_DATE)::date;
    v_from_date  := (v_curr_month - (p_months_back || ' months')::interval)::date;

    SELECT watermark INTO v_watermark
    FROM public.job_watermarks
    WHERE job_name = 'refresh_product_sales_monthly_agg';

    IF v_watermark IS NULL THEN
        -- Primera corrida (o watermark reseteado): se comporta como el full-scan de
        -- siempre, ya que "todas las facturas del rango" quedan > v_from_date.
        v_watermark := v_from_date::timestamptz;
    END IF;

    v_new_watermark := now() - interval '15 minutes';

    IF v_new_watermark <= v_watermark THEN
        RETURN 0;  -- nada nuevo desde la última corrida
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
                END)                           AS neto
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
            (year_month, branch_id, erp_product_id, presentacion, descripcion, cantidad, neto)
        SELECT year_month, branch_id, erp_product_id, presentacion, descripcion, cantidad, neto
        FROM fresh
        ON CONFLICT (year_month, branch_id, erp_product_id, presentacion) DO UPDATE
        SET descripcion = EXCLUDED.descripcion,
            cantidad    = EXCLUDED.cantidad,
            neto        = EXCLUDED.neto
        WHERE (product_sales_monthly_agg.descripcion, product_sales_monthly_agg.cantidad, product_sales_monthly_agg.neto)
              IS DISTINCT FROM (EXCLUDED.descripcion, EXCLUDED.cantidad, EXCLUDED.neto)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM del) + (SELECT count(*) FROM ins) INTO v_written;

    INSERT INTO public.job_watermarks (job_name, watermark, updated_at)
    VALUES ('refresh_product_sales_monthly_agg', v_new_watermark, now())
    ON CONFLICT (job_name) DO UPDATE SET watermark = EXCLUDED.watermark, updated_at = now();

    RETURN v_written;
END;
$function$;
