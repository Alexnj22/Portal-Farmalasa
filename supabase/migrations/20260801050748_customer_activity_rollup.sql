SET lock_timeout = '5s';

-- ── Actividad por cliente, precalculada ──────────────────────────────────────
--
-- El dato que decide si una ficha vale la pena completarse es cuánto compra ese
-- cliente. Está en `sales_invoices.customer_id`: 338,764 facturas repartidas en
-- 24,487 de los 24,502 clientes.
--
-- **No se puede calcular al vuelo.** Medido con EXPLAIN ANALYZE sobre prod, el
-- GROUP BY completo tarda **3,407ms** y spillea a disco (seq scan paralelo de
-- 338K filas, HashAggregate en 5 batches). Eso es por CARGA DE PÁGINA de la
-- lista, y encima la lista necesita ordenar y filtrar por esas columnas, así que
-- no alcanza con calcularlas para las 25 filas visibles.
--
-- Por eso es una tabla de rollup y no un cálculo en el RPC ni una vista
-- materializada: mismo patrón que `product_sales_rollup`, incluido el upsert con
-- `IS DISTINCT FROM` que evita reescribir las 24 mil filas cuando no cambiaron
-- (regla de CLAUDE.md sobre el churn de WAL en syncs recurrentes).
CREATE TABLE IF NOT EXISTS public.customer_activity (
    customer_id       bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
    facturas          integer       NOT NULL DEFAULT 0,
    facturas_ccf      integer       NOT NULL DEFAULT 0,
    facturas_anuladas integer       NOT NULL DEFAULT 0,
    total             numeric(14,2) NOT NULL DEFAULT 0,
    primera_fecha     date,
    ultima_fecha      date,
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    created_at        timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_activity ENABLE ROW LEVEL SECURITY;

-- Solo lectura desde la API. No hay policy de escritura a propósito: el único
-- camino de escritura es `refresh_customer_activity()`, que es DEFINER — el
-- mismo criterio con el que `customers` no tiene UPDATE abierto.
DROP POLICY IF EXISTS customer_activity_select ON public.customer_activity;
CREATE POLICY customer_activity_select ON public.customer_activity
    FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.customer_activity IS
  'Rollup de facturación por cliente. Lo recalcula refresh_customer_activity() a diario (cron 06:45 UTC, fuera de la ventana de los syncs). No se escribe desde la API.';

-- El total y las fechas cuentan SOLO las facturas vivas: una anulada no es
-- compra. Se guardan aparte (`facturas_anuladas`) porque un cliente con muchas
-- anulaciones es una señal propia, no un cero.
CREATE OR REPLACE FUNCTION public.refresh_customer_activity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_upserted integer := 0;
  v_deleted  integer := 0;
  v_clientes integer := 0;
BEGIN
  SET LOCAL work_mem = '128MB';

  CREATE TEMP TABLE _ca_agg ON COMMIT DROP AS
  SELECT
    si.customer_id,
    count(*) FILTER (WHERE si.estado = 'FINALIZADA')::integer                                AS facturas,
    count(*) FILTER (WHERE si.estado = 'FINALIZADA' AND si.tipo_documento = 'CCF')::integer  AS facturas_ccf,
    count(*) FILTER (WHERE si.estado <> 'FINALIZADA')::integer                               AS facturas_anuladas,
    coalesce(sum(si.total) FILTER (WHERE si.estado = 'FINALIZADA'), 0)::numeric(14,2)        AS total,
    min(si.fecha) FILTER (WHERE si.estado = 'FINALIZADA')                                    AS primera_fecha,
    max(si.fecha) FILTER (WHERE si.estado = 'FINALIZADA')                                    AS ultima_fecha
  FROM public.sales_invoices si
  WHERE si.customer_id IS NOT NULL
  GROUP BY si.customer_id;

  SELECT count(*) INTO v_clientes FROM _ca_agg;

  WITH up AS (
    INSERT INTO public.customer_activity AS a
      (customer_id, facturas, facturas_ccf, facturas_anuladas, total, primera_fecha, ultima_fecha, updated_at)
    -- El JOIN contra `customers` no es decorativo: un `customer_id` huérfano
    -- haría fallar la FK y con ella el refresh entero.
    SELECT g.customer_id, g.facturas, g.facturas_ccf, g.facturas_anuladas,
           g.total, g.primera_fecha, g.ultima_fecha, now()
    FROM _ca_agg g
    JOIN public.customers c ON c.id = g.customer_id
    ON CONFLICT (customer_id) DO UPDATE
      SET facturas          = EXCLUDED.facturas,
          facturas_ccf      = EXCLUDED.facturas_ccf,
          facturas_anuladas = EXCLUDED.facturas_anuladas,
          total             = EXCLUDED.total,
          primera_fecha     = EXCLUDED.primera_fecha,
          ultima_fecha      = EXCLUDED.ultima_fecha,
          updated_at        = now()
      WHERE (a.facturas, a.facturas_ccf, a.facturas_anuladas, a.total, a.primera_fecha, a.ultima_fecha)
         IS DISTINCT FROM
            (EXCLUDED.facturas, EXCLUDED.facturas_ccf, EXCLUDED.facturas_anuladas,
             EXCLUDED.total, EXCLUDED.primera_fecha, EXCLUDED.ultima_fecha)
    RETURNING 1
  )
  SELECT count(*) INTO v_upserted FROM up;

  DELETE FROM public.customer_activity a
  WHERE NOT EXISTS (SELECT 1 FROM _ca_agg g WHERE g.customer_id = a.customer_id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'clientes', v_clientes,
    'upserted', v_upserted, 'deleted', v_deleted, 'at', now());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_customer_activity() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_customer_activity() TO service_role;

-- 06:45 UTC: dentro de la ventana en que los syncs no corren (12-23,0-5) y en un
-- minuto que no comparte con ningún otro job — a las 6 ya hay tres (10, 20 y 30),
-- y varios crons al mismo minuto es lo que agotó los slots de conexión antes.
SELECT cron.unschedule('refresh-customer-activity-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-customer-activity-daily');

SELECT cron.schedule(
    'refresh-customer-activity-daily',
    '45 6 * * *',
    $cron$SELECT public.refresh_customer_activity()$cron$);

-- Primera carga, para que el módulo no nazca con la tabla vacía.
SELECT public.refresh_customer_activity();
