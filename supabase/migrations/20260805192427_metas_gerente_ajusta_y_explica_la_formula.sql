SET lock_timeout = '5s';

-- ── 1. El gerente también puede ajustar el monto ────────────────────────────
-- Pedido del usuario (2026-08-05): en «espera aprobación», quien aprueba —o
-- quien registra la autorización— puede mover el monto igual que el supervisor.
-- Si lo cambia, al supervisor le llega el aviso: su número dejó de ser el que
-- confirmó y tiene que enterarse sin preguntar.
--
-- Se DROPEA la firma vieja en vez de agregar el parámetro con DEFAULT: dejar
-- las dos hace la llamada de un solo argumento ambigua para Postgres.
DROP FUNCTION IF EXISTS public.aprobar_meta_gerente(bigint);

CREATE OR REPLACE FUNCTION public.aprobar_meta_gerente(
    p_id bigint, p_monto numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_pendientes integer;
  v_sala text;
  v_cambio boolean := false;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_approve') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere aprobación en Metas';
  END IF;
  SELECT * INTO v_row FROM public.metas_sucursal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'META_NO_EXISTE'; END IF;
  IF v_row.estado <> 'confirmada_supervisor' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: la meta está en %', v_row.estado;
  END IF;
  IF p_monto IS NOT NULL AND p_monto <= 0 THEN RAISE EXCEPTION 'MONTO_INVALIDO'; END IF;

  v_cambio := p_monto IS NOT NULL AND p_monto <> v_row.monto_base;

  UPDATE public.metas_sucursal
  SET estado      = 'oficial',
      monto_base  = COALESCE(p_monto, monto_base),
      monto_meta  = COALESCE(p_monto, monto_base) + monto_recuperacion,
      gerente_por = public.auth_employee_id(),
      gerente_at  = now()
  WHERE id = p_id;

  PERFORM public.metas_log(p_id,
    CASE WHEN v_cambio THEN 'aprobada_con_ajuste' ELSE 'aprobada' END,
    v_row.estado, 'oficial',
    v_row.monto_base, COALESCE(p_monto, v_row.monto_base), NULL);

  -- El supervisor confirmó un número; si el gerente lo movió, se entera.
  IF v_cambio THEN
    SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_row.branch_id;
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_AJUSTADA',
      'El gerente ajustó una meta — ' || COALESCE(v_sala, 'sala'),
      public.metas_mes_label(v_row.year_month) || ': quedó en '
        || to_char(p_monto, 'FM999,999,990.00') || ' en vez de '
        || to_char(v_row.monto_base, 'FM999,999,990.00') || '.');
  END IF;

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado <> 'oficial';
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_APROBADAS',
      'Metas aprobadas',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' quedaron oficiales. Cada sala verá la suya.');
  END IF;
END;
$function$;

DROP FUNCTION IF EXISTS public.aprobar_meta_por_autorizacion(bigint, uuid, text);

CREATE OR REPLACE FUNCTION public.aprobar_meta_por_autorizacion(
    p_id bigint, p_autorizo uuid, p_nota text DEFAULT NULL, p_monto numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_yo uuid;
  v_autoriza_nombre text;
  v_yo_nombre text;
  v_pendientes integer;
  v_sala text;
  v_cambio boolean := false;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;

  v_yo := public.auth_employee_id();
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_EMPLEADO: no se pudo resolver quién registra'; END IF;

  SELECT * INTO v_row FROM public.metas_sucursal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'META_NO_EXISTE'; END IF;
  IF v_row.estado <> 'confirmada_supervisor' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: la meta está en %', v_row.estado;
  END IF;
  IF p_monto IS NOT NULL AND p_monto <= 0 THEN RAISE EXCEPTION 'MONTO_INVALIDO'; END IF;

  SELECT a.name INTO v_autoriza_nombre FROM public.get_metas_autorizadores() a WHERE a.id = p_autorizo;
  IF v_autoriza_nombre IS NULL THEN
    RAISE EXCEPTION 'AUTORIZANTE_INVALIDO: quien autoriza debe ser un gerente activo';
  END IF;
  IF p_autorizo = v_yo THEN
    RAISE EXCEPTION 'AUTORIZANTE_INVALIDO: no podés registrarte a vos mismo como quien autoriza';
  END IF;
  IF p_nota IS NULL OR btrim(p_nota) = '' THEN
    RAISE EXCEPTION 'NOTA_REQUERIDA: hay que dejar dicho cómo se dio la autorización';
  END IF;

  v_cambio := p_monto IS NOT NULL AND p_monto <> v_row.monto_base;

  UPDATE public.metas_sucursal
  SET estado          = 'oficial',
      monto_base      = COALESCE(p_monto, monto_base),
      monto_meta      = COALESCE(p_monto, monto_base) + monto_recuperacion,
      gerente_por     = v_yo,
      gerente_at      = now(),
      autorizado_por  = p_autorizo,
      autorizado_nota = btrim(p_nota)
  WHERE id = p_id;

  PERFORM public.metas_log(p_id,
    CASE WHEN v_cambio THEN 'aprobada_por_autorizacion_con_ajuste' ELSE 'aprobada_por_autorizacion' END,
    v_row.estado, 'oficial', v_row.monto_base, COALESCE(p_monto, v_row.monto_base),
    'autorizó ' || v_autoriza_nombre || ' — ' || btrim(p_nota));

  SELECT e.name INTO v_yo_nombre FROM public.employees e WHERE e.id = v_yo;

  PERFORM public.notify_employees(
    ARRAY[p_autorizo], 'METAS_AUTORIZACION_REGISTRADA',
    'Se registró tu autorización',
    COALESCE(v_yo_nombre, 'Un supervisor') || ' dejó oficial la meta de '
      || public.metas_mes_label(v_row.year_month)
      || ' diciendo que vos la autorizaste. Si no fue así, avisá.',
    '/metas?tab=confirmacion');

  IF v_cambio THEN
    SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_row.branch_id;
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_AJUSTADA',
      'La meta se ajustó al aprobarla — ' || COALESCE(v_sala, 'sala'),
      public.metas_mes_label(v_row.year_month) || ': quedó en '
        || to_char(p_monto, 'FM999,999,990.00') || ' en vez de '
        || to_char(v_row.monto_base, 'FM999,999,990.00') || '.');
  END IF;

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado <> 'oficial';
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_APROBADAS',
      'Metas aprobadas',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' quedaron oficiales. Cada sala verá la suya.');
  END IF;
