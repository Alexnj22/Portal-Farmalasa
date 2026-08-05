SET lock_timeout = '5s';

-- La explicación completa: no solo los factores, sino DE DÓNDE sale cada uno y
-- el monto que va quedando en cada paso.
--
-- Lo que faltaba y el usuario pidió (2026-08-05): el peso del mes salía como un
-- número suelto (0.9867) sin lo que hay detrás, y el empuje NO se mostraba
-- cuando era cero — así que una sala que rinde bien nunca se enteraba de que ese
-- mecanismo existe ni de que quedó fuera por rendir bien. Y no estaba lo que más
-- convence de que el cálculo es bueno: que usar la mediana en vez del promedio
-- evitó pedirle miles de más a todas por el mes raro de una sola.
CREATE OR REPLACE FUNCTION public.explicar_meta_propuesta(
    p_branch_id bigint, p_year_month text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r json;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_view') THEN RETURN NULL; END IF;

  WITH
  cfg AS (SELECT factor_crecimiento, empuje_peso, empuje_max FROM public.metas_config LIMIT 1),
  objetivo AS (
    SELECT (p_year_month || '-01')::date AS m_ini,
           EXTRACT(day FROM ((p_year_month || '-01')::date + interval '1 month -1 day'))::int AS dias
  ),
  agg AS (
    SELECT d.branch_id, date_trunc('month', d.date)::date AS m,
           SUM(d.sum_total)::numeric AS venta, COUNT(*) AS dias_dato
    FROM public.sales_daily_stats d GROUP BY 1, 2
  ),
  comp AS (
    SELECT a.*, EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int AS dias_mes
    FROM agg a
    WHERE a.dias_dato = EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int
  ),
  ult3 AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.branch_id ORDER BY c.m DESC) AS rn
    FROM comp c, objetivo o WHERE c.m < o.m_ini
  ),
  r3 AS (
    SELECT branch_id, SUM(venta)/SUM(dias_mes) AS por_dia, SUM(venta)/3 AS venta_mes
    FROM ult3 WHERE rn <= 3 GROUP BY 1
  ),
  -- El índice de CADA sala: lo que vendió ese mismo mes el año pasado contra lo
  -- que le tocaba al ritmo que traía justo antes.
  idx_sala AS (
    SELECT a.branch_id, a.venta AS venta_ap, a.dias_mes,
           (SELECT SUM(p.venta)/SUM(p.dias_mes) FROM
             (SELECT p2.*, row_number() OVER (ORDER BY p2.m DESC) AS rn FROM comp p2
              WHERE p2.branch_id = a.branch_id AND p2.m < a.m) p WHERE p.rn <= 3) AS ritmo_prev
    FROM comp a, objetivo o WHERE a.m = o.m_ini - interval '12 months'
  ),
  idx_calc AS (
    SELECT s.branch_id, s.venta_ap, round(s.ritmo_prev * s.dias_mes, 2) AS esperado,
           s.venta_ap / NULLIF(s.ritmo_prev * s.dias_mes, 0) AS idx
    FROM idx_sala s
  ),
  idx AS (
    SELECT COALESCE((percentile_cont(0.5) WITHIN GROUP (ORDER BY c.idx))::numeric, 1) AS bruto,
           COALESCE(avg(c.idx), 1)::numeric AS promedio,   -- solo para el contraste
           COUNT(c.idx)::numeric AS n
    FROM idx_calc c
  ),
  horas AS (
    SELECT b.id AS branch_id,
      (EXTRACT(epoch FROM SUM((regexp_replace(d.value->>'end','[^0-9:]','','g'))::time
                            - (regexp_replace(d.value->>'start','[^0-9:]','','g'))::time))/3600)::numeric AS h_sem
    FROM public.branches b, jsonb_each(b.weekly_hours) d
    WHERE (d.value->>'isOpen')::boolean GROUP BY 1
  ),
  prod AS (
    SELECT r.branch_id, r.venta_mes, h.h_sem, (r.venta_mes/NULLIF(h.h_sem*4.35,0))::numeric AS por_hora
    FROM r3 r JOIN horas h ON h.branch_id = r.branch_id
    WHERE EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                  WHERE m.branch_id = r.branch_id AND NOT m.es_bodega)
  ),
  norma AS (SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY p.por_hora))::numeric AS n FROM prod p)
  SELECT json_build_object(
    -- Paso 1: el ritmo
    'meses_base',   (SELECT json_agg(json_build_object(
                        'ym', to_char(u.m, 'YYYY-MM'), 'venta', round(u.venta, 2), 'dias', u.dias_mes)
                        ORDER BY u.m)
                     FROM ult3 u WHERE u.branch_id = p_branch_id AND u.rn <= 3),
    'ritmo_dia',    round(r.por_dia, 2),
    'dias_mes',     o.dias,
    'sub_ritmo',    round(r.por_dia * o.dias, 2),
    -- Paso 2: el peso del mes, con lo que hay detrás
    'estacional',   round(1 + (i.bruto - 1) * i.n / (i.n + 1), 4),
    'idx_propio',   round((SELECT c.idx FROM idx_calc c WHERE c.branch_id = p_branch_id), 4),
    'venta_ap',     (SELECT round(c.venta_ap, 2) FROM idx_calc c WHERE c.branch_id = p_branch_id),
    'esperado_ap',  (SELECT c.esperado FROM idx_calc c WHERE c.branch_id = p_branch_id),
    'idx_mediana',  round(i.bruto, 4),
    'idx_promedio', round(i.promedio, 4),
    'n_salas',      i.n,
    'sub_estacional', round(r.por_dia * o.dias * (1 + (i.bruto - 1) * i.n / (i.n + 1)), 2),
    -- Paso 3: crecimiento y empuje
    'crecimiento',  c.factor_crecimiento,
    'empuje',       round(LEAST(c.empuje_max,
                        GREATEST(0, nm.n * p.h_sem * 4.35 / NULLIF(p.venta_mes, 0) - 1) * c.empuje_peso), 4),
    'empuje_max',   c.empuje_max,
    'por_hora',     round(p.por_hora, 2),
    'por_hora_med', round(nm.n, 2),
    'horas_semana', round(p.h_sem, 1),
    'recalculada',  GREATEST(100, ROUND(
                      r.por_dia * o.dias
                      * (1 + (i.bruto - 1) * i.n / (i.n + 1))
                      * (c.factor_crecimiento
                         + LEAST(c.empuje_max,
                                 GREATEST(0, nm.n * p.h_sem * 4.35 / NULLIF(p.venta_mes, 0) - 1) * c.empuje_peso))
                      , 2)),
    -- Cuánto se habría pedido usando el promedio en vez de la mediana. Es el
    -- argumento más fuerte de por qué el cálculo es bueno, y sin el número al
    -- lado es solo una afirmación.
    'con_promedio', GREATEST(100, ROUND(
                      r.por_dia * o.dias
                      * (1 + (i.promedio - 1) * i.n / (i.n + 1))
                      * (c.factor_crecimiento
                         + LEAST(c.empuje_max,
                                 GREATEST(0, nm.n * p.h_sem * 4.35 / NULLIF(p.venta_mes, 0) - 1) * c.empuje_peso))
                      , 2))
  ) INTO r
  FROM r3 r
  JOIN prod p ON p.branch_id = r.branch_id
  CROSS JOIN objetivo o CROSS JOIN idx i CROSS JOIN norma nm CROSS JOIN cfg c
  WHERE r.branch_id = p_branch_id;

  RETURN r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.explicar_meta_propuesta(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explicar_meta_propuesta(bigint, text) TO authenticated, service_role;

-- Verificado en prod como usuario autenticado, La Popular / agosto 2026:
--   1,301.57/día × 31 días        = 40,348.69
--   × 0.9867 (peso del mes)       = 39,812.43
--   × 1.03 (crecimiento, sin empuje) = 41,006.81  ← el monto guardado
--   su índice propio 0.9556 (vendió 37,996.26 contra 39,761.45 esperados)
--   mediana de las 6 salas 0.9845 · promedio 1.0309
--   con el PROMEDIO la meta sería 42,661.55 — 1,654.74 más
-- Y Salud 5, la del empuje al tope: 44.28 por hora contra 108.92 de mediana,
-- empuje crudo 21.9% recortado al tope de 2%.
