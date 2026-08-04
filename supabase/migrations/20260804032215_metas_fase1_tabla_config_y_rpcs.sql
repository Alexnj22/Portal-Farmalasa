-- Metas — Fase 1 (docs/PLAN-METAS-2026-08-03.md): tabla de metas por sala,
-- configuración del bono, e ingreso/lectura vía RPC.
--
-- Decisiones que este esquema encarna: base CON IVA (sales_daily_stats.sum_total
-- = SUM(si.total), sin anuladas), meta por SALA, bono ≥100% completo / ≥95%
-- medio / <95% nada (umbrales en metas_config, no harcodeados), estados listos
-- para el flujo de Fase 2 pero Fase 1 solo escribe 'oficial' a mano.
--
-- sales_daily_stats NUNCA incluye el día de hoy (su refresh corta en ayer):
-- el acumulado en vivo del tablero es agregado-hasta-ayer + scan de HOY sobre
-- sales_invoices — mismo patrón híbrido que get_product_sales_agg.
--
-- NOTA: las dos funciones de lectura de esta migración fueron reemplazadas
-- minutos después por 20260804032349 (el "hoy" pasa a día de negocio SV).

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Tablas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.metas_sucursal (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id      bigint NOT NULL REFERENCES public.branches(id),
  year_month     text   NOT NULL CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  monto_meta     numeric NOT NULL CHECK (monto_meta > 0),
  monto_propuesto numeric,          -- lo que calcule el sistema (Fase 2)
  estado         text NOT NULL DEFAULT 'oficial'
                 CHECK (estado IN ('propuesta','confirmada_supervisor','oficial','devuelta')),
  nota           text,
  supervisor_por uuid REFERENCES public.employees(id),
  supervisor_at  timestamptz,
  gerente_por    uuid REFERENCES public.employees(id),
  gerente_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, year_month)
);
CREATE INDEX idx_metas_sucursal_branch ON public.metas_sucursal(branch_id);
-- supervisor_por/gerente_por: columnas de puro audit — sin índice (regla §2).

ALTER TABLE public.metas_sucursal ENABLE ROW LEVEL SECURITY;
CREATE POLICY metas_sucursal_select ON public.metas_sucursal
  FOR SELECT TO authenticated USING (true);
-- SIN policies de escritura: todo write pasa por el RPC SECURITY DEFINER.

