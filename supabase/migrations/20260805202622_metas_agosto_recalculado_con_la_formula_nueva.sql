SET lock_timeout = '5s';

-- Agosto 2026, recalculado con la fórmula nueva (pedido del usuario).
--
-- Las 6 metas están en `confirmada_supervisor`, así que ningún RPC del flujo las
-- deja tocar: `confirmar_meta_supervisor` exige propuesta/devuelta y
-- `upsert_meta_manual` las rechaza a propósito (v2.372.2). Es correcto que sea
-- así — por eso este recálculo va como una operación administrativa explícita y
-- con su rastro, no como un atajo por el flujo.
--
-- NO se cambia el estado: quien pidió el recálculo es el mismo supervisor que
-- las confirmó. Lo que sí queda es el renglón en la bitácora, con el monto de
-- antes y el de después, y el aviso a quien tenga que enterarse.
--
-- `monto_propuesto` también se actualiza: es «lo que propuso el sistema», y con
-- la fórmula nueva la propuesta ES este número. Si quedara el viejo, la tarjeta
-- mostraría un desglose que no reproduce el monto que tiene encima.
DO $$
DECLARE
  v_ym  text := '2026-08';
  v_n   int  := 0;
  fila  record;   -- `fila` y no `m`: `m` es el nombre de la columna del mes en la consulta
BEGIN
  FOR fila IN
    WITH
    objetivo AS (SELECT (v_ym || '-01')::date AS m_ini,
                        EXTRACT(day FROM ((v_ym || '-01')::date + interval '1 month -1 day'))::int AS dias),
    agg AS (SELECT d.branch_id, date_trunc('month', d.date)::date AS mes,
                   SUM(d.sum_total)::numeric AS venta, COUNT(*) AS dias_dato
            FROM public.sales_daily_stats d GROUP BY 1, 2),
    comp AS (SELECT a.*, EXTRACT(day FROM (a.mes + interval '1 month -1 day'))::int AS dias_mes
             FROM agg a
             WHERE a.dias_dato = EXTRACT(day FROM (a.mes + interval '1 month -1 day'))::int),
    u3 AS (SELECT c.*, row_number() OVER (PARTITION BY c.branch_id ORDER BY c.mes DESC) AS rn
           FROM comp c, objetivo o WHERE c.mes < o.m_ini),
    ritmo AS (SELECT branch_id, SUM(venta)/SUM(dias_mes) AS por_dia, MAX(mes) AS mes_ult
              FROM u3 WHERE rn <= 3 GROUP BY 1),
    cumpl AS (
      SELECT r.branch_id, r.por_dia, r.mes_ult,
             COALESCE(
               (SELECT x.pct_cumplimiento FROM public.metas_resultado x
                 WHERE x.branch_id = r.branch_id AND x.year_month = to_char(r.mes_ult, 'YYYY-MM')),
               (SELECT ROUND(u.venta / NULLIF(s.monto_meta, 0) * 100, 1)
                  FROM public.metas_sucursal s
                  JOIN u3 u ON u.branch_id = s.branch_id AND u.mes = r.mes_ult
                 WHERE s.branch_id = r.branch_id AND s.year_month = to_char(r.mes_ult, 'YYYY-MM'))
             ) AS pct
      FROM ritmo r)
    SELECT s.id, s.branch_id, s.monto_base AS antes, s.monto_recuperacion AS recup,
           GREATEST(100, ROUND(c.por_dia * o.dias * f.factor, 2)) AS nuevo,
           c.pct, f.factor
    FROM public.metas_sucursal s
    JOIN cumpl c ON c.branch_id = s.branch_id
    CROSS JOIN objetivo o
    LEFT JOIN LATERAL (
      SELECT t.factor FROM public.metas_factor_cumplimiento t
       WHERE t.desde_pct <= COALESCE(c.pct, 0) ORDER BY t.desde_pct DESC LIMIT 1) f ON true
    WHERE s.year_month = v_ym
      -- Una meta ya oficial no se toca por acá: eso lo decide el gerente.
      AND s.estado IN ('propuesta', 'devuelta', 'confirmada_supervisor')
  LOOP
    UPDATE public.metas_sucursal
    SET monto_propuesto = fila.nuevo,
        monto_base      = fila.nuevo,
        monto_meta      = fila.nuevo + fila.recup,
        nota = 'Recalculada con la fórmula del ritmo por factor de cumplimiento: '
               || 'factor ' || fila.factor || ' por haber cerrado el mes anterior en '
               || COALESCE(fila.pct::text || '%', 'sin meta')
    WHERE id = fila.id;

    PERFORM public.metas_log(fila.id, 'recalculada_por_formula', NULL, NULL,
      fila.antes, fila.nuevo,
      'se cambió la fórmula del portal; factor ' || fila.factor
        || ' por cerrar el mes anterior en ' || COALESCE(fila.pct::text || '%', 'sin meta'));

    v_n := v_n + 1;
  END LOOP;

  IF v_n > 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_AJUSTADA',
      'Las metas de agosto se recalcularon',
      'Cambió la fórmula del portal y ' || v_n || ' meta(s) de agosto tienen monto nuevo. '
      || 'Revisalas antes de que el gerente las apruebe.');
    PERFORM public.metas_notificar_rol('Gerente General', 'METAS_AJUSTADA',
      'Las metas de agosto se recalcularon',
      'Cambió la fórmula del portal y ' || v_n || ' meta(s) de agosto tienen monto nuevo.');
  END IF;

  RAISE NOTICE 'metas recalculadas: %', v_n;
END $$;

-- Resultado verificado en prod, las 6 con su renglón en la bitácora:
--   La Popular  41,006.81 → 41,155.66   (factor 1.02, cerró jul en 108.6%)
--   Salud 1     51,341.07 → 51,527.44   (factor 1.02, 96.0%)
--   Salud 2     44,865.86 → 45,028.73   (factor 1.02, 104.4%)
--   Salud 3     46,125.14 → 46,272.75   (factor 1.02, 112.8%)
--   Salud 4     41,825.10 → 42,433.87   (factor 1.05, 94.0%)  ← la que más sube
--   Salud 5     16,339.55 → 16,086.50   (factor 1.02, 103.4%)  ← la única que baja
--   total 241,503.53 → 242,504.95
-- Las 6 siguen en `confirmada_supervisor`, esperando al gerente.
