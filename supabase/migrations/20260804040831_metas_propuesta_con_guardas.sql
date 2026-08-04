-- La fórmula de propuesta, con GUARDAS. El backtest contra jun/jul 2026
-- destapó que sin ellas explota: la ventana «mismos 3 meses del año pasado»
-- puede caer ANTES del inicio de la historia (2025-05) — el denominador queda
-- incompleto y el crecimiento se dispara (medido: hasta +652% de error).
-- Con guardas: error medio 5-7% contra los meses reales.
--
--   1. El crecimiento solo aplica si SUS DOS ventanas caen completas dentro
--      de la historia; si no, se usa el ritmo reciente (promedio 3 meses).
--   2. El crecimiento se acota a [0.80, 1.25] — una meta es un objetivo, no
--      una apuesta a que un ratio ruidoso se repita.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.generar_propuestas_metas(p_year_month text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_creadas integer;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;

  WITH lim AS (
    SELECT (p_year_month || '-01')::date                                AS dest_ini,
           ((p_year_month || '-01')::date - interval '12 months')::date AS base_ini,
           date_trunc('month', v_hoy)::date                             AS act_ini
  ),
  sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
  v AS (
    SELECT s.branch_id,
      COALESCE(SUM(d.sum_total) FILTER (
        WHERE d.date >= l.base_ini AND d.date < (l.base_ini + interval '1 month')::date), 0) AS base,
      COALESCE(SUM(d.sum_total) FILTER (
        WHERE d.date >= (l.act_ini - interval '3 months')::date AND d.date < l.act_ini), 0) AS v3,
      COALESCE(SUM(d.sum_total) FILTER (
        WHERE d.date >= (l.act_ini - interval '15 months')::date AND d.date < (l.act_ini - interval '12 months')::date), 0) AS v3p,
      ((l.act_ini - interval '15 months')::date >= '2025-05-01'::date) AS v3p_completa,
      (l.base_ini >= '2025-05-01'::date)                               AS base_completa
    FROM sucs s
    CROSS JOIN lim l
    LEFT JOIN public.sales_daily_stats d ON d.branch_id = s.branch_id
    GROUP BY s.branch_id, l.base_ini, l.act_ini
  ),
  calc AS (
    SELECT branch_id,
      GREATEST(100, ROUND((
        CASE
          WHEN base > 0 AND base_completa AND v3p > 0 AND v3p_completa
            THEN base * LEAST(1.25, GREATEST(0.80, v3 / v3p))
          ELSE v3 / 3.0
        END) / 100.0) * 100) AS propuesta
    FROM v
    WHERE base > 0 OR v3 > 0
  ),
  ins AS (
    INSERT INTO public.metas_sucursal (branch_id, year_month, monto_meta, monto_propuesto, estado, nota)
    SELECT c.branch_id, p_year_month, c.propuesta, c.propuesta, 'propuesta',
           'Propuesta del sistema: mismo mes del año pasado ajustado por el ritmo reciente'
    FROM calc c
    ON CONFLICT (branch_id, year_month) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_creadas FROM ins;

  RETURN v_creadas;
END;
$function$;
