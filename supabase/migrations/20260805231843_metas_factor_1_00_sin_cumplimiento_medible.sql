SET lock_timeout = '5s';

-- ═══ EL FACTOR SIN CUMPLIMIENTO MEDIBLE, EXPLÍCITO ══════════════════════════
-- El «1.00 cuando no hay cumplimiento que medir» nunca estuvo programado: venía
-- prestado del tramo de más abajo. La primera versión de la tabla tenía
-- (105,1.08) (95,1.05) (90,1.02) (0,1.00), así que el `COALESCE(pct, 0)` caía en
-- el tramo 0 y devolvía 1.00 de casualidad. Cuando la corrección de los tramos
-- (20260805200804) los reemplazó por (95,1.02) (90,1.05) (0,1.10), el caso «sin
-- cumplimiento» se fue montado con el tramo de abajo y pasó a valer 1.10: a una
-- sala nueva se le pedía 10% de crecimiento por no tener historia, que es lo
-- contrario del criterio escrito.
--
-- Nadie lo vio porque la rama nunca corrió: las 6 salas tienen cumplimiento
-- medible desde que existe el módulo, y ninguna meta guardada salió por ahí
-- (verificado: 0 filas de metas_sucursal con esa nota). Se arregla antes de que
-- abra una sala.
--
-- Ahora el 1.00 va explícito y NO depende de qué tramo esté abajo: el LATERAL no
-- devuelve fila cuando `pct` es NULL, y el COALESCE pone el 1.00. Mover, agregar
-- o quitar tramos ya no puede cambiarlo en silencio.

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
    -- no se pide crecimiento sobre algo que no se pudo medir. El 1.00 está acá
    -- y no en un tramo de la tabla A PROPÓSITO: montado en el tramo de abajo
    -- cambia solo el día que alguien reordena los tramos, que es como se rompió.
    LEFT JOIN LATERAL (
      SELECT COALESCE((
        SELECT t.factor FROM public.metas_factor_cumplimiento t
         WHERE c.pct IS NOT NULL AND t.desde_pct <= c.pct
         ORDER BY t.desde_pct DESC LIMIT 1
      ), 1.00) AS factor
    ) f ON true
    WHERE EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                  WHERE m.branch_id = r.branch_id AND NOT m.es_bodega)
  ),
  ins AS (
    INSERT INTO public.metas_sucursal
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       monto_propuesto, estado, nota)
    SELECT c.branch_id, p_year_month, c.propuesta, 0, c.propuesta, c.propuesta, 'propuesta',
           CASE WHEN c.pct IS NULL THEN
             'Propuesta del sistema: el ritmo diario de los 3 meses cerrados por los días del mes. '
             || 'El mes anterior no tuvo meta, así que no hay cumplimiento que medir y no se pide '
             || 'crecimiento (factor 1.00)'
           ELSE
             'Propuesta del sistema: el ritmo diario de los 3 meses cerrados por los días del mes, '
             || 'con factor ' || c.factor || ' por haber cerrado el mes anterior en ' || c.pct || '%'
           END
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
-- Mismo arreglo. Tiene que dar el MISMO factor que la propuesta: es la función
-- que la tarjeta usa para rehacer la cuenta y avisar si no coincide.
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
    SELECT COALESCE((
      SELECT t.factor FROM public.metas_factor_cumplimiento t
       WHERE cu.pct IS NOT NULL AND t.desde_pct <= cu.pct
       ORDER BY t.desde_pct DESC LIMIT 1
    ), 1.00) AS factor
  ) f ON true;

  RETURN r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.explicar_meta_propuesta(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explicar_meta_propuesta(bigint, text) TO authenticated, service_role;
