-- El portal tutea (DESIGN.md §26.7) y la notificación del día 25 salió en
-- voseo («Revisalas, ajustalas y confirmalas»). Mismo cuerpo que
-- 20260804040648, solo cambia esa línea.

SET lock_timeout = '5s';

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

  -- Día de propuesta: generar + avisar al supervisor
  IF v_dia = COALESCE(v_dia_propuesta, 25) THEN
    v_creadas := public.generar_propuestas_metas(v_ym_sig);
    IF v_creadas > 0 THEN
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_PROPUESTAS',
        'Metas propuestas para ' || public.metas_mes_label(v_ym_sig),
        v_creadas || ' sala(s) ya tienen su meta propuesta. Revísalas, ajústalas y confírmalas.');
    END IF;
    v_out := v_out || 'propuestas=' || v_creadas || ' ';
  END IF;

  -- Recordatorio al supervisor: quedan propuestas/devueltas del mes siguiente
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

  -- Recordatorio al gerente: confirmadas esperando aprobación
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

  -- El mes ya empezó y hay metas sin oficializar: a ambos, hasta que se resuelva
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
