SET lock_timeout = '5s';

-- Los seis RPC que mueven una meta pasan a dejar su renglón en
-- `metas_historial`. El resto de su comportamiento no cambia: mismas
-- validaciones, mismos candados de estado, mismas notificaciones.

-- ── 1. Confirmar (supervisor) ────────────────────────────────────────────────
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

  UPDATE public.metas_sucursal
  SET monto_meta     = COALESCE(p_monto, monto_meta),
      nota           = COALESCE(p_nota, nota),
      estado         = 'confirmada_supervisor',
      supervisor_por = public.auth_employee_id(),
      supervisor_at  = now()
  WHERE id = p_id;

  PERFORM public.metas_log(p_id, 'confirmada', v_row.estado, 'confirmada_supervisor',
    v_row.monto_meta, COALESCE(p_monto, v_row.monto_meta), p_nota);

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

-- ── 2. Aprobar (gerente) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aprobar_meta_gerente(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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

  PERFORM public.metas_log(p_id, 'aprobada', v_row.estado, 'oficial',
    v_row.monto_meta, v_row.monto_meta, NULL);

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado <> 'oficial';
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_APROBADAS',
      'Metas aprobadas',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' quedaron oficiales. Cada sala verá la suya.');
  END IF;
END;
$function$;

-- ── 3. Aprobar registrando la autorización verbal del gerente ────────────────
CREATE OR REPLACE FUNCTION public.aprobar_meta_por_autorizacion(
    p_id bigint, p_autorizo uuid, p_nota text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_yo uuid;
  v_autoriza_nombre text;
  v_yo_nombre text;
  v_pendientes integer;
BEGIN
  -- Basta con `can_edit`: quien ya tiene `can_approve` aprueba directo y no
  -- necesita este camino.
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

  -- El autorizante tiene que SER un gerente activo, y no puede ser uno mismo:
  -- si no, esto deja de ser una autorización y es una firma propia.
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

  UPDATE public.metas_sucursal
  SET estado          = 'oficial',
      gerente_por     = v_yo,          -- quien EJECUTÓ
      gerente_at      = now(),
      autorizado_por  = p_autorizo,    -- quien AUTORIZÓ
      autorizado_nota = btrim(p_nota)
  WHERE id = p_id;

  -- En la bitácora quedan las DOS personas: el actor lo resuelve `metas_log`,
  -- y quién autorizó va en la nota, que es donde se puede leer sin un join.
  PERFORM public.metas_log(p_id, 'aprobada_por_autorizacion', v_row.estado, 'oficial',
    v_row.monto_meta, v_row.monto_meta,
    'autorizó ' || v_autoriza_nombre || ' — ' || btrim(p_nota));

  SELECT e.name INTO v_yo_nombre FROM public.employees e WHERE e.id = v_yo;

  -- El control que hace esto defendible: el gerente se entera en el momento y
  -- puede desmentirlo. Sin este aviso, «el gerente autorizó» es sólo un dicho.
  PERFORM public.notify_employees(
    ARRAY[p_autorizo], 'METAS_AUTORIZACION_REGISTRADA',
    'Se registró tu autorización',
    COALESCE(v_yo_nombre, 'Un supervisor') || ' dejó oficial la meta de '
      || public.metas_mes_label(v_row.year_month)
      || ' diciendo que vos la autorizaste. Si no fue así, avisá.',
    '/metas?tab=confirmacion');

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado <> 'oficial';
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_APROBADAS',
      'Metas aprobadas',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' quedaron oficiales. Cada sala verá la suya.');
  END IF;
END;
$function$;

-- ── 4. Devolver (gerente) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.devolver_meta_gerente(p_id bigint, p_nota text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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

  PERFORM public.metas_log(p_id, 'devuelta', v_row.estado, 'devuelta',
    v_row.monto_meta, v_row.monto_meta, btrim(p_nota));

  SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_row.branch_id;
  PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_DEVUELTA',
    'Meta devuelta — ' || COALESCE(v_sala, 'sala'),
    public.metas_mes_label(v_row.year_month) || ': ' || btrim(p_nota));
END;
$function$;

-- ── 5. Ingreso manual (con el candado de estado de v2.372.2) ─────────────────
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
      (branch_id, year_month, monto_meta, estado, nota, supervisor_por, supervisor_at)
    VALUES
      (p_branch_id, p_year_month, p_monto, 'oficial', v_nota, v_emp, now())
    RETURNING id INTO v_new;
    PERFORM public.metas_log(v_new, 'ingreso_manual', NULL, 'oficial', NULL, p_monto, v_nota);
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
  SET monto_meta = p_monto,
      nota       = COALESCE(v_nota, nota),
      supervisor_por = CASE WHEN v_row.estado = 'oficial' THEN v_emp ELSE supervisor_por END,
      supervisor_at  = CASE WHEN v_row.estado = 'oficial' THEN now() ELSE supervisor_at END
  WHERE id = v_row.id;

  -- Dos eventos distintos porque son dos cosas distintas: corregir un mes
  -- cerrado toca un bono ya pagado; mover el monto de una propuesta viva no.
  PERFORM public.metas_log(v_row.id,
    CASE WHEN v_row.estado = 'oficial' THEN 'mes_cerrado_corregido' ELSE 'monto_ajustado' END,
    v_row.estado, v_row.estado, v_row.monto_meta, p_monto, v_nota);
END;
$function$;

-- ── 6. Las propuestas del portal ─────────────────────────────────────────────
-- Igual que antes; lo único nuevo es que cada fila creada deja su renglón. El
-- actor queda en NULL a propósito: no la decidió una persona, la calculó el
-- portal.
CREATE OR REPLACE FUNCTION public.generar_propuestas_metas(p_year_month text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
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

  IF v_creadas > 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_PROPUESTAS',
      'Metas propuestas para ' || public.metas_mes_label(p_year_month),
      v_creadas || ' sala(s) ya tienen su meta propuesta. Revísalas, ajústalas y confírmalas.');
  END IF;

  RETURN v_creadas;
END;
$function$;

-- Verificado en prod dentro de una transacción revertida: el ciclo entero de
-- una meta de diciembre dejó sus 12 renglones —6 `propuesta_generada` con actor
-- NULL (la calculó el portal), `confirmada` 41559.15→61000, `devuelta`,
-- `confirmada` 61000→63500, `aprobada`, `ingreso_manual`, `monto_ajustado`
-- (propuesta → propuesta: conserva el estado)— más
-- `aprobada_por_autorizacion` (con las dos personas) y
-- `mes_cerrado_corregido` 38000→39500. Cero filas quedaron en prod.
