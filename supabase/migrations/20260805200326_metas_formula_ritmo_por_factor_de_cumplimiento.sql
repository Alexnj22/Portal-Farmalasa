SET lock_timeout = '5s';

-- ═══ LA FÓRMULA DE LA META, REESCRITA ═══════════════════════════════════════
-- Decisión del usuario (2026-08-05). Reemplaza al cálculo con peso estacional y
-- empuje por productividad. La nueva:
--
--   Meta = [(venta m-3 + m-2 + m-1) ÷ (días m-3 + m-2 + m-1)]
--          × días del mes objetivo
--          × Factor
--
--   Factor, según cómo cerró la sala el mes -1:
--     >= 105%          → 1.08
--     95% – 104.99%    → 1.05
--     90% – 94.99%     → 1.02
--     < 90%            → 1.00
--
-- El cambio de fondo NO es de aritmética, es de criterio: el empuje le exigía
-- MÁS a la sala que rendía menos por hora abierta; el factor le pide más a la
-- que CUMPLIÓ. Medido sobre agosto: Salud 4, que venía en 94%, pasa de 41,825.10
-- a 41,221.47 — es la única que baja, y baja justamente por no haber cumplido.
--
-- La fórmula anterior queda documentada en
-- `docs/PLAN-METAS-CIERRE-Y-GASTOS-2026-08-05.md` §C2, con los valores que tenía
-- su configuración (crecimiento 1.03, peso del empuje 0.15, tope 0.02).

-- ── Los tramos, en tabla y no clavados ──────────────────────────────────────
-- En tabla para poder agregar o mover un tramo sin tocar la función. Se busca
-- el `desde_pct` más alto que no supere el cumplimiento.
CREATE TABLE IF NOT EXISTS public.metas_factor_cumplimiento (
  desde_pct  numeric PRIMARY KEY,
  factor     numeric NOT NULL CHECK (factor > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.metas_factor_cumplimiento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metas_factor_cumplimiento_select ON public.metas_factor_cumplimiento;
CREATE POLICY metas_factor_cumplimiento_select ON public.metas_factor_cumplimiento
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));

INSERT INTO public.metas_factor_cumplimiento (desde_pct, factor) VALUES
  (105, 1.08), (95, 1.05), (90, 1.02), (0, 1.00)
ON CONFLICT (desde_pct) DO UPDATE SET factor = EXCLUDED.factor;

-- ── La configuración que deja de leerse ─────────────────────────────────────
-- Se ELIMINA en vez de dejarse: una columna que parece configurar el cálculo y
-- no lo hace es la trampa que `CLAUDE.md` describe con `xyz_x_cv_max`. Ninguna
-- pantalla las editaba (verificado con grep en `src/`).
ALTER TABLE public.metas_config
  DROP COLUMN IF EXISTS factor_crecimiento,
  DROP COLUMN IF EXISTS empuje_peso,
  DROP COLUMN IF EXISTS empuje_max;