-- Configuración (una sola fila; el PK booleano con CHECK lo garantiza)
CREATE TABLE public.metas_config (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  umbral_bono_total      numeric NOT NULL DEFAULT 100,  -- % para bono completo
  umbral_bono_medio      numeric NOT NULL DEFAULT 95,   -- % para medio bono
  pago_medio_pct         numeric NOT NULL DEFAULT 50,   -- cuánto del bono paga el tramo medio
  dia_propuesta          integer NOT NULL DEFAULT 25,   -- día del mes que se generan propuestas (Fase 2)
  bonificaciones_activas boolean NOT NULL DEFAULT false, -- HOY SUSPENDIDAS (decisión 2026-08-03)
  created_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.metas_config (id) VALUES (true);

ALTER TABLE public.metas_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY metas_config_select ON public.metas_config
  FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ingreso manual (histórico, mes en curso o siguiente — hasta que Fase 2
-- tome los futuros con el flujo supervisor→gerente)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.upsert_meta_manual(p_branch_id bigint, p_year_month text, p_monto numeric, p_nota text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_emp uuid;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'MONTO_INVALIDO';
  END IF;
  -- Solo salas que venden (Bodega/Administración no llevan meta)
  IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                 WHERE m.branch_id = p_branch_id AND NOT m.es_bodega) THEN
    RAISE EXCEPTION 'SUCURSAL_INVALIDA: %', p_branch_id;
  END IF;

  v_emp := public.auth_employee_id();  -- autoría server-side, nunca del cliente

  INSERT INTO public.metas_sucursal
    (branch_id, year_month, monto_meta, estado, nota, supervisor_por, supervisor_at)
  VALUES
    (p_branch_id, p_year_month, p_monto, 'oficial', p_nota, v_emp, now())
  ON CONFLICT (branch_id, year_month) DO UPDATE
  SET monto_meta     = EXCLUDED.monto_meta,
      nota           = COALESCE(EXCLUDED.nota, metas_sucursal.nota),
      estado         = 'oficial',
      supervisor_por = EXCLUDED.supervisor_por,
      supervisor_at  = now();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.upsert_meta_manual(bigint, text, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_meta_manual(bigint, text, numeric, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tablero: las 6 salas de un mes, con acumulado en vivo y proyección de cierre
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.get_metas_dashboard(p_year_month text)
RETURNS TABLE(
  branch_id bigint, monto_meta numeric, estado text, nota text,
  venta_acumulada numeric, pct_cumplimiento numeric,
  proyeccion numeric, pct_proyectado numeric,
  bono_tier text, dias_transcurridos integer, dias_mes integer
)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
WITH
lim AS (
  SELECT (p_year_month || '-01')::date AS m_ini,
         ((p_year_month || '-01')::date + interval '1 month' - interval '1 day')::date AS m_fin,
         CURRENT_DATE AS hoy,
         to_char(CURRENT_DATE, 'YYYY-MM') AS ym_hoy
),
sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
-- venta agregada del mes hasta ayer (o el mes entero si ya cerró)
hist AS (
  SELECT s.branch_id, COALESCE(SUM(d.sum_total), 0) AS neto
  FROM sucs s
  CROSS JOIN lim
  LEFT JOIN public.sales_daily_stats d
    ON d.branch_id = s.branch_id
   AND d.date >= lim.m_ini
   AND d.date <= LEAST(lim.m_fin, lim.hoy - 1)
  GROUP BY s.branch_id
),
-- HOY en vivo (sales_daily_stats nunca incluye hoy) — solo si hoy cae en el mes
vivo AS (
  SELECT si.branch_id, COALESCE(SUM(si.total::numeric), 0) AS neto
  FROM public.sales_invoices si
  CROSS JOIN lim
  WHERE si.fecha = lim.hoy
    AND lim.hoy BETWEEN lim.m_ini AND lim.m_fin
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
  GROUP BY si.branch_id
),
-- perfil por día de semana de cada sala, últimas 8 semanas cerradas a ayer
perfil AS (
  SELECT d.branch_id, EXTRACT(dow FROM d.date)::int AS dow, AVG(d.sum_total) AS prom
  FROM public.sales_daily_stats d
  WHERE d.date >= CURRENT_DATE - 56 AND d.date < CURRENT_DATE
  GROUP BY d.branch_id, EXTRACT(dow FROM d.date)
),
-- lo que suelen vender los días que faltan (HOY incluido) — solo mes en curso
resto AS (
  SELECT s.branch_id, COALESCE(SUM(p.prom), 0) AS neto
  FROM sucs s
  CROSS JOIN lim
  CROSS JOIN LATERAL generate_series(lim.hoy, lim.m_fin, interval '1 day') g(d)
  LEFT JOIN perfil p ON p.branch_id = s.branch_id AND p.dow = EXTRACT(dow FROM g.d)::int
  WHERE p_year_month = lim.ym_hoy
  GROUP BY s.branch_id
),
base AS (
  SELECT
    s.branch_id,
    m.monto_meta,
    m.estado,
    m.nota,
    ROUND(h.neto + COALESCE(v.neto, 0), 2) AS venta_acumulada,
    CASE
      WHEN p_year_month = l.ym_hoy
        THEN ROUND(GREATEST(h.neto + COALESCE(r.neto, 0), h.neto + COALESCE(v.neto, 0)), 2)
      WHEN p_year_month < l.ym_hoy
        THEN ROUND(h.neto + COALESCE(v.neto, 0), 2)   -- mes cerrado: la proyección ES lo real
    END AS proyeccion,
    CASE
      WHEN p_year_month > l.ym_hoy THEN 0
      WHEN p_year_month = l.ym_hoy THEN (l.hoy - l.m_ini + 1)::integer
      ELSE (l.m_fin - l.m_ini + 1)::integer
    END AS dias_transcurridos,
    (l.m_fin - l.m_ini + 1)::integer AS dias_mes,
    (p_year_month < l.ym_hoy) AS cerrado
  FROM sucs s
  CROSS JOIN lim l
  LEFT JOIN public.metas_sucursal m ON m.branch_id = s.branch_id AND m.year_month = p_year_month
  LEFT JOIN hist h ON h.branch_id = s.branch_id
  LEFT JOIN vivo v ON v.branch_id = s.branch_id
  LEFT JOIN resto r ON r.branch_id = s.branch_id
)
SELECT
  b.branch_id, b.monto_meta, b.estado, b.nota,
  b.venta_acumulada,
  CASE WHEN b.monto_meta > 0 THEN ROUND(b.venta_acumulada / b.monto_meta * 100, 1) END AS pct_cumplimiento,
  b.proyeccion,
  CASE WHEN b.monto_meta > 0 AND b.proyeccion IS NOT NULL
       THEN ROUND(b.proyeccion / b.monto_meta * 100, 1) END AS pct_proyectado,
  CASE
    WHEN b.monto_meta IS NULL THEN NULL
    -- mes cerrado: el tramo según lo REAL; mes en curso: según lo proyectado
    WHEN b.cerrado THEN
      CASE WHEN b.venta_acumulada / b.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
           WHEN b.venta_acumulada / b.monto_meta * 100 >= c.umbral_bono_medio THEN 'medio'
           ELSE 'nada' END
    WHEN b.proyeccion IS NOT NULL THEN
      CASE WHEN b.proyeccion / b.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
           WHEN b.proyeccion / b.monto_meta * 100 >= c.umbral_bono_medio THEN 'medio'
           ELSE 'nada' END
  END AS bono_tier,
  b.dias_transcurridos,
  b.dias_mes
FROM base b
CROSS JOIN public.metas_config c
ORDER BY b.branch_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_metas_dashboard(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_metas_dashboard(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Histórico: todos los meses CERRADOS desde 2025-05, por sala
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.get_metas_historico()
RETURNS TABLE(
  year_month text, branch_id bigint, monto_meta numeric,
  venta_total numeric, pct_cumplimiento numeric, bono_tier text, nota text
)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
WITH
sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
ventas AS (
  SELECT d.branch_id, to_char(d.date, 'YYYY-MM') AS ym, SUM(d.sum_total) AS neto
  FROM public.sales_daily_stats d
  WHERE d.date >= '2025-05-01'
    AND d.date < date_trunc('month', CURRENT_DATE)::date
    AND d.branch_id IN (SELECT s.branch_id FROM sucs s)
  GROUP BY d.branch_id, to_char(d.date, 'YYYY-MM')
),
claves AS (
  SELECT v.branch_id, v.ym FROM ventas v
  UNION
  SELECT m.branch_id, m.year_month FROM public.metas_sucursal m
  WHERE m.year_month < to_char(CURRENT_DATE, 'YYYY-MM')
    AND m.branch_id IN (SELECT s.branch_id FROM sucs s)
)
SELECT
  k.ym AS year_month,
  k.branch_id,
  m.monto_meta,
  ROUND(COALESCE(v.neto, 0), 2) AS venta_total,
  CASE WHEN m.monto_meta > 0
       THEN ROUND(COALESCE(v.neto, 0) / m.monto_meta * 100, 1) END AS pct_cumplimiento,
  CASE WHEN m.monto_meta IS NULL THEN NULL
       WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
       WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_medio THEN 'medio'
       ELSE 'nada' END AS bono_tier,
  m.nota
FROM claves k
LEFT JOIN public.metas_sucursal m ON m.branch_id = k.branch_id AND m.year_month = k.ym
LEFT JOIN ventas v ON v.branch_id = k.branch_id AND v.ym = k.ym
CROSS JOIN public.metas_config c
ORDER BY k.ym DESC, COALESCE(v.neto, 0) DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_metas_historico() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_metas_historico() TO authenticated, service_role;
