SET lock_timeout = '5s';

-- ── La propuesta cuenta el mes en curso, PROYECTADO a fin de mes ────────────
--
-- Hasta hoy la fórmula sólo miraba meses COMPLETOS. Como la propuesta se genera
-- el 25, eso dejaba afuera el mes que está por cerrar — y no de una parte de la
-- cuenta, sino de las DOS:
--
--   ritmo  = venta de los 3 meses ÷ sus días   → mayo + junio + julio
--   factor = cumplimiento del más reciente     → julio
--
-- O sea que la meta de septiembre y la meta de agosto se calcularon contra el
-- MISMO mes. Medido el 2026-08-25: las seis notas de septiembre repiten los
-- porcentajes de las de agosto (108.6, 96.0, 104.4, 112.8, 94.0, 103.4). El
-- portal proponía metas con un mes de atraso y nada lo decía.
--
-- Desde acá el mes en curso entra con su venta PROYECTADA a mes completo
-- (venta ÷ días con dato × días del mes). Al día 25 son 24 días de recorrido:
-- no es una adivinanza, es el ritmo medido de casi todo el mes.
--
-- Dos guardas, y las dos importan:
--
--  1. **Sólo se proyecta el mes inmediatamente anterior al objetivo.** Un hueco
--     de datos en un mes viejo sigue excluyéndolo, como siempre: un mes a
--     medias bajaría el ritmo sin que nadie vendiera menos.
--  2. **Mínimo 20 días de recorrido.** El botón manual
--     (`generar_propuestas_metas_manual`) se puede apretar cualquier día; con
--     tres días de venta la proyección sería ruido con forma de número. Bajo
--     ese piso, el mes en curso no entra y la fórmula vuelve a lo de antes.
--
-- Y el día de HOY nunca cuenta: está a medias por definición, y arrastraría el
-- promedio hacia abajo según la hora a la que corriera el cron.
--
-- ── Una sola cuenta, dos consumidores ──────────────────────────────────────
-- `generar_propuestas_metas` (la que escribe) y `explicar_meta_propuesta` (el
-- panel «De dónde sale») tenían la fórmula escrita DOS veces, palabra por
-- palabra. Mientras fueran idénticas nadie lo notaba; el día que una cambiara,
-- el panel explicaría un cálculo que no es el que se guardó — y el propio panel
-- avisa de la diferencia, así que se leería como un error de la propuesta.
-- Acá se extrae a `metas_calculo_propuesta`, que es la única que sabe la
-- fórmula. Las otras dos la consultan.

