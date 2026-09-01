SET lock_timeout = '5s';

-- ── Dos correcciones sobre el aviso de administración ──────────────────────
--
-- 1 · EL PERMISO NO SE LLAMA ASÍ. La versión anterior buscaba el módulo
--     `metas_ver`, que no existe: el módulo es `metas`, a secas. No habría dado
--     ningún error — habría devuelto CERO destinatarios, y un cero se lee igual
--     que «todavía no es el día». Medido: con la clave correcta son cuatro
--     personas (Gerente General, Administrador, Talento Humano y Supervisión).
--
-- 2 · NADIE LO LLAMABA. La función existía y el ciclo diario no la invocaba.
--     Va junto al aviso de las salas, en la misma ventana del 1 al 5.

CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_admin(
  p_ym_cerrado text,
  p_ultimo_intento boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_ym_nuevo   text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes   integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_fini       date;
  v_ffin       date;
  v_n          integer;
BEGIN
  IF p_ym_cerrado IS NULL OR p_ym_cerrado !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_cerrado;
  END IF;
  v_fini := (p_ym_cerrado || '-01')::date;
  v_ffin := (v_fini + interval '1 month -1 day')::date;

  WITH
  cerrado AS (
    SELECT d.branch_id::bigint AS branch_id,
           SUM(d.sum_total - d.sum_no_producto)::numeric AS venta,
           COUNT(*)::int AS dias_dato
    FROM public.sales_daily_stats d
    WHERE to_char(d.date, 'YYYY-MM') = p_ym_cerrado
    GROUP BY 1
  ),
  salas AS (
    SELECT c.branch_id, b.name AS sala,
           COALESCE(res.venta_total, ROUND(c.venta, 2)) AS venta,
           mv.monto_meta AS meta,
           COALESCE(res.pct_cumplimiento,
                    CASE WHEN mv.monto_meta > 0
                         THEN ROUND(c.venta / mv.monto_meta * 100, 1) END) AS pct
    FROM cerrado c
    JOIN public.erp_sucursal_map em ON em.branch_id = c.branch_id AND NOT em.es_bodega
    JOIN public.branches b ON b.id = c.branch_id
    LEFT JOIN public.metas_sucursal mv
           ON mv.branch_id = c.branch_id AND mv.year_month = p_ym_cerrado
    LEFT JOIN public.metas_resultado res
           ON res.branch_id = c.branch_id AND res.year_month = p_ym_cerrado
    -- El aviso de administración exige el mes COMPLETO en las seis: un día que
    -- falte en una sola sala mueve el global de la empresa.
    WHERE (c.dias_dato = v_dias_mes OR res.year_month IS NOT NULL)
  ),
  global AS (
    SELECT SUM(venta) AS venta, SUM(meta) AS meta, COUNT(*) AS cuantas,
           CASE WHEN SUM(meta) > 0 THEN ROUND(SUM(venta) / SUM(meta) * 100, 1) END AS pct
    FROM salas
  ),
  vend AS MATERIALIZED (
    SELECT * FROM public.get_vendedores_resumen(v_fini, v_ffin, NULL)
  ),
  top3 AS (
    SELECT json_agg(json_build_object(
             'employee_id', t.id, 'nombre', t.name, 'sala', t.sala, 'venta', t.total_ventas)
           ORDER BY t.total_ventas DESC) AS filas
    FROM (
      SELECT e.id, e.name, b.name AS sala, v.total_ventas
      FROM vend v
      JOIN public.employees e
        ON e.code = v.cod_vendedor AND e.branch_id = v.branch_id AND e.status = 'ACTIVO'
      JOIN public.branches b ON b.id = v.branch_id
      JOIN public.erp_sucursal_map em ON em.branch_id = v.branch_id AND NOT em.es_bodega
      ORDER BY v.total_ventas DESC
      LIMIT 3
    ) t
  ),
  destinatarios AS (
    SELECT e.id AS employee_id
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND COALESCE(e.tipo_ficha, 'empleado') = 'empleado'
      AND EXISTS (SELECT 1 FROM public.role_permissions rp
                   WHERE rp.module_key = 'metas' AND rp.can_view
                     AND rp.role_id IN (e.role_id, e.secondary_role_id))
      -- Quien está EN una sala ya recibe el aviso de su sala; éste es el de
      -- quien mira las seis.
      AND NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map em
                       WHERE em.branch_id = e.branch_id AND NOT em.es_bodega)
  ),
  ins AS (
    INSERT INTO public.notifications
      (recipient_id, type, title, body, link, metadata)
    SELECT d.employee_id,
           'METAS_CIERRE_EMPRESA',
           'La empresa cerró ' || public.metas_mes_label(p_ym_cerrado)
             || ' en ' || (SELECT pct FROM global) || '%',
           'Las ' || (SELECT cuantas FROM global) || ' salas vendieron $'
             || to_char((SELECT venta FROM global), 'FM999,999,990.00')
             || ' de una meta de $' || to_char((SELECT meta FROM global), 'FM999,999,990.00')
             || '. Las metas de ' || public.metas_mes_label(v_ym_nuevo) || ' ya están publicadas.',
           '/metas',
           jsonb_build_object(
             'ym_cerrado',  p_ym_cerrado,
             'ym_nuevo',    v_ym_nuevo,
             'mes_cerrado', public.metas_mes_label(p_ym_cerrado),
             'mes_nuevo',   public.metas_mes_label(v_ym_nuevo),
             'pct',         (SELECT pct   FROM global),
             'venta',       (SELECT venta FROM global),
             'meta',        (SELECT meta  FROM global),
             'sucursales',  (SELECT json_agg(json_build_object('sala', s.sala, 'pct', s.pct)
                                             ORDER BY s.pct DESC NULLS LAST) FROM salas s),
             'top3',        (SELECT filas FROM top3))
    FROM destinatarios d
    WHERE (SELECT pct FROM global) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.recipient_id = d.employee_id
           AND n.type = 'METAS_CIERRE_EMPRESA'
           AND n.metadata ->> 'ym_cerrado' = p_ym_cerrado
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.metas_avisar_cierre_a_admin(text, boolean) IS
  'El cierre del mes para administración: cumplimiento global de la empresa (venta total sobre meta total, no el promedio de los seis porcentajes), cada sucursal con su porcentaje, y los tres vendedores con más venta. Va a quien puede ver el módulo metas y NO está en una sala. Idempotente por (persona, mes cerrado).';

REVOKE EXECUTE ON FUNCTION public.metas_avisar_cierre_a_admin(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_avisar_cierre_a_admin(text, boolean) TO service_role;


-- ── El ciclo diario lo dispara, junto al de las salas ──────────────────────
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
  v_rehechas integer := 0;
  v_n integer;
  v_out text := '';
BEGIN
  SELECT dia_propuesta INTO v_dia_propuesta FROM public.metas_config LIMIT 1;
  v_dia_propuesta := COALESCE(v_dia_propuesta, 28);

  IF v_dia = v_dia_propuesta THEN
    v_creadas := public.generar_propuestas_metas(v_ym_sig);
    v_out := v_out || 'propuestas=' || v_creadas || ' ';

    -- Las que ya existían (mes propuesto antes, o el día corrido) se ponen al
    -- día con las ventas de hoy. No toca confirmadas, oficiales ni ajustadas.
    v_rehechas := public.recalcular_propuestas_metas(v_ym_sig,
      'el portal las rehizo el día de la propuesta con las ventas hasta hoy');
    IF v_rehechas > 0 THEN
      v_out := v_out || 'rehechas=' || v_rehechas || ' ';
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_PROPUESTAS',
        'Metas recalculadas para ' || public.metas_mes_label(v_ym_sig),
        v_rehechas || ' meta(s) que ya estaban propuestas se rehicieron con las ventas '
        || 'hasta hoy. Las que ya habías ajustado o confirmado no se tocaron.');
    END IF;
  END IF;

  -- El mes que cerró queda congelado con las reglas que regían ese mes.
  IF v_dia = 5 THEN
    v_n := public.congelar_metas_mes(v_ym_ant, false);
    v_out := v_out || 'congelado_' || v_ym_ant || '=' || v_n || ' ';
  END IF;

  -- El aviso a la sala va DESPUÉS de congelar: el 5, si el congelado acaba de
  -- escribirse, el número de la campana es ya el del histórico.
  IF v_dia BETWEEN 1 AND 5 THEN
    v_n := public.metas_avisar_cierre_a_salas(v_ym_ant, v_dia = 5);
    IF v_n > 0 THEN
      v_out := v_out || 'aviso_salas_' || v_ym_ant || '=' || v_n || ' ';
    END IF;

    -- Y el de administración, que mira las seis a la vez. Va después del de las
    -- salas por el mismo motivo por el que el de las salas va después de
    -- congelar: si algo falla, lo primero que se salva es el aviso de la gente
    -- que persiguió la meta.
    v_n := public.metas_avisar_cierre_a_admin(v_ym_ant, v_dia = 5);
    IF v_n > 0 THEN
      v_out := v_out || 'aviso_admin_' || v_ym_ant || '=' || v_n || ' ';
    END IF;
  END IF;

  -- Desde el día SIGUIENTE al de la propuesta: recordarle a alguien que no
  -- confirmó lo que se creó esta misma mañana no es un recordatorio.
  IF v_dia > v_dia_propuesta THEN
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
  -- una situación que dura, no una novedad diaria. Es además la única red en
  -- FEBRERO, donde el 28 es el último día y no hay «día siguiente».
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
