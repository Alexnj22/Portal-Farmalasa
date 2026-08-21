SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- La regla, escrita UNA vez
-- ════════════════════════════════════════════════════════════════════════════
-- Todo el que necesite saber «esto no es venta de productos» mira acá. Los
-- códigos 100/1000 aparecen en esta vista y en ningún otro lugar del esquema:
-- es la lección de `fichas_para_corregir_dte` —dos listas que dicen lo mismo se
-- desincronizan— aplicada antes de que pase.
CREATE OR REPLACE VIEW public.ventas_sin_producto
WITH (security_invoker = true) AS
SELECT si.id          AS invoice_id,
       si.branch_id,
       si.fecha,
       si.hora,
       si.correlativo,
       si.tipo_documento,
       si.cliente,
       si.customer_id,
       si.cod_vendedor,
       si.total,
       csp.motivo
FROM public.sales_invoices si
JOIN public.clientes_sin_producto csp ON csp.customer_id = si.customer_id
WHERE si.cod_vendedor IN ('100', '1000')
  AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH');

COMMENT ON VIEW public.ventas_sin_producto IS
    'Las facturas que NO son venta de productos: código administrativo (100/1000) cobrado a una ficha de clientes_sin_producto. Única definición de la regla — la meta resta esto y el aviso lo muestra.';

