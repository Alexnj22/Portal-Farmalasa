-- El "hoy" de Metas es el DÍA DE NEGOCIO de El Salvador, no la fecha UTC del
-- servidor. Con CURRENT_DATE (UTC), desde las 18:00 hora SV el tablero decía
-- "día siguiente": contaba un día de más, el scan en vivo buscaba una fecha
-- sin ventas todavía (perdiendo la frescura de la tarde-noche, que quedaba
-- al ritmo del refresh de 15 min del agregado), y la proyección saltaba el
-- resto del día en curso. America/El_Salvador es UTC-6 fijo (sin DST) — la
-- misma convención -6h que usa el frontend (currentHoraCorte).
--
-- Mismo cuerpo que 20260804032215; solo cambia la fuente de "hoy" en
-- get_metas_dashboard y el corte de mes cerrado en get_metas_historico.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Tablero: las 6 salas de un mes, con acumulado en vivo y proyección de cierre
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_metas_dashboard(p_year_month text)
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
         (now() AT TIME ZONE 'America/El_Salvador')::date AS hoy,
         to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM') AS ym_hoy
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
  CROSS JOIN lim
  WHERE d.date >= lim.hoy - 56 AND d.date < lim.hoy
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
CREATE OR REPLACE FUNCTION public.get_metas_historico()
RETURNS TABLE(
  year_month text, branch_id bigint, monto_meta numeric,
  venta_total numeric, pct_cumplimiento numeric, bono_tier text, nota text
)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
WITH
lim AS (
  SELECT date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date)::date AS mes_actual_ini,
         to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM') AS ym_hoy
),
sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
ventas AS (
  SELECT d.branch_id, to_char(d.date, 'YYYY-MM') AS ym, SUM(d.sum_total) AS neto
  FROM public.sales_daily_stats d
  CROSS JOIN lim
  WHERE d.date >= '2025-05-01'
    AND d.date < lim.mes_actual_ini
    AND d.branch_id IN (SELECT s.branch_id FROM sucs s)
  GROUP BY d.branch_id, to_char(d.date, 'YYYY-MM')
),
claves AS (
  SELECT v.branch_id, v.ym FROM ventas v
  UNION
  SELECT m.branch_id, m.year_month FROM public.metas_sucursal m
  CROSS JOIN lim
  WHERE m.year_month < lim.ym_hoy
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
