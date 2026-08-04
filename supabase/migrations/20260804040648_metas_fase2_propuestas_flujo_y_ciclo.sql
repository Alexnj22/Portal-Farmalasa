-- Metas — Fase 2 (docs/PLAN-METAS-2026-08-03.md §4): propuestas automáticas,
-- flujo supervisor→gerente y ciclo diario con notificaciones.
--
-- Estados: propuesta → confirmada_supervisor → oficial, con devuelta como
-- desvío del gerente (vuelve al supervisor con nota). El sistema NUNCA
-- oficializa solo (decisión §8.3): si el mes llega sin aprobar, recordatorios.
-- Notificaciones: filas en `notifications` por empleado ACTIVO del rol
-- (mismo patrón que check-sales-reconciliation); sin depender del push.
--
-- NOTA: generar_propuestas_metas fue reemplazada minutos después por
-- 20260804040831 (guardas de historia incompleta + crecimiento acotado — el
-- backtest destapó explosiones de hasta +652% sin ellas).

SET lock_timeout = '5s';

ALTER TABLE public.metas_sucursal ADD COLUMN IF NOT EXISTS nota_devolucion text;

-- ─────────────────────────────────────────────────────────────────────────────
-- Notificar a todos los empleados ACTIVOS de un rol (interna)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.metas_notificar_rol(p_role_name text, p_type text, p_title text, p_body text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.notifications (recipient_id, type, title, body, link)
  SELECT e.id, p_type, p_title, p_body, '/metas?tab=confirmacion'
  FROM public.employees e
  JOIN public.roles r ON r.name = p_role_name
  WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
    AND e.status = 'ACTIVO';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.metas_notificar_rol(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_notificar_rol(text, text, text, text) TO service_role;

-- Mes 'YYYY-MM' → «Agosto 2026» (interna; to_char no da español)
CREATE FUNCTION public.metas_mes_label(p_ym text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT (ARRAY['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
                'Agosto','Septiembre','Octubre','Noviembre','Diciembre'])
         [split_part(p_ym, '-', 2)::int] || ' ' || split_part(p_ym, '-', 1);
$function$;

REVOKE EXECUTE ON FUNCTION public.metas_mes_label(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metas_mes_label(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Propuestas: mismo mes del año pasado × crecimiento reciente, a $100
-- ─────────────────────────────────────────────────────────────────────────────
-- Interna (cron/ciclo). No pisa NADA existente (ON CONFLICT DO NOTHING): si el
-- supervisor ya tocó un mes, regenerar no lo revierte.
CREATE FUNCTION public.generar_propuestas_metas(p_year_month text)
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
    SELECT (p_year_month || '-01')::date                                    AS dest_ini,
           ((p_year_month || '-01')::date - interval '12 months')::date     AS base_ini,
           date_trunc('month', v_hoy)::date                                 AS act_ini
  ),
  sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
  v AS (
    SELECT s.branch_id,
      COALESCE(SUM(d.sum_total) FILTER (
        WHERE d.date >= l.base_ini AND d.date < (l.base_ini + interval '1 month')::date), 0) AS base,
      COALESCE(SUM(d.sum_total) FILTER (
        WHERE d.date >= (l.act_ini - interval '3 months')::date AND d.date < l.act_ini), 0) AS v3,
      COALESCE(SUM(d.sum_total) FILTER (
        WHERE d.date >= (l.act_ini - interval '15 months')::date AND d.date < (l.act_ini - interval '12 months')::date), 0) AS v3p
    FROM sucs s
    CROSS JOIN lim l
    LEFT JOIN public.sales_daily_stats d ON d.branch_id = s.branch_id
    GROUP BY s.branch_id
  ),
  calc AS (
    SELECT branch_id,
      GREATEST(100, ROUND((
        CASE
          WHEN base > 0 AND v3p > 0 THEN base * (v3 / v3p)
          WHEN base > 0             THEN base
          ELSE v3 / 3.0                                   -- sin año pasado: promedio 3 meses
        END) / 100.0) * 100) AS propuesta
    FROM v
    WHERE base > 0 OR v3 > 0                              -- sala sin historia: no se propone nada
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

REVOKE EXECUTE ON FUNCTION public.generar_propuestas_metas(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.generar_propuestas_metas(text) TO service_role;

-- Disparo manual del supervisor (siempre para el MES SIGUIENTE)
CREATE FUNCTION public.generar_propuestas_metas_manual()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_ym text;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;
  v_ym := to_char(((date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date) + interval '1 month'))::date, 'YYYY-MM');
  RETURN public.generar_propuestas_metas(v_ym);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.generar_propuestas_metas_manual() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generar_propuestas_metas_manual() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- El flujo: confirmar (supervisor) → aprobar / devolver (gerente)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.confirmar_meta_supervisor(p_id bigint, p_monto numeric DEFAULT NULL, p_nota text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

  UPDATE public.metas_sucursal
  SET monto_meta     = COALESCE(p_monto, monto_meta),
      nota           = COALESCE(p_nota, nota),
      estado         = 'confirmada_supervisor',
      supervisor_por = public.auth_employee_id(),
      supervisor_at  = now()
  WHERE id = p_id;

  -- Cuando ya no queda nada por confirmar de ese mes, UNA notificación al
  -- gerente (no una por sala).
  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado IN ('propuesta', 'devuelta');
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Gerente General', 'METAS_POR_APROBAR',
      'Metas por aprobar',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' están confirmadas y esperan tu aprobación.');
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_meta_supervisor(bigint, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_meta_supervisor(bigint, numeric, text) TO authenticated, service_role;

CREATE FUNCTION public.aprobar_meta_gerente(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_pendientes integer;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_approve') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere aprobación en Metas';
  END IF;
  SELECT * INTO v_row FROM public.metas_sucursal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'META_NO_EXISTE'; END IF;
  IF v_row.estado <> 'confirmada_supervisor' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: la meta está en %', v_row.estado;
  END IF;

  UPDATE public.metas_sucursal
  SET estado = 'oficial', gerente_por = public.auth_employee_id(), gerente_at = now()
  WHERE id = p_id;

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado <> 'oficial';
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_APROBADAS',
      'Metas aprobadas',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' quedaron oficiales. Cada sala verá la suya.');
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aprobar_meta_gerente(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aprobar_meta_gerente(bigint) TO authenticated, service_role;

CREATE FUNCTION public.devolver_meta_gerente(p_id bigint, p_nota text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_sala text;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_approve') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere aprobación en Metas';
  END IF;
  IF p_nota IS NULL OR btrim(p_nota) = '' THEN
    RAISE EXCEPTION 'NOTA_REQUERIDA: una devolución siempre lleva el porqué';
  END IF;
  SELECT * INTO v_row FROM public.metas_sucursal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'META_NO_EXISTE'; END IF;
  IF v_row.estado <> 'confirmada_supervisor' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: la meta está en %', v_row.estado;
  END IF;

  UPDATE public.metas_sucursal
  SET estado = 'devuelta', nota_devolucion = btrim(p_nota),
      gerente_por = public.auth_employee_id(), gerente_at = now()
  WHERE id = p_id;

  SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_row.branch_id;
  PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_DEVUELTA',
    'Meta devuelta — ' || COALESCE(v_sala, 'sala'),
    public.metas_mes_label(v_row.year_month) || ': ' || btrim(p_nota));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.devolver_meta_gerente(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.devolver_meta_gerente(bigint, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ciclo diario (cron 8:00 SV): día 25 propone; 28+ recuerda al supervisor;
-- 30+ al gerente; con el mes ya empezado y metas sin oficializar, a ambos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.metas_ciclo_diario()
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
        v_creadas || ' sala(s) ya tienen su meta propuesta. Revisalas, ajustalas y confirmalas.');
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

REVOKE EXECUTE ON FUNCTION public.metas_ciclo_diario() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_ciclo_diario() TO service_role;

-- Cron diario 14:00 UTC = 8:00 SV; la función decide sola qué toca según el día.
SELECT cron.schedule('metas-ciclo-diario', '0 14 * * *', 'SELECT public.metas_ciclo_diario()');
