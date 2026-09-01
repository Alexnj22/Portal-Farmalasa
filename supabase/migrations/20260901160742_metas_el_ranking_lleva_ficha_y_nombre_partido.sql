SET lock_timeout = '5s';

-- ── El ranking lleva la ficha y el nombre partido en dos ───────────────────
--
-- Dos cosas que pidió el usuario y que no se pueden resolver en la tarjeta:
--
-- 1 · LA FOTO VA SIEMPRE. Para pintarla hace falta la FICHA, así que cada fila
--     del listado lleva `employee_id`. La foto no viaja —una URL firmada
--     expira— : con el id, la campana busca a la persona en el mismo store del
--     que salen las caras del resto del portal, donde la foto ya viene firmada.
--
-- 2 · EL NOMBRE NO SE CORTA. «Katherine S…» y «DOLORES…» son nombres a medias.
--     El portal muestra siempre primer nombre + primer apellido, y eso no se
--     puede sacar partiendo `employees.name`: es una columna GENERADA y con
--     tres palabras la frontera es ambigua —«ANA PEREZ LOPEZ» puede ser un
--     nombre y dos apellidos o al revés, y en producción hay de las dos—. Por
--     eso viajan `first_names` y `last_names` por separado, que es lo que
--     `shortEmployeeName` pide expresamente cuando dice «si la fila que estás
--     pintando no los trae, agregalos al select en vez de confiar en el corte».

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
      SELECT v.branch_id, v.cod_vendedor,
             e2.id AS employee_id, e2.name AS nombre,
             e2.first_names, e2.last_names,
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
             'tabla', (
               SELECT json_agg(json_build_object(
                        'employee_id', x.employee_id,
                        'nombre',      x.nombre,
                        'nombres',     x.first_names,
                        'apellidos',   x.last_names,
                        'parte',       x.parte,
                        'yo',          x.cod_vendedor = d.mi_codigo,
                        'venta',       CASE WHEN d.ve_montos THEN x.venta END)
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
  'Avisa a cada sala cómo cerró el mes, en qué lugar quedó la persona entre los vendedores de SU sala y cuál es su meta nueva. El ranking de vendedores lo ven TODOS —con la ficha de cada quien para pintar su foto y el nombre partido en nombres/apellidos—; los montos, sólo quien tiene dash_meta_sala_vista_completa. Se arma por destinatario para marcarle su fila sin publicar el código de nadie. Idempotente por (persona, mes cerrado).';

REVOKE EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) TO service_role;
