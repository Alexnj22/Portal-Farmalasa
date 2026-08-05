SET lock_timeout = '5s';

-- ── El ciclo diario congela el mes que cerró ────────────────────────────────
-- El día 5 y no el 1: `refresh-sales-daily-stats-full` repasa 365 días cada
-- mañana a las 6:20 UTC, así que el último día de un mes puede no estar
-- completo cuando este cron corre (14:00 UTC del día 1). Cuatro días de margen
-- alcanzan de sobra, y congelar de más un mes incompleto sería peor que
-- congelarlo tarde: `congelar_metas_mes` sin forzar no vuelve a tocarlo.
CREATE OR REPLACE FUNCTION public.metas_ciclo_diario()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dia integer := EXTRACT(day FROM v_hoy)::int;
  v_ym_actual text := to_char(v_hoy, 'YYYY-MM');
  v_ym_sig text := to_char((date_trunc('month', v_hoy) + interval '1 month')::date, 'YYYY-MM');
  v_ym_ant text := to_char((date_trunc('month', v_hoy) - interval '1 month')::date, 'YYYY-MM');
  v_dia_propuesta integer;
  v_creadas integer := 0;
  v_n integer;
  v_out text := '';
BEGIN
  SELECT dia_propuesta INTO v_dia_propuesta FROM public.metas_config LIMIT 1;

  IF v_dia = COALESCE(v_dia_propuesta, 25) THEN
    v_creadas := public.generar_propuestas_metas(v_ym_sig);
    v_out := v_out || 'propuestas=' || v_creadas || ' ';
  END IF;

  -- El mes que cerró queda congelado con las reglas que regían ese mes.
  IF v_dia = 5 THEN
    v_n := public.congelar_metas_mes(v_ym_ant, false);
    v_out := v_out || 'congelado_' || v_ym_ant || '=' || v_n || ' ';
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

  -- Días 1, 3 y después una vez por semana: el mes en curso sin oficializar es
  -- una situación que dura, no una novedad diaria.
  IF v_dia IN (1, 3, 8, 15, 22, 29) THEN
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
  END IF;

  RETURN COALESCE(NULLIF(v_out, ''), 'sin novedades');
END;
$function$;

-- ── Corregir un mes cerrado vuelve a congelarlo ─────────────────────────────
-- Sin esto, la corrección que `upsert_meta_manual` permite (exigiendo el
-- porqué) no se vería NUNCA en el histórico: la fila congelada seguiría con el
-- monto viejo y la pantalla no se movería. Un cambio que el portal acepta y no
-- muestra es peor que no aceptarlo.
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
    PERFORM public.metas_aplicar_recuperacion(p_branch_id, p_year_month);
    -- Un mes cerrado que recién recibe su meta: hay que congelarlo con ella.
    IF p_year_month < v_ym_actual THEN
      PERFORM public.congelar_metas_mes(p_year_month, true);
    END IF;
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

  -- La corrección de un mes ya congelado tiene que verse.
  IF p_year_month < v_ym_actual THEN
    PERFORM public.congelar_metas_mes(p_year_month, true);
  END IF;
END;
$function$;

-- Verificado en prod dentro de una transacción revertida: corregir la meta de
-- julio 2026 (mes cerrado y congelado) de $39,709.35 a $45,000 volvió a
-- congelar el mes —el histórico pasó a mostrar 45,000 y 95.8%— mientras las
-- reglas congeladas de ese mes seguían siendo las suyas (umbral 95, bono 0.5%).
