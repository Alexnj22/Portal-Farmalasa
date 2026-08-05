SET lock_timeout = '5s';

-- Con `monto_meta = monto_base + monto_recuperacion` como invariante de la
-- tabla, los tres RPC que escribían `monto_meta` a secas tienen que escribir la
-- BASE y dejar que la recuperación recomponga el total.

-- ── Confirmar (supervisor) ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_meta_supervisor(
    p_id bigint, p_monto numeric DEFAULT NULL::numeric, p_nota text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_pendientes integer;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;
  SELECT * INTO v_row FROM public.metas_sucursal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'META_NO_EXISTE'; END IF;
  IF v_row.estado NOT IN ('propuesta', 'devuelta') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: la meta está en %', v_row.estado;
  END IF;
  IF p_monto IS NOT NULL AND p_monto <= 0 THEN RAISE EXCEPTION 'MONTO_INVALIDO'; END IF;

  -- El monto que llega del navegador es la BASE de venta: la recuperación de
  -- gastos no se confirma ni se ajusta, se arrastra.
  UPDATE public.metas_sucursal
  SET monto_base     = COALESCE(p_monto, monto_base),
      monto_meta     = COALESCE(p_monto, monto_base) + monto_recuperacion,
      nota           = COALESCE(p_nota, nota),
      estado         = 'confirmada_supervisor',
      supervisor_por = public.auth_employee_id(),
      supervisor_at  = now()
  WHERE id = p_id;

  PERFORM public.metas_log(p_id, 'confirmada', v_row.estado, 'confirmada_supervisor',
    v_row.monto_base, COALESCE(p_monto, v_row.monto_base), p_nota);

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado IN ('propuesta', 'devuelta');
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Gerente General', 'METAS_POR_APROBAR',
      'Metas por aprobar',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' están confirmadas y esperan tu aprobación.');
  END IF;
END;
$function$;

-- ── Ingreso manual ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_meta_manual(
    p_branch_id bigint, p_year_month text, p_monto numeric, p_nota text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp  uuid;
  v_row  public.metas_sucursal%ROWTYPE;
  v_new  bigint;
  v_nota text := NULLIF(btrim(p_nota), '');
  v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
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
  IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                 WHERE m.branch_id = p_branch_id AND NOT m.es_bodega) THEN
    RAISE EXCEPTION 'SUCURSAL_INVALIDA: %', p_branch_id;
  END IF;

  v_emp := public.auth_employee_id();

  SELECT * INTO v_row FROM public.metas_sucursal
  WHERE branch_id = p_branch_id AND year_month = p_year_month
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.metas_sucursal
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       estado, nota, supervisor_por, supervisor_at)
    VALUES
      (p_branch_id, p_year_month, p_monto, 0, p_monto, 'oficial', v_nota, v_emp, now())
    RETURNING id INTO v_new;
    PERFORM public.metas_log(v_new, 'ingreso_manual', NULL, 'oficial', NULL, p_monto, v_nota);
    -- Puede haber cuotas de gastos esperando este mes: la fila recién nace.
    PERFORM public.metas_aplicar_recuperacion(p_branch_id, p_year_month);
    RETURN;
  END IF;

  IF v_row.estado = 'confirmada_supervisor' THEN
    RAISE EXCEPTION 'META_EN_APROBACION: esta meta ya fue confirmada y espera al gerente';
  END IF;
  IF v_row.estado = 'oficial' AND p_year_month >= v_ym_actual THEN
    RAISE EXCEPTION 'META_YA_OFICIAL: esta meta ya está aprobada';
  END IF;
  IF v_row.estado = 'oficial' AND v_nota IS NULL THEN
    RAISE EXCEPTION 'NOTA_REQUERIDA: hay que dejar dicho por qué se corrige un mes ya cerrado';
  END IF;

  -- Lo que se teclea es la base de venta; la recuperación se arrastra.
  UPDATE public.metas_sucursal
  SET monto_base = p_monto,
      monto_meta = p_monto + monto_recuperacion,
      nota       = COALESCE(v_nota, nota),
      supervisor_por = CASE WHEN v_row.estado = 'oficial' THEN v_emp ELSE supervisor_por END,
      supervisor_at  = CASE WHEN v_row.estado = 'oficial' THEN now() ELSE supervisor_at END
  WHERE id = v_row.id;

  PERFORM public.metas_log(v_row.id,
    CASE WHEN v_row.estado = 'oficial' THEN 'mes_cerrado_corregido' ELSE 'monto_ajustado' END,
    v_row.estado, v_row.estado, v_row.monto_base, p_monto, v_nota);
END;
$function$;

-- ── Las propuestas del portal ────────────────────────────────────────────────
-- Al crear la fila del mes siguiente puede haber cuotas de gastos ya cargadas
-- esperándola: se suman en el momento, así la propuesta nace con su meta
-- completa y el supervisor confirma el número real.
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
    INSERT INTO public.metas_sucursal
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       monto_propuesto, estado, nota)
    SELECT c.branch_id, p_year_month, c.propuesta, 0, c.propuesta, c.propuesta, 'propuesta',
           'Propuesta del sistema: el ritmo de venta de los últimos 3 meses, ajustado por el peso del mes y por el crecimiento pedido'
    FROM calc c WHERE c.propuesta IS NOT NULL
    ON CONFLICT (branch_id, year_month) DO NOTHING
    RETURNING id, branch_id, year_month, monto_meta
  ),
  log AS (
    INSERT INTO public.metas_historial
      (meta_id, branch_id, year_month, evento, estado_despues, monto_despues, nota)
    SELECT i.id, i.branch_id, i.year_month, 'propuesta_generada', 'propuesta', i.monto_meta,
           'la calculó el portal con el ritmo de los meses cerrados'
    FROM ins i
    RETURNING 1
  )
  SELECT count(*) INTO v_creadas FROM log;

  -- Las cuotas de gastos que estaban esperando este mes se suman ahora.
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