CREATE OR REPLACE FUNCTION public.metas_calculo_propuesta(p_year_month text)
RETURNS TABLE(
  branch_id          bigint,
  suma_venta         numeric,
  suma_dias          integer,
  ritmo_dia          numeric,
  dias_mes           integer,
  sub_ritmo          numeric,
  ym_ultimo          text,
  meta_ultimo        numeric,
  pct_ultimo         numeric,
  ultimo_proyectado  boolean,
  factor             numeric,
  propuesta          numeric,
  meses              json
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH
  objetivo AS (
    SELECT (p_year_month || '-01')::date AS m_ini,
           EXTRACT(day FROM ((p_year_month || '-01')::date + interval '1 month -1 day'))::int AS dias,
           (now() AT TIME ZONE 'America/El_Salvador')::date AS hoy
  ),
  agg AS (
    -- `sales_daily_stats.branch_id` es integer y el resto del esquema es
    -- bigint; el cast va acá para que los joins de abajo no lo repitan.
    SELECT d.branch_id::bigint AS branch_id, date_trunc('month', d.date)::date AS m,
           SUM(d.sum_total - d.sum_no_producto)::numeric AS venta,
           COUNT(*)::int AS dias_dato
    FROM public.sales_daily_stats d, objetivo o
    WHERE d.date < o.hoy                     -- hoy está a medias
    GROUP BY 1, 2
  ),
  cand AS (
    SELECT a.branch_id, a.m, a.venta, a.dias_dato,
           EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int AS dias_mes,
           (a.m = (o.m_ini - interval '1 month')::date) AS es_en_curso
    FROM agg a CROSS JOIN objetivo o
    WHERE a.m < o.m_ini
      AND EXISTS (SELECT 1 FROM public.erp_sucursal_map em
                   WHERE em.branch_id = a.branch_id AND NOT em.es_bodega)
  ),
  usables AS (
    SELECT c.branch_id, c.m, c.dias_mes,
           CASE WHEN c.dias_dato = c.dias_mes THEN c.venta
                ELSE ROUND(c.venta / c.dias_dato * c.dias_mes, 2) END AS venta,
           (c.dias_dato < c.dias_mes) AS proyectado
    FROM cand c
    WHERE c.dias_dato = c.dias_mes                  -- mes cerrado
       OR (c.es_en_curso AND c.dias_dato >= 20)     -- mes en curso con recorrido
  ),
  base AS (
    SELECT u.*, row_number() OVER (PARTITION BY u.branch_id ORDER BY u.m DESC) AS rn
    FROM usables u
  ),
  tres AS (SELECT * FROM base WHERE rn <= 3),
  ritmo AS (
    SELECT t.branch_id, SUM(t.venta) AS suma_venta, SUM(t.dias_mes)::int AS suma_dias,
           SUM(t.venta) / SUM(t.dias_mes) AS por_dia, MAX(t.m) AS mes_ult
    FROM tres t GROUP BY 1
  ),
  cumpl AS (
    SELECT r.branch_id,
           to_char(r.mes_ult, 'YYYY-MM') AS ym_ult,
           (SELECT t.proyectado FROM tres t
             WHERE t.branch_id = r.branch_id AND t.m = r.mes_ult) AS proy,
           (SELECT s.monto_meta FROM public.metas_sucursal s
             WHERE s.branch_id = r.branch_id AND s.year_month = to_char(r.mes_ult, 'YYYY-MM')) AS meta_ult,
           -- El mes cerrado y congelado manda; el mes en curso todavía no tiene
           -- resultado, así que se mide su proyección contra la meta vigente.
           COALESCE(
             (SELECT x.pct_cumplimiento FROM public.metas_resultado x
               WHERE x.branch_id = r.branch_id AND x.year_month = to_char(r.mes_ult, 'YYYY-MM')),
             (SELECT ROUND(t.venta / NULLIF(s.monto_meta, 0) * 100, 1)
                FROM public.metas_sucursal s
                JOIN tres t ON t.branch_id = s.branch_id AND t.m = r.mes_ult
               WHERE s.branch_id = r.branch_id AND s.year_month = to_char(r.mes_ult, 'YYYY-MM'))
           ) AS pct
    FROM ritmo r
  )
  SELECT r.branch_id,
         ROUND(r.suma_venta, 2),
         r.suma_dias,
         ROUND(r.por_dia, 2),
         o.dias,
         ROUND(r.por_dia * o.dias, 2),
         cu.ym_ult,
         cu.meta_ult,
         cu.pct,
         COALESCE(cu.proy, false),
         f.factor,
         GREATEST(100, ROUND(r.por_dia * o.dias * f.factor, 2)),
         (SELECT json_agg(json_build_object(
                    'ym', to_char(t.m, 'YYYY-MM'), 'venta', t.venta,
                    'dias', t.dias_mes, 'proyectado', t.proyectado) ORDER BY t.m)
            FROM tres t WHERE t.branch_id = r.branch_id)
  FROM ritmo r
  CROSS JOIN objetivo o
  JOIN cumpl cu ON cu.branch_id = r.branch_id
  -- Sin cumplimiento medible (sala nueva, o mes sin meta) el factor es 1.00: no
  -- se pide crecimiento sobre algo que no se pudo medir. El 1.00 vive ACÁ y no
  -- en un tramo de la tabla a propósito — montado en el tramo de abajo cambia
  -- solo el día que alguien reordena los tramos, que es como se rompió una vez.
  LEFT JOIN LATERAL (
    SELECT COALESCE((
      SELECT t.factor FROM public.metas_factor_cumplimiento t
       WHERE cu.pct IS NOT NULL AND t.desde_pct <= cu.pct
       ORDER BY t.desde_pct DESC LIMIT 1
    ), 1.00) AS factor
  ) f ON true;
$$;

COMMENT ON FUNCTION public.metas_calculo_propuesta(text) IS
  'La fórmula de la propuesta, en un solo lugar: ritmo diario de los últimos 3 meses (el mes en curso entra proyectado a fin de mes si lleva 20+ días) × días del mes objetivo × factor de cumplimiento. La consultan generar_propuestas_metas y explicar_meta_propuesta.';

REVOKE EXECUTE ON FUNCTION public.metas_calculo_propuesta(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_calculo_propuesta(text) TO service_role;


-- ── La que escribe ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generar_propuestas_metas(p_year_month text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_creadas integer;
  v_b bigint;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;

  WITH
  ins AS (
    INSERT INTO public.metas_sucursal
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       monto_propuesto, estado, nota)
    SELECT c.branch_id, p_year_month, c.propuesta, 0, c.propuesta, c.propuesta, 'propuesta',
           CASE
             WHEN c.pct_ultimo IS NULL THEN
               'Propuesta del sistema: el ritmo diario de los últimos 3 meses por los días del mes. '
               || 'El mes anterior no tuvo meta, así que no hay cumplimiento que medir y no se pide '
               || 'crecimiento (factor 1.00)'
             WHEN c.ultimo_proyectado THEN
               'Propuesta del sistema: el ritmo diario de los últimos 3 meses —'
               || public.metas_mes_label(c.ym_ultimo) || ' proyectado a fin de mes— por los días '
               || 'del mes, con factor ' || c.factor || ' por venir cerrándolo en ' || c.pct_ultimo || '%'
             ELSE
               'Propuesta del sistema: el ritmo diario de los últimos 3 meses por los días del mes, '
               || 'con factor ' || c.factor || ' por haber cerrado ' || public.metas_mes_label(c.ym_ultimo)
               || ' en ' || c.pct_ultimo || '%'
           END
    FROM public.metas_calculo_propuesta(p_year_month) c
    WHERE c.propuesta IS NOT NULL
    ON CONFLICT (branch_id, year_month) DO NOTHING
    RETURNING id, branch_id, year_month, monto_meta
  ),
  log AS (
    INSERT INTO public.metas_historial
      (meta_id, branch_id, year_month, evento, estado_despues, monto_despues, nota)
    SELECT i.id, i.branch_id, i.year_month, 'propuesta_generada', 'propuesta', i.monto_meta,
           'la calculó el portal con el ritmo de los últimos meses y el factor de cumplimiento'
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


-- ── La que explica ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.explicar_meta_propuesta(p_branch_id bigint, p_year_month text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE r json;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_view') THEN RETURN NULL; END IF;

  SELECT json_build_object(
    'meses_base',        c.meses,
    'suma_venta',        c.suma_venta,
    'suma_dias',         c.suma_dias,
    'ritmo_dia',         c.ritmo_dia,
    'dias_mes',          c.dias_mes,
    'sub_ritmo',         c.sub_ritmo,
    'ym_ultimo',         c.ym_ultimo,
    'meta_ultimo',       c.meta_ultimo,
    'pct_ultimo',        c.pct_ultimo,
    'ultimo_proyectado', c.ultimo_proyectado,
    'factor',            c.factor,
    'tramos',            (SELECT json_agg(json_build_object('desde', t.desde_pct, 'factor', t.factor)
                                    ORDER BY t.desde_pct DESC)
                            FROM public.metas_factor_cumplimiento t),
    'recalculada',       c.propuesta
  ) INTO r
  FROM public.metas_calculo_propuesta(p_year_month) c
  WHERE c.branch_id = p_branch_id;

  RETURN r;
END;
$function$;
