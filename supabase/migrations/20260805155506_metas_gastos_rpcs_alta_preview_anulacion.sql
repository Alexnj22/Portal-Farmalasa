SET lock_timeout = '5s';

-- ── Vista previa: el desglose mes × sala SIN escribir nada ───────────────────
-- Es lo que pinta el modal antes de guardar. Usa el MISMO `metas_gasto_reparto`
-- que el alta real, así que lo que se ve es exactamente lo que se guarda.
CREATE OR REPLACE FUNCTION public.preview_metas_gasto(
    p_salas jsonb, p_ym_inicio text, p_meses integer)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_margen numeric;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;
  IF p_meses IS NULL OR p_meses < 1 OR p_meses > 36 THEN
    RAISE EXCEPTION 'MESES_INVALIDOS: %', p_meses;
  END IF;
  IF p_ym_inicio IS NULL OR p_ym_inicio !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_inicio;
  END IF;

  SELECT margen_recuperacion_pct INTO v_margen FROM public.metas_config LIMIT 1;

  RETURN json_build_object(
    'margen_pct', v_margen,
    'cuotas', coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.year_month, t.branch_id) FROM (
        SELECT r.branch_id,
               (SELECT b.name FROM public.branches b WHERE b.id = r.branch_id) AS sala,
               r.year_month, r.monto_gasto, r.monto_venta
        FROM public.metas_gasto_reparto(p_salas, p_ym_inicio, p_meses, v_margen) r
      ) t), '[]'::json));
END;
$function$;