END;
$function$;

-- Los lotes pasan el monto de cada meta tal como viene de la pantalla.
CREATE OR REPLACE FUNCTION public.aprobar_metas_lote(p_ids bigint[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; n integer := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN 0; END IF;
  IF array_length(p_ids, 1) > 100 THEN
    RAISE EXCEPTION 'LOTE_DEMASIADO_GRANDE: %', array_length(p_ids, 1);
  END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    PERFORM public.aprobar_meta_gerente(v_id, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aprobar_metas_por_autorizacion_lote(
    p_ids bigint[], p_autorizo uuid, p_nota text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; n integer := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN 0; END IF;
  IF array_length(p_ids, 1) > 100 THEN
    RAISE EXCEPTION 'LOTE_DEMASIADO_GRANDE: %', array_length(p_ids, 1);
  END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    PERFORM public.aprobar_meta_por_autorizacion(v_id, p_autorizo, p_nota, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aprobar_meta_gerente(bigint, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aprobar_meta_gerente(bigint, numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.aprobar_meta_por_autorizacion(bigint, uuid, text, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aprobar_meta_por_autorizacion(bigint, uuid, text, numeric) TO authenticated, service_role;

-- ── 2. De dónde sale el número ──────────────────────────────────────────────
-- Rehace el cálculo de la propuesta pieza por pieza y devuelve TAMBIÉN el
-- resultado recalculado, para que la pantalla pueda compararlo contra lo que se
-- guardó. Si no coincide, la pantalla lo dice en vez de mostrar un desglose que
-- no explica el número que está arriba — que sería peor que no explicar nada.
CREATE OR REPLACE FUNCTION public.explicar_meta_propuesta(
    p_branch_id bigint, p_year_month text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r json;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_view') THEN RETURN NULL; END IF;

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
  ult3 AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.branch_id ORDER BY c.m DESC) AS rn
    FROM comp c, objetivo o WHERE c.m < o.m_ini
  ),
  r3 AS (
    SELECT branch_id, SUM(venta)/SUM(dias_mes) AS por_dia, SUM(venta)/3 AS venta_mes
    FROM ult3 WHERE rn <= 3 GROUP BY 1
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
  norma AS (SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY p.por_hora))::numeric AS n FROM prod p)
  SELECT json_build_object(
    'ritmo_dia',    round(r.por_dia, 2),
    'dias_mes',     o.dias,
    'estacional',   round(1 + (i.bruto - 1) * i.n / (i.n + 1), 4),
    'empuje',       round(LEAST(c.empuje_max,
                        GREATEST(0, nm.n * p.h_sem * 4.35 / NULLIF(p.venta_mes, 0) - 1) * c.empuje_peso), 4),
    'crecimiento',  c.factor_crecimiento,
    'recalculada',  GREATEST(100, ROUND(
                      r.por_dia * o.dias
                      * (1 + (i.bruto - 1) * i.n / (i.n + 1))
                      * (c.factor_crecimiento
                         + LEAST(c.empuje_max,
                                 GREATEST(0, nm.n * p.h_sem * 4.35 / NULLIF(p.venta_mes, 0) - 1) * c.empuje_peso))
                      , 2)),
    'meses_base',   (SELECT json_agg(json_build_object(
                        'ym', to_char(u.m, 'YYYY-MM'), 'venta', round(u.venta, 2), 'dias', u.dias_mes)
                        ORDER BY u.m)
                     FROM ult3 u WHERE u.branch_id = p_branch_id AND u.rn <= 3),
    'horas_semana', round(p.h_sem, 1)
  ) INTO r
  FROM r3 r
  JOIN prod p ON p.branch_id = r.branch_id
  CROSS JOIN objetivo o CROSS JOIN idx i CROSS JOIN norma nm CROSS JOIN cfg c
  WHERE r.branch_id = p_branch_id;

  RETURN r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.explicar_meta_propuesta(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explicar_meta_propuesta(bigint, text) TO authenticated, service_role;

-- Verificado en prod como usuario autenticado: la explicación reproduce las 6
-- propuestas de agosto AL CENTAVO (La Popular 41,006.81 = 1,301.57/día × 31 ×
-- 0.9867 × 1.03; Salud 1 51,341.07; Salud 2 44,865.86; Salud 3 46,125.14;
-- Salud 4 41,825.10; Salud 5 16,339.55). Esa comprobación es la que hace
-- honesto mostrar el desglose: explica el número que está en pantalla.
