SET lock_timeout = '5s';

-- Perillas de política. Van en config y no en el cuerpo de la función: cambiar
-- cuánto se pide no puede exigir una migración.
ALTER TABLE public.metas_config
  ADD COLUMN IF NOT EXISTS factor_crecimiento numeric NOT NULL DEFAULT 1.03,
  ADD COLUMN IF NOT EXISTS empuje_peso        numeric NOT NULL DEFAULT 0.15,
  ADD COLUMN IF NOT EXISTS empuje_max         numeric NOT NULL DEFAULT 0.02;

COMMENT ON COLUMN public.metas_config.factor_crecimiento IS
  'Cuánto se pide por encima del ritmo propio. 1.03 medido sobre 60 meses: el desvío propio de una sala es 8.3% y el total 12.1%, así que 1.05 dejaba el bono en 33% de logro y 60% de los meses sin bono.';
COMMENT ON COLUMN public.metas_config.empuje_peso IS
  'Qué fracción de la brecha contra el potencial (horas de apertura x norma de la cadena) se pide cerrar en un mes.';
COMMENT ON COLUMN public.metas_config.empuje_max IS
  'Tope del empujón. Importa más que la fórmula: una brecha estructural se cierra en muchos meses o no se cierra.';

-- ── Propuesta de meta ──────────────────────────────────────────────────────
-- Reescrita 2026-08-04. La versión anterior anclaba en el mismo mes del año
-- pasado escalado por «ritmo reciente», y tenía un defecto que la rompía: el
-- denominador del ritmo se guardaba con la constante `>= '2025-05-01'`, pero
-- sales_daily_stats arranca el 18-may-2025. Ese mayo entraba con 14 días de 31,
-- el ritmo salía 1.19 a 2.82 (Salud 3 daba 1.581; Salud 5, 2.815) y el tope de
-- 1.25 lo disimulaba sin arreglarlo: para agosto 2026 proponía entre +11% y +21%
-- sobre lo que las salas pueden vender.
--
-- Acá el mes incompleto se excluye por CONSTRUCCIÓN (`dias_dato = dias_mes`), no
-- por una fecha escrita a mano que vuelve a quedar vieja.
--
-- meta = ritmo diario de los 3 meses completos previos
--        x días del mes objetivo
--        x índice del mes (estacionalidad, medida y encogida)
--        x (factor de crecimiento + empujón hacia el potencial, topado)
CREATE OR REPLACE FUNCTION public.generar_propuestas_metas(p_year_month text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_creadas integer;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;

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
  -- Un mes solo cuenta si están TODOS sus días. Es lo que impide que el mes en
  -- que arrancó el histórico se lea como un mes flojo.
  comp AS (
    SELECT a.*, EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int AS dias_mes
    FROM agg a
    WHERE a.dias_dato = EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int
  ),
  r3 AS (
    SELECT branch_id, SUM(venta)/SUM(dias_mes) AS por_dia, SUM(venta)/3 AS venta_mes
    FROM (SELECT c.*, row_number() OVER (PARTITION BY c.branch_id ORDER BY c.m DESC) AS rn
          FROM comp c, objetivo o WHERE c.m < o.m_ini) x
    WHERE rn <= 3 GROUP BY 1
  ),
  -- Estacionalidad: cuánto rindió ESE mes calendario un año atrás contra el
  -- ritmo que traía. Por sala, y después la MEDIANA — así una sala en rampa o
  -- una que viene creciendo no arrastra el índice de todas.
  idx_sala AS (
    SELECT a.branch_id,
           a.venta / NULLIF((SELECT SUM(p.venta)/SUM(p.dias_mes) FROM
             (SELECT p2.*, row_number() OVER (ORDER BY p2.m DESC) AS rn FROM comp p2
              WHERE p2.branch_id = a.branch_id AND p2.m < a.m) p WHERE p.rn <= 3) * a.dias_mes, 0) AS idx
    FROM comp a, objetivo o WHERE a.m = o.m_ini - interval '12 months'
  ),
  -- Con un año de historia el índice pesa la mitad; con tres, tres cuartos. Se
  -- afina solo cada año en vez de quedar clavado en una estimación pobre.
  idx AS (
    SELECT COALESCE((percentile_cont(0.5) WITHIN GROUP (ORDER BY s.idx))::numeric, 1) AS bruto,
           COUNT(s.idx)::numeric AS n
    FROM idx_sala s
  ),
  horas AS (
    SELECT b.id AS branch_id,
      (EXTRACT(epoch FROM SUM((regexp_replace(d.value->>'end','[^0-9:]','','g'))::time
                            - (regexp_replace(d.value->>'start','[^0-9:]','','g'))::time))/3600)::numeric AS h_sem
    FROM public.branches b, jsonb_each(b.weekly_hours) d
    WHERE (d.value->>'isOpen')::boolean GROUP BY 1
  ),
  prod AS (
    SELECT r.branch_id, r.venta_mes, h.h_sem, r.venta_mes/NULLIF(h.h_sem*4.35,0) AS por_hora
    FROM r3 r JOIN horas h ON h.branch_id = r.branch_id
  ),
  -- La norma es la MEDIANA de venta por hora abierta: tres salas de 1987, 2010 y
  -- 2023, con 84, 105 y 95 horas semanales, caen las tres en el mismo valor.
  norma AS (SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY p.por_hora))::numeric AS n FROM prod p),
  calc AS (
    SELECT r.branch_id,
      GREATEST(100, ROUND(
        r.por_dia * o.dias
        * (1 + (i.bruto - 1) * i.n / (i.n + 1))
        * (c.factor_crecimiento
           + LEAST(c.empuje_max,
                   GREATEST(0, nm.n * p.h_sem * 4.35 / NULLIF(p.venta_mes, 0) - 1) * c.empuje_peso))
        / 10) * 10) AS propuesta
    FROM r3 r
    JOIN prod p ON p.branch_id = r.branch_id
    CROSS JOIN objetivo o CROSS JOIN idx i CROSS JOIN norma nm CROSS JOIN cfg c
    WHERE EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                  WHERE m.branch_id = r.branch_id AND NOT m.es_bodega)
  ),
  ins AS (
    INSERT INTO public.metas_sucursal (branch_id, year_month, monto_meta, monto_propuesto, estado, nota)
    SELECT c.branch_id, p_year_month, c.propuesta, c.propuesta, 'propuesta',
           'Propuesta del sistema: el ritmo de venta de los últimos 3 meses, ajustado por el peso del mes y por el crecimiento pedido'
    FROM calc c WHERE c.propuesta IS NOT NULL
    ON CONFLICT (branch_id, year_month) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_creadas FROM ins;

  RETURN v_creadas;
END;
$function$;