-- ── Alta ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_metas_gasto(
    p_concepto text, p_salas jsonb, p_ym_inicio text, p_meses integer,
    p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_margen numeric;
  v_total  numeric;
  v_gasto  bigint;
  v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  s jsonb;
  v_afectada record;
  v_reabiertas int := 0;
  v_cuotas int;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;
  IF p_concepto IS NULL OR btrim(p_concepto) = '' THEN
    RAISE EXCEPTION 'CONCEPTO_REQUERIDO: hay que decir de qué gasto se trata';
  END IF;
  IF p_meses IS NULL OR p_meses < 1 OR p_meses > 36 THEN
    RAISE EXCEPTION 'MESES_INVALIDOS: %', p_meses;
  END IF;
  IF p_ym_inicio IS NULL OR p_ym_inicio !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_inicio;
  END IF;
  -- Decisión del usuario: solo a meses que todavía no arrancaron. Nadie ve su
  -- meta moverse a mitad de mes.
  IF p_ym_inicio <= v_ym_actual THEN
    RAISE EXCEPTION 'MES_YA_ARRANCADO: un gasto solo se carga a meses que todavía no empezaron';
  END IF;
  IF p_salas IS NULL OR jsonb_typeof(p_salas) <> 'array' OR jsonb_array_length(p_salas) = 0 THEN
    RAISE EXCEPTION 'SALAS_REQUERIDAS: hay que elegir al menos una sala y su monto';
  END IF;

  FOR s IN SELECT value FROM jsonb_array_elements(p_salas) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                   WHERE m.branch_id = (s->>'branch_id')::bigint AND NOT m.es_bodega) THEN
      RAISE EXCEPTION 'SUCURSAL_INVALIDA: %', s->>'branch_id';
    END IF;
    IF coalesce((s->>'monto')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'MONTO_INVALIDO';
    END IF;
  END LOOP;

  SELECT margen_recuperacion_pct INTO v_margen FROM public.metas_config LIMIT 1;
  IF coalesce(v_margen, 0) <= 0 THEN RAISE EXCEPTION 'MARGEN_INVALIDO'; END IF;

  SELECT sum(round((value->>'monto')::numeric, 2)) INTO v_total
  FROM jsonb_array_elements(p_salas);

  INSERT INTO public.metas_gasto (concepto, monto_total, margen_pct, meses, ym_inicio, nota, creado_por)
  VALUES (btrim(p_concepto), v_total, v_margen, p_meses, p_ym_inicio,
          NULLIF(btrim(p_nota), ''), public.auth_employee_id())
  RETURNING id INTO v_gasto;

  INSERT INTO public.metas_gasto_sala (gasto_id, branch_id, monto)
  SELECT v_gasto, (value->>'branch_id')::bigint, round((value->>'monto')::numeric, 2)
  FROM jsonb_array_elements(p_salas);

  INSERT INTO public.metas_gasto_cuota (gasto_id, branch_id, year_month, monto_gasto, monto_venta)
  SELECT v_gasto, r.branch_id, r.year_month, r.monto_gasto, r.monto_venta
  FROM public.metas_gasto_reparto(p_salas, p_ym_inicio, p_meses, v_margen) r;
  GET DIAGNOSTICS v_cuotas = ROW_COUNT;

  -- Cada meta afectada que YA estaba confirmada o aprobada vuelve a propuesta:
  -- el número que el gerente firmó cambió, y tiene que volver a verlo.
  FOR v_afectada IN
    SELECT DISTINCT c.branch_id, c.year_month
    FROM public.metas_gasto_cuota c WHERE c.gasto_id = v_gasto
  LOOP
    UPDATE public.metas_sucursal m
    SET estado = 'propuesta', nota_devolucion = NULL
    WHERE m.branch_id = v_afectada.branch_id
      AND m.year_month = v_afectada.year_month
      AND m.estado IN ('confirmada_supervisor', 'oficial');
    IF FOUND THEN
      v_reabiertas := v_reabiertas + 1;
      PERFORM public.metas_log(
        (SELECT id FROM public.metas_sucursal
          WHERE branch_id = v_afectada.branch_id AND year_month = v_afectada.year_month),
        'reabierta_por_gasto', NULL, 'propuesta', NULL, NULL,
        'se le cargó «' || btrim(p_concepto) || '»: hay que confirmarla y aprobarla otra vez');
    END IF;

    PERFORM public.metas_aplicar_recuperacion(v_afectada.branch_id, v_afectada.year_month);

    PERFORM public.metas_log(
      (SELECT id FROM public.metas_sucursal
        WHERE branch_id = v_afectada.branch_id AND year_month = v_afectada.year_month),
      'gasto_cargado', NULL, NULL, NULL,
      (SELECT monto_meta FROM public.metas_sucursal
        WHERE branch_id = v_afectada.branch_id AND year_month = v_afectada.year_month),
      btrim(p_concepto));
  END LOOP;

  IF v_reabiertas > 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_REABIERTAS',
      'Metas por confirmar de nuevo',
      v_reabiertas || ' meta(s) cambiaron de monto porque se les cargó «'
        || btrim(p_concepto) || '». Hay que confirmarlas otra vez.');
  END IF;

  RETURN json_build_object(
    'gasto_id', v_gasto, 'monto_total', v_total, 'margen_pct', v_margen,
    'venta_total', round(v_total / (v_margen / 100), 2),
    'cuotas', v_cuotas, 'metas_reabiertas', v_reabiertas);
END;
$function$;

