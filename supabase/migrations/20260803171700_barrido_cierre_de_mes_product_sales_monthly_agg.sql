SET lock_timeout = '5s';

-- ── Reconstructor de meses CERRADOS ─────────────────────────────────────────
--
-- Recalcula desde las ventas en vivo, para un rango de meses, todas las filas de
-- `product_sales_monthly_agg`. Es idempotente (cada grupo se recalcula desde
-- cero, no acumula) y no genera escritura de más: el `WHERE ... IS DISTINCT
-- FROM` del ON CONFLICT deja pasar solo las filas cuyo valor cambió de verdad.
--
-- Existe como función propia porque tiene DOS usuarios: el barrido de cierre de
-- mes de `refresh_product_sales_monthly_agg` (abajo) y las reparaciones
-- puntuales de histórico. Escribir el mismo SQL en dos lados es cómo se separan
-- dos copias de la misma regla.
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
    -- deriva la última venta histórica como el último día del mes más nuevo que
    -- encuentre acá (con el mes en curso adentro daría una fecha futura), y los
    -- tres RPC de Pedidos suman `year_month >= hace 6 meses` sin tope superior,
    -- así que un mes a medio andar se les colaría en la demanda.
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
                   END)                       AS neto
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

    RETURN v_written;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rebuild_product_sales_monthly_agg(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rebuild_product_sales_monthly_agg(date, date) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rebuild_product_sales_monthly_agg(date, date) TO service_role;

-- ── El trabajo de cada hora, con barrido de cierre de mes ───────────────────
--
-- El bloque incremental es el mismo del 2026-07-17 y no se toca: es lo que bajó
-- la corrida de 9s a 100ms. Lo que se agrega arriba es el barrido, porque el
-- incremental SOLO no puede ver el mes que cierra.
--
-- El defecto (hallado el 2026-08-03, julio 2026 al 17.9%): las dos condiciones
-- de `touched_invoices` se cumplen en momentos distintos.
--
--   · Mientras el mes está EN CURSO, la factura entra por la ventana de la marca
--     de agua (`updated_at`) pero la descarta `si.fecha < v_curr_month`.
--   · Cuando el mes CIERRA, ya pasa ese filtro, pero su `updated_at` quedó muy
--     por detrás de la marca — que subió igual, cada hora, aunque la factura no
--     se hubiera procesado.
--
-- O sea que la marca certificaba como revisado un rango de tiempo en el que el
-- propio filtro había rechazado filas, y esas filas no vuelven a ser candidatas
-- nunca. Julio 2026 quedó con $38,431.95 de $214,226.46 y 657 productos de
-- 2,719; lo poco que entró fueron las facturas de fin de mes que el
-- sincronizador volvió a tocar ya en agosto. Lo mismo le tocaba a agosto el 1 de
-- septiembre, y así todos los meses.
--
-- No se arregló quitando `si.fecha < v_curr_month` —que sería lo directo— porque
-- eso mete el mes en curso a la tabla y rompe a sus consumidores; el motivo está
-- escrito en `rebuild_product_sales_monthly_agg`.
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

    -- ── Pasada incremental (sin cambios desde 2026-07-17) ──────────────────
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

    RETURN v_written + v_reconstruidas;
END;
$function$;

-- La marca arranca en julio 2026 a propósito: así la primera corrida ve que el
-- mes pasó de julio a agosto y repara julio por el mismo camino que va a correr
-- todos los meses. La reparación ES la prueba del arreglo.
INSERT INTO public.job_watermarks (job_name, watermark, updated_at)
VALUES ('refresh_product_sales_monthly_agg:mes_en_curso',
        ('2026-07-01'::timestamp AT TIME ZONE 'UTC'), now())
ON CONFLICT (job_name) DO UPDATE
SET watermark = EXCLUDED.watermark, updated_at = now();
