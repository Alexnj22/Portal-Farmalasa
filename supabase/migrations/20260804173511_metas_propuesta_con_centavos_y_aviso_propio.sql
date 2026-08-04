SET lock_timeout = '5s';

-- 1) La propuesta ya no se redondea a la decena: la meta es un monto, y
--    redondear $41,006.81 a $41,010 mueve el objetivo sin que nadie lo decida.
-- 2) El aviso lo emite ESTA función y no quien la llama. Estaba solo en
--    `metas_ciclo_diario`, así que generar desde el botón de la pantalla —o desde
--    una consulta— creaba las propuestas en silencio: nadie se enteraba de que
--    había metas esperando confirmación. Un aviso que depende del llamador es un
--    aviso que se olvida, y se olvidó (2026-08-04: se generaron las de agosto y
--    no llegó nada).
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
  idx_sala AS (
    SELECT a.branch_id,
           a.venta / NULLIF((SELECT SUM(p.venta)/SUM(p.dias_mes) FROM
             (SELECT p2.*, row_number() OVER (ORDER BY p2.m DESC) AS rn FROM comp p2
              WHERE p2.branch_id = a.branch_id AND p2.m < a.m) p WHERE p.rn <= 3) * a.dias_mes, 0) AS idx
    FROM comp a, objetivo o WHERE a.m = o.m_ini - interval '12 months'
  ),
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
  norma AS (SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY p.por_hora))::numeric AS n FROM prod p),
  calc AS (
    SELECT r.branch_id,
      GREATEST(100, ROUND(
        r.por_dia * o.dias
        * (1 + (i.bruto - 1) * i.n / (i.n + 1))
        * (c.factor_crecimiento
           + LEAST(c.empuje_max,
                   GREATEST(0, nm.n * p.h_sem * 4.35 / NULLIF(p.venta_mes, 0) - 1) * c.empuje_peso))
        , 2)) AS propuesta
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

  IF v_creadas > 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_PROPUESTAS',
      'Metas propuestas para ' || public.metas_mes_label(p_year_month),
      v_creadas || ' sala(s) ya tienen su meta propuesta. Revísalas, ajústalas y confírmalas.');
  END IF;

  RETURN v_creadas;
END;
$function$;

-- El ciclo diario ya no avisa por su cuenta: lo hace la función que genera, así
-- que avisar acá además mandaría el aviso dos veces.
CREATE OR REPLACE FUNCTION public.metas_ciclo_diario()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dia integer := EXTRACT(day FROM v_hoy)::int;
  v_ym_actual text := to_char(v_hoy, 'YYYY-MM');
  v_ym_sig text := to_char((date_trunc('month', v_hoy) + interval '1 month')::date, 'YYYY-MM');
  v_dia_propuesta integer;
  v_creadas integer := 0;
  v_n integer;
  v_out text := '';
BEGIN
  SELECT dia_propuesta INTO v_dia_propuesta FROM public.metas_config LIMIT 1;

  IF v_dia = COALESCE(v_dia_propuesta, 25) THEN
    -- Avisa `generar_propuestas_metas` misma.
    v_creadas := public.generar_propuestas_metas(v_ym_sig);
    v_out := v_out || 'propuestas=' || v_creadas || ' ';
  END IF;

  IF v_dia >= 28 THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month = v_ym_sig AND estado IN ('propuesta', 'devuelta');
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_RECORDATORIO',
        'Metas sin confirmar',
        'Quedan ' || v_n || ' meta(s) de ' || public.metas_mes_label(v_ym_sig) || ' sin confirmar.');
      v_out := v_out || 'rec_supervisor=' || v_n || ' ';
    END IF;
  END IF;

  IF v_dia >= 30 OR v_dia <= 5 THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month IN (v_ym_actual, v_ym_sig) AND estado = 'confirmada_supervisor';
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Gerente General', 'METAS_RECORDATORIO',
        'Metas por aprobar',
        v_n || ' meta(s) confirmadas esperan tu aprobación.');
      v_out := v_out || 'rec_gerente=' || v_n || ' ';
    END IF;
  END IF;

  SELECT count(*) INTO v_n FROM public.metas_sucursal
  WHERE year_month = v_ym_actual AND estado <> 'oficial';
  IF v_n > 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_RECORDATORIO',
      'La meta de ' || public.metas_mes_label(v_ym_actual) || ' sigue pendiente',
      v_n || ' sala(s) aún no tienen su meta oficial. Las salas la ven como pendiente.');
    PERFORM public.metas_notificar_rol('Gerente General', 'METAS_RECORDATORIO',
      'La meta de ' || public.metas_mes_label(v_ym_actual) || ' sigue pendiente',
      v_n || ' sala(s) aún no tienen su meta oficial.');
    v_out := v_out || 'pendientes_mes_actual=' || v_n;
  END IF;

  RETURN COALESCE(NULLIF(v_out, ''), 'sin novedades');
END;
$function$;