-- ── Anular ───────────────────────────────────────────────────────────────────
-- Se anulan SOLO las cuotas de meses que todavía no arrancaron. Las de meses ya
-- en curso o cerrados quedan: esa meta ya se persiguió con ese número.
CREATE OR REPLACE FUNCTION public.anular_metas_gasto(p_id bigint, p_nota text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  v_row public.metas_gasto%ROWTYPE;
  v_afectada record;
  v_anuladas int := 0;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;
  IF p_nota IS NULL OR btrim(p_nota) = '' THEN
    RAISE EXCEPTION 'NOTA_REQUERIDA: una anulación siempre lleva el porqué';
  END IF;

  SELECT * INTO v_row FROM public.metas_gasto WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GASTO_NO_EXISTE'; END IF;
  IF v_row.estado = 'anulado' THEN RAISE EXCEPTION 'GASTO_YA_ANULADO'; END IF;

  UPDATE public.metas_gasto_cuota
  SET estado = 'anulada'
  WHERE gasto_id = p_id AND estado = 'pendiente' AND year_month > v_ym_actual;
  GET DIAGNOSTICS v_anuladas = ROW_COUNT;

  UPDATE public.metas_gasto
  SET estado = 'anulado', anulado_por = public.auth_employee_id(),
      anulado_at = now(), anulado_nota = btrim(p_nota)
  WHERE id = p_id;

  FOR v_afectada IN
    SELECT DISTINCT c.branch_id, c.year_month
    FROM public.metas_gasto_cuota c
    WHERE c.gasto_id = p_id AND c.year_month > v_ym_actual
  LOOP
    PERFORM public.metas_aplicar_recuperacion(v_afectada.branch_id, v_afectada.year_month);
    PERFORM public.metas_log(
      (SELECT id FROM public.metas_sucursal
        WHERE branch_id = v_afectada.branch_id AND year_month = v_afectada.year_month),
      'gasto_anulado', NULL, NULL, NULL,
      (SELECT monto_meta FROM public.metas_sucursal
        WHERE branch_id = v_afectada.branch_id AND year_month = v_afectada.year_month),
      'se quitó «' || v_row.concepto || '» — ' || btrim(p_nota));
  END LOOP;

  RETURN json_build_object('gasto_id', p_id, 'cuotas_anuladas', v_anuladas);
END;
$function$;

-- ── Listado ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_metas_gastos()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_view') THEN
    RETURN '[]'::json;
  END IF;

  RETURN coalesce((
    SELECT json_agg(to_json(t) ORDER BY t.created_at DESC) FROM (
      SELECT g.id, g.concepto, g.monto_total, g.margen_pct, g.meses, g.ym_inicio,
             g.nota, g.estado, g.created_at, g.anulado_nota, g.anulado_at,
             round(g.monto_total / (g.margen_pct / 100), 2) AS venta_total,
             (SELECT e.name FROM public.employees e WHERE e.id = g.creado_por) AS creado_por_nombre,
             (SELECT json_agg(to_json(x) ORDER BY x.sala)
                FROM (SELECT gs.branch_id, gs.monto,
                             (SELECT b.name FROM public.branches b WHERE b.id = gs.branch_id) AS sala
                      FROM public.metas_gasto_sala gs WHERE gs.gasto_id = g.id) x) AS salas,
             (SELECT count(*) FROM public.metas_gasto_cuota c
               WHERE c.gasto_id = g.id AND c.estado = 'pendiente') AS cuotas_vivas,
             (SELECT coalesce(sum(c.monto_venta), 0) FROM public.metas_gasto_cuota c
               WHERE c.gasto_id = g.id AND c.estado = 'pendiente') AS venta_viva
      FROM public.metas_gasto g
    ) t), '[]'::json);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.preview_metas_gasto(jsonb, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.preview_metas_gasto(jsonb, text, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.crear_metas_gasto(text, jsonb, text, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_metas_gasto(text, jsonb, text, integer, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.anular_metas_gasto(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.anular_metas_gasto(bigint, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_metas_gastos() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_metas_gastos() TO authenticated, service_role;

-- Verificado en prod dentro de una transacción revertida, con el caso escrito a
-- mano en el plan (Salud 3, octubre 2026):
--   $1,200 a 3 meses, margen 25% → $400/mes de gasto → $1,600/mes de venta
--   meta 44,540.13 + 1,600.00 = 46,140.13  ← el número del plan, exacto
--   la meta oficial volvió a «propuesta» y quedó su renglón en la bitácora
--   suma de cuotas 1,200.00 y suma de ventas 4,800.00, exactas
--   la aritmética cierra sobre sí misma: 1,600 × 25% = 400 = la cuota del mes
--   redondeo $1,000÷3 → 333.33 · 333.33 · 333.34 (suman 1,000.00) y las ventas
--     1,333.33 · 1,333.33 · 1,333.34 (suman 4,000.00)
--   cargar al mes en curso → MES_YA_ARRANCADO
--   anular → la meta vuelve a 44,540.13 con recuperación en 0