-- ── La propuesta ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generar_propuestas_metas(p_year_month text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_creadas integer;
  v_b bigint;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;

  WITH
  objetivo AS (
    SELECT (p_year_month || '-01')::date AS m_ini,
           EXTRACT(day FROM ((p_year_month || '-01')::date + interval '1 month -1 day'))::int AS dias
  ),
  agg AS (
    SELECT d.branch_id, date_trunc('month', d.date)::date AS m,
           SUM(d.sum_total)::numeric AS venta, COUNT(*) AS dias_dato
    FROM public.sales_daily_stats d GROUP BY 1, 2
  ),
  -- Solo meses COMPLETOS: uno a medias bajaría el ritmo sin que nadie vendiera
  -- menos.
  comp AS (
    SELECT a.*, EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int AS dias_mes
    FROM agg a
    WHERE a.dias_dato = EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int
  ),
  u3 AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.branch_id ORDER BY c.m DESC) AS rn
    FROM comp c, objetivo o WHERE c.m < o.m_ini
  ),
  -- El ritmo: la suma de las tres ventas sobre la suma de sus días. Por día y
  -- no promedio de meses, para que uno de 30 y uno de 31 no pesen distinto.
  ritmo AS (
    SELECT branch_id, SUM(venta)/SUM(dias_mes) AS por_dia,
           MAX(m) AS mes_ult
    FROM u3 WHERE rn <= 3 GROUP BY 1
  ),
  -- El cumplimiento del mes -1, que es el MÁS RECIENTE de los tres que forman
  -- el ritmo: así la fórmula usa un solo conjunto de meses y no dos.
  cumpl AS (
    SELECT r.branch_id,
           COALESCE(
             (SELECT x.pct_cumplimiento FROM public.metas_resultado x
               WHERE x.branch_id = r.branch_id AND x.year_month = to_char(r.mes_ult, 'YYYY-MM')),
             (SELECT ROUND(u.venta / NULLIF(s.monto_meta, 0) * 100, 1)
                FROM public.metas_sucursal s
                JOIN u3 u ON u.branch_id = s.branch_id AND u.m = r.mes_ult
               WHERE s.branch_id = r.branch_id AND s.year_month = to_char(r.mes_ult, 'YYYY-MM'))
           ) AS pct
    FROM ritmo r
  ),
  calc AS (
    SELECT r.branch_id,
           GREATEST(100, ROUND(r.por_dia * o.dias * f.factor, 2)) AS propuesta,
           c.pct, f.factor
    FROM ritmo r
    CROSS JOIN objetivo o
    JOIN cumpl c ON c.branch_id = r.branch_id
    -- Sin cumplimiento medible (sala nueva, o mes sin meta) el factor es 1.00:
    -- no se pide crecimiento sobre algo que no se pudo medir.
    LEFT JOIN LATERAL (
      SELECT t.factor FROM public.metas_factor_cumplimiento t
       WHERE t.desde_pct <= COALESCE(c.pct, 0)
       ORDER BY t.desde_pct DESC LIMIT 1
    ) f ON true
    WHERE EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                  WHERE m.branch_id = r.branch_id AND NOT m.es_bodega)
  ),
  ins AS (
    INSERT INTO public.metas_sucursal
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       monto_propuesto, estado, nota)
    SELECT c.branch_id, p_year_month, c.propuesta, 0, c.propuesta, c.propuesta, 'propuesta',
           'Propuesta del sistema: el ritmo diario de los 3 meses cerrados por los días del mes, '
           || 'con factor ' || c.factor || ' por haber cerrado el mes anterior en '
           || COALESCE(c.pct::text || '%', 'sin meta')
    FROM calc c WHERE c.propuesta IS NOT NULL
    ON CONFLICT (branch_id, year_month) DO NOTHING
    RETURNING id, branch_id, year_month, monto_meta
  ),
  log AS (
    INSERT INTO public.metas_historial
      (meta_id, branch_id, year_month, evento, estado_despues, monto_despues, nota)
    SELECT i.id, i.branch_id, i.year_month, 'propuesta_generada', 'propuesta', i.monto_meta,
           'la calculó el portal con el ritmo de los meses cerrados y el factor de cumplimiento'
    FROM ins i
    RETURNING 1
  )
  SELECT count(*) INTO v_creadas FROM log;

  FOR v_b IN SELECT DISTINCT c.branch_id FROM public.metas_gasto_cuota c
             WHERE c.year_month = p_year_month AND c.estado = 'pendiente' LOOP
    PERFORM public.metas_aplicar_recuperacion(v_b, p_year_month);
  END LOOP;

  IF v_creadas > 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_PROPUESTAS',
      'Metas propuestas para ' || public.metas_mes_label(p_year_month),
      v_creadas || ' sala(s) ya tienen su meta propuesta. Revísalas, ajústalas y confírmalas.');
  END IF;

  RETURN v_creadas;
END;
$function$;