-- ════════════════════════════════════════════════════════════════════════════
-- El acumulado diario guarda las dos cifras
-- ════════════════════════════════════════════════════════════════════════════
-- Se SUMA entero y se RESTA el pedacito, en vez de filtrar factura por factura.
-- Medido en producción sobre agosto/2026 (14,011 facturas):
--     con anti-join `NOT EXISTS`   → 49.6 ms (pierde el Index Only Scan)
--     sumar entero + restar aparte →  6.9 + 0.7 ms
-- No es microoptimización: el anti-join hacía 434,311 comparaciones para
-- descartar 2 facturas, y esta consulta la corre un cron cada 15 minutos.
CREATE OR REPLACE FUNCTION public.refresh_sales_daily_stats(p_days_back integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_from_date date;
    v_today     date;
    v_written   integer;
    v_has_history boolean;
BEGIN
    v_today := CURRENT_DATE;

    -- Cold-start: si no hay historia de ≥30 días, backfill completo de 365
    SELECT EXISTS(
        SELECT 1 FROM public.sales_daily_stats WHERE date <= v_today - 30
    ) INTO v_has_history;

    IF v_has_history THEN
        v_from_date := v_today - p_days_back;
    ELSE
        v_from_date := v_today - 365;
    END IF;

    WITH fresh AS (
        SELECT si.fecha AS date, si.branch_id,
               COUNT(*)::integer            AS count_valid,
               COALESCE(SUM(si.total::numeric), 0) AS sum_total
        FROM public.sales_invoices si
        WHERE si.fecha >= v_from_date
          AND si.fecha <  v_today
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
        GROUP BY si.fecha, si.branch_id
    ),
    -- La parte que no es venta de productos, del MISMO rango. Sale de la vista
    -- y no de un `WHERE` repetido acá: si mañana cambia la regla, cambia sola.
    np AS (
        SELECT v.fecha AS date, v.branch_id,
               COALESCE(SUM(v.total::numeric), 0) AS sum_no_producto
        FROM public.ventas_sin_producto v
        WHERE v.fecha >= v_from_date AND v.fecha < v_today
        GROUP BY v.fecha, v.branch_id
    ),
    conjunto AS (
        SELECT f.date, f.branch_id, f.count_valid, f.sum_total,
               COALESCE(n.sum_no_producto, 0) AS sum_no_producto
        FROM fresh f
        LEFT JOIN np n ON n.date = f.date AND n.branch_id = f.branch_id
    ),
    del AS (
        DELETE FROM public.sales_daily_stats s
        WHERE s.date >= v_from_date AND s.date < v_today
          AND NOT EXISTS (SELECT 1 FROM conjunto f
                          WHERE f.date = s.date AND f.branch_id = s.branch_id)
        RETURNING 1
    ),
    ins AS (
        INSERT INTO public.sales_daily_stats (date, branch_id, count_valid, sum_total, sum_no_producto)
        SELECT date, branch_id, count_valid, sum_total, sum_no_producto FROM conjunto
        ON CONFLICT (date, branch_id) DO UPDATE
        SET count_valid     = EXCLUDED.count_valid,
            sum_total       = EXCLUDED.sum_total,
            sum_no_producto = EXCLUDED.sum_no_producto
        WHERE (sales_daily_stats.count_valid, sales_daily_stats.sum_total, sales_daily_stats.sum_no_producto)
              IS DISTINCT FROM (EXCLUDED.count_valid, EXCLUDED.sum_total, EXCLUDED.sum_no_producto)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM del) + (SELECT count(*) FROM ins) INTO v_written;

    RETURN v_written;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- El tablero: avance, proyección y perfil, los tres netos
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_metas_dashboard(p_year_month text)
 RETURNS TABLE(branch_id bigint, monto_meta numeric, estado text, nota text, venta_acumulada numeric, pct_cumplimiento numeric, proyeccion numeric, pct_proyectado numeric, bono_tier text, dias_transcurridos integer, dias_mes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH
lim AS (
  SELECT (p_year_month || '-01')::date AS m_ini,
         ((p_year_month || '-01')::date + interval '1 month' - interval '1 day')::date AS m_fin,
         (now() AT TIME ZONE 'America/El_Salvador')::date AS hoy,
         to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM') AS ym_hoy
),
sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
-- venta agregada del mes hasta ayer (o el mes entero si ya cerró), NETA de lo
-- que no es venta de productos: la comisión del corresponsal bancario y el
-- apoyo promocional de un laboratorio no son mérito de la sala, así que no
-- acercan la meta. Medido: en Salud 3 eran entre 0.88% y 7.86% de su meta,
-- todos los meses.
hist AS (
  SELECT s.branch_id, COALESCE(SUM(d.sum_total - d.sum_no_producto), 0) AS neto
  FROM sucs s
  CROSS JOIN lim
  LEFT JOIN public.sales_daily_stats d
    ON d.branch_id = s.branch_id
   AND d.date >= lim.m_ini
   AND d.date <= LEAST(lim.m_fin, lim.hoy - 1)
  GROUP BY s.branch_id
),
-- HOY (día de negocio SV) en vivo — sales_daily_stats nunca lo incluye a tiempo
vivo AS (
  SELECT si.branch_id, COALESCE(SUM(si.total::numeric), 0) AS bruto
  FROM public.sales_invoices si
  CROSS JOIN lim
  WHERE si.fecha = lim.hoy
    AND lim.hoy BETWEEN lim.m_ini AND lim.m_fin
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
  GROUP BY si.branch_id
),
-- Lo de hoy que no es venta de productos. Va aparte y NO como filtro del CTE de
-- arriba: filtrar por factura le cuesta a `vivo` el Index Only Scan sobre
-- idx_si_fecha_full (medido: 49.6 ms contra 6.9). Restar sale 0.7 ms.
vivo_np AS (
  SELECT v.branch_id, COALESCE(SUM(v.total::numeric), 0) AS neto
  FROM public.ventas_sin_producto v
  CROSS JOIN lim
  WHERE v.fecha = lim.hoy
    AND lim.hoy BETWEEN lim.m_ini AND lim.m_fin
  GROUP BY v.branch_id
),
-- perfil por día de semana de cada sala, últimas 8 semanas cerradas a ayer.
-- También neto: si no, la proyección arrastra la comisión del mes pasado a
-- todos los días que faltan.
perfil AS (
  SELECT d.branch_id, EXTRACT(dow FROM d.date)::int AS dow,
         AVG(d.sum_total - d.sum_no_producto) AS prom
  FROM public.sales_daily_stats d
  CROSS JOIN lim
  WHERE d.date >= lim.hoy - 56 AND d.date < lim.hoy
  GROUP BY d.branch_id, EXTRACT(dow FROM d.date)
),
-- lo que suelen vender los días que faltan (HOY incluido) — solo mes en curso
resto AS (
  SELECT s.branch_id, COALESCE(SUM(p.prom), 0) AS neto
  FROM sucs s
  CROSS JOIN lim
  CROSS JOIN LATERAL generate_series(lim.hoy, lim.m_fin, interval '1 day') g(d)
  LEFT JOIN perfil p ON p.branch_id = s.branch_id AND p.dow = EXTRACT(dow FROM g.d)::int
  WHERE p_year_month = lim.ym_hoy
  GROUP BY s.branch_id
),
base AS (
  SELECT
    s.branch_id,
    m.monto_meta,
    m.estado,
    m.nota,
    ROUND(h.neto + COALESCE(v.bruto, 0) - COALESCE(vn.neto, 0), 2) AS venta_acumulada,
    CASE
      WHEN p_year_month = l.ym_hoy
        THEN ROUND(GREATEST(h.neto + COALESCE(r.neto, 0),
                            h.neto + COALESCE(v.bruto, 0) - COALESCE(vn.neto, 0)), 2)
      WHEN p_year_month < l.ym_hoy
        THEN ROUND(h.neto + COALESCE(v.bruto, 0) - COALESCE(vn.neto, 0), 2)   -- mes cerrado: la proyección ES lo real
    END AS proyeccion,
    CASE
      WHEN p_year_month > l.ym_hoy THEN 0
      WHEN p_year_month = l.ym_hoy THEN (l.hoy - l.m_ini + 1)::integer
      ELSE (l.m_fin - l.m_ini + 1)::integer
    END AS dias_transcurridos,
    (l.m_fin - l.m_ini + 1)::integer AS dias_mes,
    (p_year_month < l.ym_hoy) AS cerrado
  FROM sucs s
  CROSS JOIN lim l
  LEFT JOIN public.metas_sucursal m ON m.branch_id = s.branch_id AND m.year_month = p_year_month
  LEFT JOIN hist h ON h.branch_id = s.branch_id
  LEFT JOIN vivo v ON v.branch_id = s.branch_id
  LEFT JOIN vivo_np vn ON vn.branch_id = s.branch_id
  LEFT JOIN resto r ON r.branch_id = s.branch_id
)
SELECT
  b.branch_id, b.monto_meta, b.estado, b.nota,
  b.venta_acumulada,
  CASE WHEN b.monto_meta > 0 THEN ROUND(b.venta_acumulada / b.monto_meta * 100, 1) END AS pct_cumplimiento,
  b.proyeccion,
  CASE WHEN b.monto_meta > 0 AND b.proyeccion IS NOT NULL
       THEN ROUND(b.proyeccion / b.monto_meta * 100, 1) END AS pct_proyectado,
  CASE
    WHEN b.monto_meta IS NULL THEN NULL
    WHEN b.cerrado THEN
      CASE WHEN b.venta_acumulada / b.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
           WHEN b.venta_acumulada / b.monto_meta * 100 >= c.umbral_bono_medio THEN 'medio'
           ELSE 'nada' END
    WHEN b.proyeccion IS NOT NULL THEN
      CASE WHEN b.proyeccion / b.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
           WHEN b.proyeccion / b.monto_meta * 100 >= c.umbral_bono_medio THEN 'medio'
           ELSE 'nada' END
  END AS bono_tier,
  b.dias_transcurridos,
  b.dias_mes
FROM base b
CROSS JOIN public.metas_config c
ORDER BY b.branch_id;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- El widget de la sala: «lo vendido hoy» también es neto
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_meta_sala(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(branch_id bigint, sala text, year_month text, monto_meta numeric, estado text, venta_acumulada numeric, venta_hoy numeric, pct_cumplimiento numeric, proyeccion numeric, pct_proyectado numeric, bono_tier text, dias_transcurridos integer, dias_mes integer, dias_restantes integer, falta numeric, ritmo_necesario numeric, umbral_medio numeric, umbral_total numeric, bonificaciones_activas boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch bigint;
    v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_ym     text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
BEGIN
    IF NOT auth_has_module_permission('dash_meta_sala', 'can_view') THEN
        RETURN;
    END IF;

    IF auth_module_scope('dash_meta_sala') = 'ALL' THEN
        v_branch := COALESCE(p_branch_id, auth_employee_branch_id());
    ELSE
        v_branch := auth_employee_branch_id();
    END IF;

    IF v_branch IS NULL THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.erp_sucursal_map m
        WHERE m.branch_id = v_branch AND NOT m.es_bodega
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH d AS (
        SELECT * FROM public.get_metas_dashboard(v_ym) g WHERE g.branch_id = v_branch
    ),
    -- «Vendido hoy» tiene que hablar el mismo idioma que el acumulado de arriba:
    -- si el acumulado descuenta la comisión y esta línea no, el día que entre
    -- una, el widget se contradice consigo mismo en la misma tarjeta.
    h AS (
        SELECT COALESCE(SUM(si.total::numeric), 0)
               - COALESCE((SELECT SUM(v.total::numeric) FROM public.ventas_sin_producto v
                            WHERE v.branch_id = v_branch AND v.fecha = v_hoy), 0) AS neto
        FROM public.sales_invoices si
        WHERE si.branch_id = v_branch
          AND si.fecha = v_hoy
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    )
    SELECT
        d.branch_id,
        b.name::text,
        v_ym,
        d.monto_meta,
        d.estado,
        d.venta_acumulada,
        ROUND(h.neto, 2),
        d.pct_cumplimiento,
        d.proyeccion,
        d.pct_proyectado,
        d.bono_tier,
        d.dias_transcurridos,
        d.dias_mes,
        (d.dias_mes - d.dias_transcurridos + 1)::integer,
        CASE WHEN d.monto_meta IS NOT NULL
             THEN GREATEST(0, ROUND(d.monto_meta - d.venta_acumulada, 2)) END,
        CASE WHEN d.monto_meta IS NOT NULL
              AND (d.dias_mes - d.dias_transcurridos + 1) > 0
             THEN ROUND(GREATEST(0, d.monto_meta - d.venta_acumulada)
                        / (d.dias_mes - d.dias_transcurridos + 1), 2) END,
        c.umbral_bono_medio,
        c.umbral_bono_total,
        public.metas_bono_activo(v_ym)
    FROM d
    CROSS JOIN h
    JOIN public.branches b ON b.id = d.branch_id
    CROSS JOIN public.metas_config c;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- La base de la propuesta: tres meses cerrados, netos
-- ════════════════════════════════════════════════════════════════════════════
-- Éste es el arreglo que más lejos llega. La meta de cada mes sale del ritmo de
-- los tres cerrados anteriores; mientras la comisión del banco estuvo adentro,
-- Salud 3 arrastró un ritmo inflado a TODAS sus metas siguientes. O sea que no
-- sólo se le regalaba avance: se le pedía de más el mes que venía.
CREATE OR REPLACE FUNCTION public.generar_propuestas_metas(p_year_month text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
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
  objetivo AS (
    SELECT (p_year_month || '-01')::date AS m_ini,
           EXTRACT(day FROM ((p_year_month || '-01')::date + interval '1 month -1 day'))::int AS dias
  ),
  agg AS (
    SELECT d.branch_id, date_trunc('month', d.date)::date AS m,
           SUM(d.sum_total - d.sum_no_producto)::numeric AS venta, COUNT(*) AS dias_dato
    FROM public.sales_daily_stats d GROUP BY 1, 2
  ),
  -- Solo meses COMPLETOS: uno a medias bajaría el ritmo sin que nadie vendiera
  -- menos.
  comp AS (
    SELECT a.*, EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int AS dias_mes
    FROM agg a
    WHERE a.dias_dato = EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int
  ),
  u3 AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.branch_id ORDER BY c.m DESC) AS rn
    FROM comp c, objetivo o WHERE c.m < o.m_ini
  ),
  -- El ritmo: la suma de las tres ventas sobre la suma de sus días. Por día y
  -- no promedio de meses, para que uno de 30 y uno de 31 no pesen distinto.
  ritmo AS (
    SELECT branch_id, SUM(venta)/SUM(dias_mes) AS por_dia,
           MAX(m) AS mes_ult
    FROM u3 WHERE rn <= 3 GROUP BY 1
  ),
  -- El cumplimiento del mes -1, que es el MÁS RECIENTE de los tres que forman
  -- el ritmo: así la fórmula usa un solo conjunto de meses y no dos.
  cumpl AS (
    SELECT r.branch_id,
           COALESCE(
             (SELECT x.pct_cumplimiento FROM public.metas_resultado x
               WHERE x.branch_id = r.branch_id AND x.year_month = to_char(r.mes_ult, 'YYYY-MM')),
             (SELECT ROUND(u.venta / NULLIF(s.monto_meta, 0) * 100, 1)
                FROM public.metas_sucursal s
                JOIN u3 u ON u.branch_id = s.branch_id AND u.m = r.mes_ult
               WHERE s.branch_id = r.branch_id AND s.year_month = to_char(r.mes_ult, 'YYYY-MM'))
           ) AS pct
    FROM ritmo r
  ),
  calc AS (
    SELECT r.branch_id,
           GREATEST(100, ROUND(r.por_dia * o.dias * f.factor, 2)) AS propuesta,
           c.pct, f.factor
    FROM ritmo r
    CROSS JOIN objetivo o
    JOIN cumpl c ON c.branch_id = r.branch_id
    -- Sin cumplimiento medible (sala nueva, o mes sin meta) el factor es 1.00:
    -- no se pide crecimiento sobre algo que no se pudo medir. El 1.00 está acá
    -- y no en un tramo de la tabla A PROPÓSITO: montado en el tramo de abajo
    -- cambia solo el día que alguien reordena los tramos, que es como se rompió.
    LEFT JOIN LATERAL (
      SELECT COALESCE((
        SELECT t.factor FROM public.metas_factor_cumplimiento t
         WHERE c.pct IS NOT NULL AND t.desde_pct <= c.pct
         ORDER BY t.desde_pct DESC LIMIT 1
      ), 1.00) AS factor
    ) f ON true
    WHERE EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                  WHERE m.branch_id = r.branch_id AND NOT m.es_bodega)
  ),
  ins AS (
    INSERT INTO public.metas_sucursal
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       monto_propuesto, estado, nota)
    SELECT c.branch_id, p_year_month, c.propuesta, 0, c.propuesta, c.propuesta, 'propuesta',
           CASE WHEN c.pct IS NULL THEN
             'Propuesta del sistema: el ritmo diario de los 3 meses cerrados por los días del mes. '
             || 'El mes anterior no tuvo meta, así que no hay cumplimiento que medir y no se pide '
             || 'crecimiento (factor 1.00)'
           ELSE
             'Propuesta del sistema: el ritmo diario de los 3 meses cerrados por los días del mes, '
             || 'con factor ' || c.factor || ' por haber cerrado el mes anterior en ' || c.pct || '%'
           END
    FROM calc c WHERE c.propuesta IS NOT NULL
    ON CONFLICT (branch_id, year_month) DO NOTHING
    RETURNING id, branch_id, year_month, monto_meta
  ),
  log AS (
    INSERT INTO public.metas_historial
      (meta_id, branch_id, year_month, evento, estado_despues, monto_despues, nota)
    SELECT i.id, i.branch_id, i.year_month, 'propuesta_generada', 'propuesta', i.monto_meta,
           'la calculó el portal con el ritmo de los meses cerrados y el factor de cumplimiento'
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

-- ════════════════════════════════════════════════════════════════════════════
-- El desglose de la propuesta: el mismo número, explicado
-- ════════════════════════════════════════════════════════════════════════════
-- Va junto con `generar_propuestas_metas` porque un desglose que no reproduce
-- el monto de arriba explica otra cosa — y eso es peor que no explicar nada.
CREATE OR REPLACE FUNCTION public.explicar_meta_propuesta(p_branch_id bigint, p_year_month text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r json;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_view') THEN RETURN NULL; END IF;

  WITH
  objetivo AS (
    SELECT (p_year_month || '-01')::date AS m_ini,
           EXTRACT(day FROM ((p_year_month || '-01')::date + interval '1 month -1 day'))::int AS dias
  ),
  agg AS (
    SELECT d.branch_id, date_trunc('month', d.date)::date AS m,
           SUM(d.sum_total - d.sum_no_producto)::numeric AS venta, COUNT(*) AS dias_dato
    FROM public.sales_daily_stats d GROUP BY 1, 2
  ),
  comp AS (
    SELECT a.*, EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int AS dias_mes
    FROM agg a
    WHERE a.dias_dato = EXTRACT(day FROM (a.m + interval '1 month -1 day'))::int
  ),
  u3 AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.branch_id ORDER BY c.m DESC) AS rn
    FROM comp c, objetivo o
    WHERE c.m < o.m_ini AND c.branch_id = p_branch_id
  ),
  ritmo AS (
    SELECT SUM(venta) AS suma_venta, SUM(dias_mes) AS suma_dias,
           SUM(venta)/SUM(dias_mes) AS por_dia, MAX(m) AS mes_ult
    FROM u3 WHERE rn <= 3
  ),
  cumpl AS (
    SELECT COALESCE(
      (SELECT x.pct_cumplimiento FROM public.metas_resultado x
        WHERE x.branch_id = p_branch_id AND x.year_month = to_char(r.mes_ult, 'YYYY-MM')),
      (SELECT ROUND(u.venta / NULLIF(s.monto_meta, 0) * 100, 1)
         FROM public.metas_sucursal s
         JOIN u3 u ON u.m = r.mes_ult
        WHERE s.branch_id = p_branch_id AND s.year_month = to_char(r.mes_ult, 'YYYY-MM'))
    ) AS pct,
    (SELECT s.monto_meta FROM public.metas_sucursal s
      WHERE s.branch_id = p_branch_id AND s.year_month = to_char(r.mes_ult, 'YYYY-MM')) AS meta_ult,
    to_char(r.mes_ult, 'YYYY-MM') AS ym_ult
    FROM ritmo r
  )
  SELECT json_build_object(
    'meses_base',  (SELECT json_agg(json_build_object(
                       'ym', to_char(u.m, 'YYYY-MM'), 'venta', round(u.venta, 2), 'dias', u.dias_mes)
                       ORDER BY u.m) FROM u3 u WHERE u.rn <= 3),
    'suma_venta',  round(r.suma_venta, 2),
    'suma_dias',   r.suma_dias,
    'ritmo_dia',   round(r.por_dia, 2),
    'dias_mes',    o.dias,
    'sub_ritmo',   round(r.por_dia * o.dias, 2),
    'ym_ultimo',   cu.ym_ult,
    'meta_ultimo', cu.meta_ult,
    'pct_ultimo',  cu.pct,
    'factor',      f.factor,
    'tramos',      (SELECT json_agg(json_build_object('desde', t.desde_pct, 'factor', t.factor)
                       ORDER BY t.desde_pct DESC) FROM public.metas_factor_cumplimiento t),
    'recalculada', GREATEST(100, ROUND(r.por_dia * o.dias * f.factor, 2))
  ) INTO r
  FROM ritmo r CROSS JOIN objetivo o CROSS JOIN cumpl cu
  LEFT JOIN LATERAL (
    SELECT COALESCE((
      SELECT t.factor FROM public.metas_factor_cumplimiento t
       WHERE cu.pct IS NOT NULL AND t.desde_pct <= cu.pct
       ORDER BY t.desde_pct DESC LIMIT 1
    ), 1.00) AS factor
  ) f ON true;

  RETURN r;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- El histórico y el congelado
-- ════════════════════════════════════════════════════════════════════════════
-- OJO: los meses YA congelados en `metas_resultado` (2025-01 → 2026-07) NO se
-- tocan. Un mes cerrado es un hecho asentado —con su bono ya calculado— y
-- reescribirlo por una regla nueva cambiaría la historia de la empresa. Estas
-- dos funciones sólo cambian para los meses que se congelen de ahora en más y
-- para los que todavía se derivan al vuelo.
CREATE OR REPLACE FUNCTION public.get_metas_historico()
 RETURNS TABLE(year_month text, branch_id bigint, monto_meta numeric, venta_total numeric, pct_cumplimiento numeric, bono_tier text, nota text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH
lim AS (
  SELECT date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date)::date AS mes_actual_ini,
         to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM') AS ym_hoy
),
sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
congelado AS (
  SELECT r.year_month, r.branch_id, r.monto_meta, r.venta_total,
         r.pct_cumplimiento, r.bono_tier, r.nota
  FROM public.metas_resultado r
),
ventas AS (
  SELECT d.branch_id, to_char(d.date, 'YYYY-MM') AS ym,
         SUM(d.sum_total - d.sum_no_producto) AS neto
  FROM public.sales_daily_stats d
  CROSS JOIN lim
  WHERE d.date >= '2025-05-01'
    AND d.date < lim.mes_actual_ini
    AND d.branch_id IN (SELECT s.branch_id FROM sucs s)
  GROUP BY d.branch_id, to_char(d.date, 'YYYY-MM')
),
claves AS (
  SELECT v.branch_id, v.ym FROM ventas v
  UNION
  SELECT m.branch_id, m.year_month FROM public.metas_sucursal m
  CROSS JOIN lim
  WHERE m.year_month < lim.ym_hoy
    AND m.branch_id IN (SELECT s.branch_id FROM sucs s)
),
derivado AS (
  SELECT
    k.ym AS year_month,
    k.branch_id,
    m.monto_meta,
    ROUND(COALESCE(v.neto, 0), 2) AS venta_total,
    CASE WHEN m.monto_meta > 0
         THEN ROUND(COALESCE(v.neto, 0) / m.monto_meta * 100, 1) END AS pct_cumplimiento,
    CASE WHEN m.monto_meta IS NULL THEN NULL
         WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
         WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_medio THEN 'medio'
         ELSE 'nada' END AS bono_tier,
    m.nota
  FROM claves k
  LEFT JOIN public.metas_sucursal m ON m.branch_id = k.branch_id AND m.year_month = k.ym
  LEFT JOIN ventas v ON v.branch_id = k.branch_id AND v.ym = k.ym
  CROSS JOIN public.metas_config c
  WHERE NOT EXISTS (
    SELECT 1 FROM congelado g WHERE g.branch_id = k.branch_id AND g.year_month = k.ym
  )
)
SELECT * FROM congelado
UNION ALL
SELECT * FROM derivado
ORDER BY 1 DESC, 4 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.congelar_metas_mes(p_year_month text, p_forzar boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  v_n integer;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;
  -- Un mes en curso no se congela: todavía se está vendiendo.
  IF p_year_month >= v_ym_actual THEN
    RAISE EXCEPTION 'MES_NO_CERRADO: % todavía no terminó', p_year_month;
  END IF;

  WITH
  cfg AS (SELECT * FROM public.metas_config LIMIT 1),
  sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
  ventas AS (
    SELECT d.branch_id, SUM(d.sum_total - d.sum_no_producto)::numeric AS neto
    FROM public.sales_daily_stats d
    WHERE to_char(d.date, 'YYYY-MM') = p_year_month
      AND d.branch_id IN (SELECT s.branch_id FROM sucs s)
    GROUP BY d.branch_id
  ),
  claves AS (
    SELECT v.branch_id FROM ventas v
    UNION
    SELECT m.branch_id FROM public.metas_sucursal m
    WHERE m.year_month = p_year_month
      AND m.branch_id IN (SELECT s.branch_id FROM sucs s)
  ),
  calc AS (
    SELECT k.branch_id,
           m.monto_base, m.monto_recuperacion, m.monto_meta, m.nota,
           ROUND(COALESCE(v.neto, 0), 2) AS venta,
           CASE WHEN m.monto_meta > 0
                THEN ROUND(COALESCE(v.neto, 0) / m.monto_meta * 100, 1) END AS pct,
           CASE WHEN m.monto_meta IS NULL OR m.monto_meta <= 0 THEN NULL
                WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
                WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_medio THEN 'medio'
                ELSE 'nada' END AS tier,
           c.umbral_bono_total, c.umbral_bono_medio, c.bono_pct_venta,
           c.pago_medio_pct, c.margen_recuperacion_pct
    FROM claves k
    LEFT JOIN public.metas_sucursal m
           ON m.branch_id = k.branch_id AND m.year_month = p_year_month
    LEFT JOIN ventas v ON v.branch_id = k.branch_id
    CROSS JOIN cfg c
  ),
  ins AS (
    INSERT INTO public.metas_resultado
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       venta_total, pct_cumplimiento, bono_tier, bolsa,
       umbral_total, umbral_medio, bono_pct_venta, pago_medio_pct, margen_pct, nota)
    SELECT c.branch_id, p_year_month, c.monto_base, c.monto_recuperacion, c.monto_meta,
           c.venta, c.pct, c.tier,
           -- La bolsa del bono, con la tasa de ESE mes.
           ROUND(c.venta * COALESCE(CASE c.tier
             WHEN 'completo' THEN c.bono_pct_venta
             WHEN 'medio'    THEN ROUND(c.bono_pct_venta * c.pago_medio_pct / 100, 6)
             ELSE 0 END, 0) / 100, 2),
           c.umbral_bono_total, c.umbral_bono_medio, c.bono_pct_venta,
           c.pago_medio_pct, c.margen_recuperacion_pct, c.nota
    FROM calc c
    ON CONFLICT (branch_id, year_month) DO UPDATE
      SET monto_base = EXCLUDED.monto_base,
          monto_recuperacion = EXCLUDED.monto_recuperacion,
          monto_meta = EXCLUDED.monto_meta,
          venta_total = EXCLUDED.venta_total,
          pct_cumplimiento = EXCLUDED.pct_cumplimiento,
          bono_tier = EXCLUDED.bono_tier,
          bolsa = EXCLUDED.bolsa,
          umbral_total = EXCLUDED.umbral_total,
          umbral_medio = EXCLUDED.umbral_medio,
          bono_pct_venta = EXCLUDED.bono_pct_venta,
          pago_medio_pct = EXCLUDED.pago_medio_pct,
          margen_pct = EXCLUDED.margen_pct,
          nota = EXCLUDED.nota,
          congelado_at = now()
      WHERE p_forzar          -- sin forzar, lo congelado NO se toca jamás
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- El mes en curso: día por día neto, y el aviso viaja con el dato
-- ════════════════════════════════════════════════════════════════════════════
-- Cada día trae ahora `no_producto`: cuánto de la barra de ese día NO es venta
-- de productos. Va acá y no en una segunda consulta a propósito — un aviso que
-- se pide aparte puede llegar tarde, o no llegar, y la barra se pintaría igual
-- sin que nada avise. Viajando con el dato, o están los dos o no está ninguno.
--
-- El ranking de vendedores NO necesita cambio: cruza `employees.code` contra
-- `cod_vendedor`, y NINGÚN empleado tiene código 100 ni 1000 (verificado en
-- producción). Esas ventas nunca estuvieron en el ranking.
CREATE OR REPLACE FUNCTION public.get_metas_mes_en_curso(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_metas   boolean := auth_has_module_permission('metas', 'can_view');
  v_widget  boolean := auth_has_module_permission('dash_meta_sala', 'can_view');
  v_todas   boolean := false;
  v_branch  bigint;
  v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ini     date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date)::date;
  v_ym      text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  v_fin     date;
  v_cfg     record;
  v_meta numeric; v_base numeric; v_recup numeric; v_estado text;
  v_acum numeric; v_proy numeric; v_dias int; v_dia_hoy int;
  v_dias_json json; v_vend json;
  v_prom_venta numeric; v_prom_ticket numeric; v_prom_dia numeric;
  v_prom_hora numeric; v_con_horario int; v_personas int; v_revisar int;
  v_np_total numeric; v_np_facturas int; v_np_detalle json;
BEGIN
  IF NOT (v_metas OR v_widget) THEN RETURN NULL; END IF;

  -- Quien tiene alcance de todas las salas puede pedir «todas» (NULL) o una.
  -- Quien no, ve la suya y el parámetro se ignora.
  IF (v_metas AND auth_module_scope('metas') = 'ALL')
     OR (v_widget AND auth_module_scope('dash_meta_sala') = 'ALL') THEN
    v_branch := p_branch_id;
    v_todas  := p_branch_id IS NULL;
  ELSE
    v_branch := auth_employee_branch_id();
  END IF;

  IF NOT v_todas AND v_branch IS NULL THEN RETURN NULL; END IF;
  IF NOT v_todas AND NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                                 WHERE m.branch_id = v_branch AND NOT m.es_bodega) THEN
    RETURN NULL;
  END IF;

  v_fin := (v_ini + interval '1 month - 1 day')::date;
  SELECT * INTO v_cfg FROM public.metas_config LIMIT 1;

  -- La meta y la proyección salen del mismo sitio que el tablero: si acá se
  -- recalcularan, un día dirían otra cosa que las tarjetas de al lado.
  SELECT sum(d.monto_meta), sum(d.venta_acumulada), sum(d.proyeccion),
         max(d.dias_mes), max(d.dias_transcurridos)
    INTO v_meta, v_acum, v_proy, v_dias, v_dia_hoy
  FROM public.get_metas_dashboard(v_ym) d
  WHERE v_todas OR d.branch_id = v_branch;

  SELECT sum(m.monto_base), sum(m.monto_recuperacion),
         CASE WHEN count(*) FILTER (WHERE m.estado <> 'oficial') > 0 THEN 'pendiente' ELSE 'oficial' END
    INTO v_base, v_recup, v_estado
  FROM public.metas_sucursal m
  WHERE m.year_month = v_ym AND (v_todas OR m.branch_id = v_branch)
    AND m.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega);

  -- ── Lo que no es venta de productos, este mes ───────────────────────────
  -- Se calcula UNA vez y se usa tres veces: para restar de cada día, para el
  -- total del aviso y para el detalle que se muestra al abrirlo.
  SELECT coalesce(sum(v.total::numeric), 0), count(*)::int,
         json_agg(json_build_object(
           'fecha', v.fecha, 'hora', to_char(v.hora, 'HH24:MI'),
           'cliente', v.cliente, 'correlativo', v.correlativo,
           'total', v.total, 'motivo', v.motivo) ORDER BY v.fecha DESC, v.hora DESC)
    INTO v_np_total, v_np_facturas, v_np_detalle
  FROM public.ventas_sin_producto v
  WHERE v.fecha BETWEEN v_ini AND v_fin
    AND (v_todas OR v.branch_id = v_branch)
    AND v.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega);

  -- ── Día por día ─────────────────────────────────────────────────────────
  SELECT json_agg(to_json(t) ORDER BY t.dia) INTO v_dias_json
  FROM (
    SELECT EXTRACT(day FROM b.fecha)::int AS dia,
           round(b.bruto - coalesce(n.monto, 0), 2) AS venta,
           (b.fecha = v_hoy) AS es_hoy,
           round(coalesce(n.monto, 0), 2) AS no_producto
    FROM (
      SELECT si.fecha, sum(si.total::numeric) AS bruto
      FROM public.sales_invoices si
      WHERE si.fecha BETWEEN v_ini AND v_fin
        AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
        AND (v_todas OR si.branch_id = v_branch)
        AND si.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega)
      GROUP BY si.fecha
    ) b
    LEFT JOIN (
      SELECT v.fecha, sum(v.total::numeric) AS monto
      FROM public.ventas_sin_producto v
      WHERE v.fecha BETWEEN v_ini AND v_fin
        AND (v_todas OR v.branch_id = v_branch)
        AND v.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega)
      GROUP BY v.fecha
    ) n ON n.fecha = b.fecha
  ) t;

  -- ── Quién vende ─────────────────────────────────────────────────────────
  -- `dias` sigue siendo «días con venta»: es el único dato de presencia que hay
  -- (attendance en 0, timesheets sin horas). Lo que se suma ahora son las
  -- HORAS PROGRAMADAS de esos mismos días, que sí existen desde que el horario
  -- se publica.
  SELECT json_agg(to_json(v) ORDER BY v.venta DESC) INTO v_vend
  FROM (
    WITH ventas AS (
      SELECT e.id AS employee_id, e.name AS nombre, e.branch_id AS sala_propia,
             si.branch_id, si.fecha,
             sum(si.total::numeric) AS venta_dia_monto,
             count(*)::int          AS tickets_dia
      FROM public.sales_invoices si
      JOIN public.employees e ON e.code = si.cod_vendedor AND e.status = 'ACTIVO'
      WHERE si.fecha BETWEEN v_ini AND v_fin
        AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
        AND (v_todas OR si.branch_id = v_branch)
        AND si.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega)
      GROUP BY e.id, e.name, e.branch_id, si.branch_id, si.fecha
    ),
    -- Las horas que el horario publicado le asigna a cada día que vendió.
    -- `NULL` = ese día no está cubierto por un horario publicado, o es día
    -- libre: no suma ni al numerador ni al denominador. `hay_horario`
    -- distingue las dos cosas, que es lo que separa «no sé» de «no tenía turno».
    con_horas AS (
      SELECT vt.*,
             (r.id IS NOT NULL) AS hay_horario,
             CASE
               WHEN r.id IS NOT NULL
                AND coalesce((r.schedule_data -> k.dia ->> 'isOff')::boolean, true) = false
                AND h.ini IS NOT NULL AND h.fin IS NOT NULL
               THEN GREATEST(0,
                      EXTRACT(epoch FROM (h.fin::time - h.ini::time)) / 3600.0
                      + CASE WHEN h.fin::time < h.ini::time THEN 24 ELSE 0 END
                      - CASE WHEN coalesce((r.schedule_data -> k.dia ->> 'hasLunch')::boolean, false)
                             THEN 1 ELSE 0 END)
             END AS horas_dia
      FROM ventas vt
      CROSS JOIN LATERAL (SELECT EXTRACT(dow FROM vt.fecha)::int::text AS dia) k
      LEFT JOIN public.employee_rosters r
             ON r.employee_id     = vt.employee_id
            AND r.week_start_date = date_trunc('week', vt.fecha)::date
            AND r.status          = 'PUBLISHED'
      LEFT JOIN public.shifts sh
             ON sh.id::text = nullif(r.schedule_data -> k.dia ->> 'shiftId', '')
      CROSS JOIN LATERAL (
        SELECT coalesce(nullif(r.schedule_data -> k.dia ->> 'customStart', ''), sh.start_time::text) AS ini,
               coalesce(nullif(r.schedule_data -> k.dia ->> 'customEnd',   ''), sh.end_time::text)   AS fin
      ) h
    )
    SELECT ch.employee_id, ch.nombre,
           (SELECT b.name FROM public.branches b WHERE b.id = ch.branch_id) AS sala,
           round(sum(ch.venta_dia_monto), 2)                       AS venta,
           sum(ch.tickets_dia)::int                                AS tickets,
           round(sum(ch.venta_dia_monto) / sum(ch.tickets_dia), 2) AS ticket,
           count(*)::int                                           AS dias,
           round(sum(ch.venta_dia_monto) / count(*), 2)            AS venta_dia,
           round(coalesce(sum(ch.horas_dia) FILTER (WHERE ch.horas_dia > 0), 0), 2) AS horas,
           count(*) FILTER (WHERE ch.horas_dia > 0)::int                            AS dias_horario,
           round(sum(ch.venta_dia_monto) FILTER (WHERE ch.horas_dia > 0)
                 / nullif(sum(ch.horas_dia) FILTER (WHERE ch.horas_dia > 0), 0), 2) AS venta_hora,
           -- Días con venta que el horario publicado marca libre, y si la sala
           -- de la venta no es la del empleado. Dos hechos, sin veredicto.
           count(*) FILTER (WHERE ch.hay_horario AND ch.horas_dia IS NULL)::int     AS dias_sin_turno,
           (min(ch.sala_propia) IS DISTINCT FROM ch.branch_id)                      AS sala_ajena
    FROM con_horas ch
    GROUP BY ch.employee_id, ch.nombre, ch.branch_id
  ) v;

  SELECT round(avg((x->>'venta')::numeric), 2),
         round(avg((x->>'ticket')::numeric), 2),
         round(avg((x->>'venta_dia')::numeric), 2),
         round(avg((x->>'venta_hora')::numeric), 2),
         count(*) FILTER (WHERE (x->>'venta_hora') IS NOT NULL)::int,
         count(*)::int,
         count(*) FILTER (WHERE (x->>'dias_sin_turno')::int > 0
                             OR (x->>'sala_ajena')::boolean)::int
    INTO v_prom_venta, v_prom_ticket, v_prom_dia, v_prom_hora,
         v_con_horario, v_personas, v_revisar
  FROM json_array_elements(coalesce(v_vend, '[]'::json)) x;

  RETURN json_build_object(
    'todas',        v_todas,
    'branch_id',    v_branch,
    'sala',         CASE WHEN v_todas THEN 'Todas las salas'
                         ELSE (SELECT b.name FROM public.branches b WHERE b.id = v_branch) END,
    'year_month',   v_ym,
    'meta',         v_meta,
    'monto_base',   v_base,
    'monto_recuperacion', v_recup,
    'estado_meta',  v_estado,
    'acumulado',    v_acum,
    'proyeccion',   v_proy,
    'dias_mes',     v_dias,
    'dia_hoy',      v_dia_hoy,
    'ritmo_diario', CASE WHEN v_dias > 0 THEN round(v_meta / v_dias, 2) END,
    'umbral_medio', v_cfg.umbral_bono_medio,
    'umbral_total', v_cfg.umbral_bono_total,
    'dias',         coalesce(v_dias_json, '[]'::json),
    'vendedores',   coalesce(v_vend, '[]'::json),
    'promedio_venta',  v_prom_venta,
    'promedio_ticket', v_prom_ticket,
    'promedio_dia',    v_prom_dia,
    -- Horario: el promedio por hora, a cuántos se les pudo calcular y sobre
    -- cuántos. La pantalla habilita la vista «por hora» sólo si son todos.
    'promedio_hora',   v_prom_hora,
    'con_horario',     coalesce(v_con_horario, 0),
    'personas',        coalesce(v_personas, 0),
    'para_revisar',    coalesce(v_revisar, 0),
    -- El aviso: cuánto se facturó este mes que NO es venta de productos, en
    -- cuántas facturas, y cuáles. Cero facturas ⇒ la pantalla no pinta nada.
    'no_producto',          coalesce(v_np_total, 0),
    'no_producto_facturas', coalesce(v_np_facturas, 0),
    'no_producto_detalle',  coalesce(v_np_detalle, '[]'::json)
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- El bono: la bolsa se calcula sobre venta de productos
-- ════════════════════════════════════════════════════════════════════════════
-- Es el arreglo con consecuencia en dinero. `v_venta` decide DOS cosas: el
-- tramo (nada / medio / completo) y la bolsa, que es `venta × tasa`. Con la
-- comisión del banco adentro, la sala cobraba bono sobre plata que no vendió —
-- y, en el borde de un umbral, podía cruzar a un tramo que no le tocaba.
--
-- Acá el filtro SÍ va por factura (`NOT EXISTS`) y no restando aparte: el
-- alcance es UNA sala y UN mes (~2,500 facturas), no el año entero, y las tres
-- consultas tienen que coincidir factura por factura para que el reparto por
-- persona cuadre con el total. La medición que desaconseja el anti-join era
-- sobre 14,011 filas del mes completo de las seis salas.
CREATE OR REPLACE FUNCTION public.get_bono_meta_sala(p_branch_id bigint, p_year_month text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch bigint;
    v_ini    date;
    v_fin    date;
    v_cfg    record;
    v_meta   numeric;
    v_estado text;
    v_venta  numeric;
    v_pct    numeric;
    v_tramo  text;
    v_tasa   numeric;
    v_bolsa  numeric;
    v_personas json;
    v_venta_jefes    numeric;
    v_venta_conocida numeric;
    v_venta_sin_codigo numeric;
    v_venta_otra_sala  numeric;
    v_pagado numeric;
    v_es_mes_actual boolean;
    v_proyeccion    numeric;
    v_pct_proy      numeric;
    v_tramo_proy    text;
    v_bolsa_proy    numeric;
    v_np_total      numeric;
    v_np_facturas   int;
BEGIN
    IF NOT auth_has_module_permission('metas', 'can_view') THEN
        RETURN NULL;
    END IF;

    -- Scope BRANCH: solo su propia sala, el parámetro se ignora.
    IF auth_module_scope('metas') = 'ALL' THEN
        v_branch := p_branch_id;
    ELSE
        v_branch := auth_employee_branch_id();
    END IF;
    IF v_branch IS NULL THEN
        RETURN NULL;
    END IF;

    v_ini := (p_year_month || '-01')::date;
    v_fin := (v_ini + interval '1 month' - interval '1 day')::date;
    v_es_mes_actual := p_year_month
        = to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');

    SELECT * INTO v_cfg FROM public.metas_config LIMIT 1;

    SELECT m.monto_meta, m.estado INTO v_meta, v_estado
    FROM public.metas_sucursal m
    WHERE m.branch_id = v_branch AND m.year_month = p_year_month;

    -- Lo que no es venta de productos, para el aviso de esta pantalla.
    SELECT coalesce(sum(v.total::numeric), 0), count(*)::int
      INTO v_np_total, v_np_facturas
    FROM public.ventas_sin_producto v
    WHERE v.branch_id = v_branch AND v.fecha BETWEEN v_ini AND v_fin;

    -- Venta de PRODUCTOS de la sala en el mes. Mismos filtros de estado que el
    -- resto del módulo; cuadra con sales_daily_stats menos su sum_no_producto.
    SELECT coalesce(sum(si.total::numeric), 0) INTO v_venta
    FROM public.sales_invoices si
    WHERE si.branch_id = v_branch
      AND si.fecha BETWEEN v_ini AND v_fin
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v WHERE v.invoice_id = si.id);

    v_pct := CASE WHEN v_meta > 0 THEN round(v_venta / v_meta * 100, 2) END;

    v_tramo := CASE
        WHEN v_meta IS NULL OR v_meta <= 0 THEN NULL
        WHEN v_pct >= v_cfg.umbral_bono_total THEN 'completo'
        WHEN v_pct >= v_cfg.umbral_bono_medio THEN 'medio'
        ELSE 'nada' END;

    v_tasa := CASE v_tramo
        WHEN 'completo' THEN v_cfg.bono_pct_venta
        WHEN 'medio'    THEN round(v_cfg.bono_pct_venta * v_cfg.pago_medio_pct / 100, 6)
        ELSE 0 END;

    v_bolsa := round(v_venta * coalesce(v_tasa, 0) / 100, 2);

    -- ── Proyección al cierre (solo el mes en curso) ─────────────────────────
    IF v_es_mes_actual THEN
        SELECT d.proyeccion INTO v_proyeccion
        FROM public.get_metas_dashboard(p_year_month) d
        WHERE d.branch_id = v_branch;

        IF v_proyeccion IS NOT NULL AND v_meta > 0 THEN
            v_pct_proy := round(v_proyeccion / v_meta * 100, 2);
            v_tramo_proy := CASE
                WHEN v_pct_proy >= v_cfg.umbral_bono_total THEN 'completo'
                WHEN v_pct_proy >= v_cfg.umbral_bono_medio THEN 'medio'
                ELSE 'nada' END;
            v_bolsa_proy := round(v_proyeccion * CASE v_tramo_proy
                WHEN 'completo' THEN v_cfg.bono_pct_venta
                WHEN 'medio'    THEN round(v_cfg.bono_pct_venta * v_cfg.pago_medio_pct / 100, 6)
                ELSE 0 END / 100, 2);
        END IF;
    END IF;

    -- El padrón: el personal ACTIVO de la sala, aunque haya vendido cero.
    SELECT json_agg(to_json(x) ORDER BY x.venta DESC, x.nombre) INTO v_personas
    FROM (
        WITH ventas AS (
            SELECT si.cod_vendedor AS code, sum(si.total::numeric) AS venta
            FROM public.sales_invoices si
            WHERE si.branch_id = v_branch
              AND si.fecha BETWEEN v_ini AND v_fin
              AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
              AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v WHERE v.invoice_id = si.id)
            GROUP BY si.cod_vendedor
        ),
        padron AS (
            SELECT e.id, e.code, e.name, r.name AS rol,
                   (r.name = 'Jefe/a de Sala') AS es_jefe,
                   (e.hire_date IS NOT NULL
                    AND e.hire_date > (v_fin - interval '3 months')) AS en_prueba,
                   coalesce(v.venta, 0) AS venta
            FROM public.employees e
            JOIN public.roles r ON r.id = e.role_id
            LEFT JOIN ventas v ON v.code = e.code
            WHERE e.status = 'ACTIVO' AND e.branch_id = v_branch
        ),
        tot AS (
            SELECT coalesce(sum(p.venta) FILTER (WHERE p.es_jefe), 0) AS venta_jefes,
                   count(*) FILTER (WHERE p.es_jefe)                  AS n_jefes
            FROM padron p
        )
        SELECT
            p.id AS employee_id, p.code, p.name AS nombre, p.rol,
            p.es_jefe, p.en_prueba,
            round(p.venta, 2) AS venta,
            CASE WHEN v_venta > 0 THEN round(p.venta / v_venta * 100, 2) END AS pct_venta,
            b.bruto AS bono_bruto,
            CASE WHEN p.en_prueba THEN round(b.bruto * 0.5, 2) ELSE b.bruto END AS bono,
            -- Lo mismo, pero con la bolsa proyectada: «si el mes cierra como va,
            -- te tocaría esto». NULL en un mes cerrado.
            CASE
                WHEN v_bolsa_proy IS NULL THEN NULL
                WHEN p.es_jefe THEN round(v_bolsa_proy / 4 / GREATEST(1, t.n_jefes), 2)
                                    * CASE WHEN p.en_prueba THEN 0.5 ELSE 1 END
                WHEN (v_venta - t.venta_jefes) > 0
                    THEN round(p.venta / (v_venta - t.venta_jefes) * (v_bolsa_proy * 0.75), 2)
                         * CASE WHEN p.en_prueba THEN 0.5 ELSE 1 END
                ELSE 0
            END AS bono_proyectado
        FROM padron p
        CROSS JOIN tot t
        CROSS JOIN LATERAL (
            SELECT CASE
                -- La base del reparto es TODA la venta de la sala menos la de la
                -- jefatura: lo vendido sin dueño se queda adentro y su parte se
                -- pierde. Sacarlo del denominador repartiría esa plata entre los
                -- demás, que es justo lo que la regla NO hace.
                WHEN p.es_jefe THEN round(v_bolsa / 4 / GREATEST(1, t.n_jefes), 2)
                WHEN (v_venta - t.venta_jefes) > 0
                    THEN round(p.venta / (v_venta - t.venta_jefes) * (v_bolsa * 0.75), 2)
                ELSE 0
            END AS bruto
        ) b
    ) x;

    SELECT coalesce(sum((p ->> 'bono')::numeric), 0),
           coalesce(sum((p ->> 'venta')::numeric), 0),
           coalesce(sum((p ->> 'venta')::numeric) FILTER (WHERE (p ->> 'es_jefe')::boolean), 0)
      INTO v_pagado, v_venta_conocida, v_venta_jefes
    FROM json_array_elements(coalesce(v_personas, '[]'::json)) p;

    -- Las dos fugas, separadas: una es un código que no existe (error de
    -- digitación) y la otra es alguien registrado pero asignado a otra sala. Se
    -- muestran distintas porque se arreglan distinto — la primera corrigiendo
    -- la venta, la segunda con la cobertura de horarios cuando exista.
    --
    -- Lo que no es venta de productos sale también de acá: hasta hoy caía en
    -- «código inexistente» —el 1000 no es de nadie— y se leía como un error de
    -- digitación que nadie iba a poder corregir nunca, porque no lo era.
    SELECT coalesce(sum(si.total::numeric)
                    FILTER (WHERE e.id IS NULL), 0),
           coalesce(sum(si.total::numeric)
                    FILTER (WHERE e.id IS NOT NULL AND e.branch_id IS DISTINCT FROM v_branch), 0)
      INTO v_venta_sin_codigo, v_venta_otra_sala
    FROM public.sales_invoices si
    LEFT JOIN public.employees e
           ON e.code = si.cod_vendedor AND e.status = 'ACTIVO'
    WHERE si.branch_id = v_branch
      AND si.fecha BETWEEN v_ini AND v_fin
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v WHERE v.invoice_id = si.id);

    RETURN json_build_object(
        'branch_id',      v_branch,
        'sala',           (SELECT b.name FROM public.branches b WHERE b.id = v_branch),
        'year_month',     p_year_month,
        'es_mes_actual',  v_es_mes_actual,
        'meta',           v_meta,
        'estado_meta',    v_estado,
        'venta',          round(v_venta, 2),
        'pct',            v_pct,
        'tramo',          v_tramo,
        'tasa_pct',       v_tasa,
        'bolsa',          v_bolsa,
        'bolsa_jefatura', round(v_bolsa / 4, 2),
        'bolsa_equipo',   round(v_bolsa * 0.75, 2),
        'proyeccion',       v_proyeccion,
        'pct_proyectado',   v_pct_proy,
        'tramo_proyectado', v_tramo_proy,
        'bolsa_proyectada', v_bolsa_proy,
        'base_reparto',   round(v_venta - v_venta_jefes, 2),
        'pagado',         round(v_pagado, 2),
        'no_pagado',      round(v_bolsa - v_pagado, 2),
        'venta_sin_dueno',           round(v_venta - v_venta_conocida, 2),
        'venta_codigo_inexistente',  round(v_venta_sin_codigo, 2),
        'venta_otra_sala',           round(v_venta_otra_sala, 2),
        'bonificaciones_activas', public.metas_bono_activo(p_year_month),
        'personas',       coalesce(v_personas, '[]'::json),
        'no_producto',          coalesce(v_np_total, 0),
        'no_producto_facturas', coalesce(v_np_facturas, 0)
    );
END;
$function$;
