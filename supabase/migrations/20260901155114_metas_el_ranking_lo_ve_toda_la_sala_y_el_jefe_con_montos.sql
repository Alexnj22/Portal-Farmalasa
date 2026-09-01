SET lock_timeout = '5s';

-- ── El ranking lo ve toda la sala; los montos, sólo el jefe ────────────────
--
-- Corregido por el usuario: «que todos los vean así, sólo que los dependientes
-- sin los montos; el jefe que sí vea los montos de cada vendedor, no sólo el
-- porcentaje».
--
-- Antes el listado entero era del jefe y el dependiente sólo sabía su propio
-- puesto. La línea que separa a los dos no es QUIÉN aparece en la lista —eso lo
-- ven todos— sino si al lado de cada quien va un monto.
--
-- Y el aviso de administración deja de hablar de «la empresa»: habla de LA
-- META, que es lo que se cumple o no.

CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_salas(
  p_ym_cerrado text,
  p_ultimo_intento boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_ym_nuevo    text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes    integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_fini        date;
  v_ffin        date;
  v_n           integer;
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
    SELECT c.branch_id,
           COALESCE(res.venta_total, ROUND(c.venta, 2)) AS venta,
           mv.monto_meta AS meta_cerrada,
           COALESCE(res.pct_cumplimiento,
                    CASE WHEN mv.monto_meta > 0
                         THEN ROUND(c.venta / mv.monto_meta * 100, 1) END) AS pct,
           mn.monto_meta AS meta_nueva
    FROM cerrado c
    JOIN public.erp_sucursal_map em ON em.branch_id = c.branch_id AND NOT em.es_bodega
    LEFT JOIN public.metas_sucursal mv
           ON mv.branch_id = c.branch_id AND mv.year_month = p_ym_cerrado
    LEFT JOIN public.metas_resultado res
           ON res.branch_id = c.branch_id AND res.year_month = p_ym_cerrado
    LEFT JOIN public.metas_sucursal mn
           ON mn.branch_id = c.branch_id AND mn.year_month = v_ym_nuevo
          AND mn.estado = 'oficial'
    WHERE (c.dias_dato = v_dias_mes OR res.year_month IS NOT NULL)
      AND (mn.year_month IS NOT NULL OR p_ultimo_intento)
  ),
  vend AS MATERIALIZED (
    SELECT * FROM public.get_vendedores_resumen(v_fini, v_ffin, NULL)
  ),
  venta_sala AS (
    SELECT branch_id, SUM(total_ventas) AS total FROM vend GROUP BY 1
  ),
  vendedores AS MATERIALIZED (
    SELECT x.*,
           rank()  OVER (PARTITION BY x.branch_id ORDER BY x.parte DESC) AS puesto,
           count(*) OVER (PARTITION BY x.branch_id)                      AS cuantos,
           ROUND(avg(x.parte) OVER (PARTITION BY x.branch_id), 1)        AS promedio
    FROM (
      SELECT v.branch_id, v.cod_vendedor, e2.name AS nombre,
             v.total_ventas AS venta,
             ROUND(v.total_ventas / NULLIF(t.total, 0) * 100, 1) AS parte
      FROM vend v
      JOIN venta_sala t ON t.branch_id = v.branch_id
      JOIN public.employees e2
        ON e2.code = v.cod_vendedor AND e2.branch_id = v.branch_id AND e2.status = 'ACTIVO'
    ) x
  ),
  destinatarios AS (
    SELECT e.id AS employee_id, e.code AS mi_codigo,
           s.branch_id, s.venta, s.meta_cerrada, s.pct, s.meta_nueva,
           mio.parte AS mi_parte, mio.puesto AS mi_puesto,
           mio.cuantos AS de, mio.promedio,
           EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.module_key = 'dash_meta_sala_vista_completa'
                      AND rp.can_view
                      AND rp.role_id IN (e.role_id, e.secondary_role_id)) AS ve_montos
    FROM salas s
    JOIN public.employees e ON e.branch_id = s.branch_id AND e.status = 'ACTIVO'
    LEFT JOIN vendedores mio
           ON mio.branch_id = s.branch_id AND mio.cod_vendedor = e.code
    WHERE EXISTS (SELECT 1 FROM public.role_permissions rp
                   WHERE rp.module_key = 'dash_meta_sala'
                     AND rp.can_view
                     AND rp.role_id IN (e.role_id, e.secondary_role_id))
  ),
  ins AS (
    INSERT INTO public.notifications
      (recipient_id, type, title, body, link, metadata, branch_id)
    SELECT d.employee_id,
           'METAS_CIERRE_SALA',
           CASE WHEN d.pct IS NULL
                THEN 'Así cerró ' || public.metas_mes_label(p_ym_cerrado)
                ELSE 'Cerraste ' || public.metas_mes_label(p_ym_cerrado) || ' en ' || d.pct || '%'
           END,
           CASE
             WHEN d.ve_montos AND d.pct IS NOT NULL THEN
               'Vendiste $' || to_char(d.venta, 'FM999,999,990.00')
               || ' de tu meta de $' || to_char(d.meta_cerrada, 'FM999,999,990.00') || '. '
             WHEN d.ve_montos THEN
               'Vendiste $' || to_char(d.venta, 'FM999,999,990.00')
               || '. Ese mes no tuvo meta. '
             ELSE ''
           END
           ||
           CASE
             WHEN d.meta_nueva IS NULL THEN
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo) || ' todavía se está definiendo.'
             WHEN d.ve_montos THEN
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo)
               || ' es $' || to_char(d.meta_nueva, 'FM999,999,990.00') || '.'
             ELSE
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo)
               || ' ya está publicada. Mírala en Inicio.'
           END,
           '/overview',
           jsonb_build_object(
             'ym_cerrado',    p_ym_cerrado,
             'ym_nuevo',      v_ym_nuevo,
             'mes_cerrado',   public.metas_mes_label(p_ym_cerrado),
             'mes_nuevo',     public.metas_mes_label(v_ym_nuevo),
             'pct',           d.pct,
             'mi_parte',      d.mi_parte,
             'puesto',        d.mi_puesto,
             'de',            d.de,
             'promedio',      d.promedio,
             -- El listado va para TODA la sala. Lo que separa al jefe del
             -- dependiente no es quién aparece —eso lo ven todos— sino si al
             -- lado de cada quien va un monto: `venta` sólo con
             -- `dash_meta_sala_vista_completa`.
             --
             -- Se arma por destinatario para poder marcarle su propia fila sin
             -- publicar el código de nadie: `employees.code` es la semilla del
             -- PIN del kiosco (SHA-256 del código).
             'tabla', (
               SELECT json_agg(json_build_object(
                        'nombre', x.nombre,
                        'parte',  x.parte,
                        'yo',     x.cod_vendedor = d.mi_codigo,
                        'venta',  CASE WHEN d.ve_montos THEN x.venta END)
                      ORDER BY x.parte DESC)
               FROM vendedores x
               WHERE x.branch_id = d.branch_id)
           )
           || CASE WHEN d.ve_montos
                   THEN jsonb_build_object(
                          'venta',      d.venta,
                          'meta',       d.meta_cerrada,
                          'meta_nueva', d.meta_nueva)
                   ELSE '{}'::jsonb
              END,
           d.branch_id::integer
    FROM destinatarios d
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.recipient_id = d.employee_id
         AND n.type = 'METAS_CIERRE_SALA'
         AND n.metadata ->> 'ym_cerrado' = p_ym_cerrado
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) IS
  'Avisa a cada sala cómo cerró el mes, en qué lugar quedó la persona entre los vendedores de SU sala y cuál es su meta nueva. El ranking de vendedores lo ven TODOS; los montos —los de la sala y los de cada vendedor— sólo quien tiene dash_meta_sala_vista_completa. Se arma por destinatario para marcarle su fila sin publicar el código de nadie. Idempotente por (persona, mes cerrado).';

REVOKE EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) TO service_role;


-- ── El aviso de administración habla de la META, no de «la empresa» ────────
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
      AND NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map em
                       WHERE em.branch_id = e.branch_id AND NOT em.es_bodega)
  ),
  ins AS (
    INSERT INTO public.notifications
      (recipient_id, type, title, body, link, metadata)
    SELECT d.employee_id,
           'METAS_CIERRE_EMPRESA',
           -- «La meta» y no «la empresa»: lo que cerró en 96.4% es la meta.
           'La meta de ' || public.metas_mes_label(p_ym_cerrado)
             || ' cerró en ' || (SELECT pct FROM global) || '%',
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
  'El cierre del mes para administración: cumplimiento global de la meta (venta total sobre meta total, no el promedio de los seis porcentajes), cada sucursal con su porcentaje, y los tres vendedores con más venta. Va a quien puede ver el módulo metas y NO está en una sala. Idempotente por (persona, mes cerrado).';

REVOKE EXECUTE ON FUNCTION public.metas_avisar_cierre_a_admin(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_avisar_cierre_a_admin(text, boolean) TO service_role;