-- ── La explicación ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.explicar_meta_propuesta(
    p_branch_id bigint, p_year_month text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r json;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_view') THEN RETURN NULL; END IF;

  WITH
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
  u3 AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.branch_id ORDER BY c.m DESC) AS rn
    FROM comp c, objetivo o
    WHERE c.m < o.m_ini AND c.branch_id = p_branch_id
  ),
  ritmo AS (
    SELECT SUM(venta) AS suma_venta, SUM(dias_mes) AS suma_dias,
           SUM(venta)/SUM(dias_mes) AS por_dia, MAX(m) AS mes_ult
    FROM u3 WHERE rn <= 3
  ),
  cumpl AS (
    SELECT COALESCE(
      (SELECT x.pct_cumplimiento FROM public.metas_resultado x
        WHERE x.branch_id = p_branch_id AND x.year_month = to_char(r.mes_ult, 'YYYY-MM')),
      (SELECT ROUND(u.venta / NULLIF(s.monto_meta, 0) * 100, 1)
         FROM public.metas_sucursal s
         JOIN u3 u ON u.m = r.mes_ult
        WHERE s.branch_id = p_branch_id AND s.year_month = to_char(r.mes_ult, 'YYYY-MM'))
    ) AS pct,
    (SELECT s.monto_meta FROM public.metas_sucursal s
      WHERE s.branch_id = p_branch_id AND s.year_month = to_char(r.mes_ult, 'YYYY-MM')) AS meta_ult,
    to_char(r.mes_ult, 'YYYY-MM') AS ym_ult
    FROM ritmo r
  )
  SELECT json_build_object(
    'meses_base',  (SELECT json_agg(json_build_object(
                       'ym', to_char(u.m, 'YYYY-MM'), 'venta', round(u.venta, 2), 'dias', u.dias_mes)
                       ORDER BY u.m) FROM u3 u WHERE u.rn <= 3),
    'suma_venta',  round(r.suma_venta, 2),
    'suma_dias',   r.suma_dias,
    'ritmo_dia',   round(r.por_dia, 2),
    'dias_mes',    o.dias,
    'sub_ritmo',   round(r.por_dia * o.dias, 2),
    'ym_ultimo',   cu.ym_ult,
    'meta_ultimo', cu.meta_ult,
    'pct_ultimo',  cu.pct,
    'factor',      f.factor,
    'tramos',      (SELECT json_agg(json_build_object('desde', t.desde_pct, 'factor', t.factor)
                       ORDER BY t.desde_pct DESC) FROM public.metas_factor_cumplimiento t),
    'recalculada', GREATEST(100, ROUND(r.por_dia * o.dias * f.factor, 2))
  ) INTO r
  FROM ritmo r CROSS JOIN objetivo o CROSS JOIN cumpl cu
  LEFT JOIN LATERAL (
    SELECT t.factor FROM public.metas_factor_cumplimiento t
     WHERE t.desde_pct <= COALESCE(cu.pct, 0)
     ORDER BY t.desde_pct DESC LIMIT 1
  ) f ON true;

  RETURN r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.explicar_meta_propuesta(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explicar_meta_propuesta(bigint, text) TO authenticated, service_role;

-- Verificado en prod como usuario autenticado. La Popular / agosto 2026:
--   119,744.50 ÷ 92 días = 1,301.57/día × 31 días = 40,348.69 × 1.08 = 43,576.59
--   (1.08 porque cerró jul-2026 en 108.6% de su meta de 39,709.35)
-- Las 6 salas dan: 43,576.59 · 53,042.96 · 46,353.10 · 48,994.68 · 41,221.47 ·
-- 16,559.64 — total 249,748.44 contra 241,503.53 de la fórmula anterior (+3.4%).
--
-- Las metas de agosto NO se regeneraron: ya estaban confirmadas esperando
-- aprobación, y cambiarlas por debajo habría movido un número que el supervisor
-- ya firmó. La tarjeta lo dice cuando el recálculo no coincide con lo guardado.
