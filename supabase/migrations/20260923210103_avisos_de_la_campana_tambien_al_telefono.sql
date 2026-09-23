SET lock_timeout = '5s';

-- «Que tengan push» (usuario, 2026-09-23): los avisos que sólo llegaban a la
-- campana pasan a sonar también en el teléfono.
--  · push_de_notificaciones(ids): helper nuevo para las funciones que escriben
--    en `notifications` directo en lugar de pasar por notify_employees.
--  · metas_avisar_cierre_a_salas, metas_avisar_cierre_a_admin,
--    metas_notificar_rol (metas por aprobar) y notificar_decision_diferencia
--    (diferencias de pedido): usan el helper.
--  · promociones_ciclo_diario y promociones_cerrar_meses_de_laboratorio:
--    notify_employees con p_push = true.

CREATE OR REPLACE FUNCTION public.push_de_notificaciones(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
-- Manda al teléfono avisos que YA están en la campana. Recibe los ids de las
-- filas de `notifications` y agrupa por (título, cuerpo, enlace): los que
-- dicen lo mismo salen en un solo envío, los distintos (p. ej. uno por sala)
-- en envíos separados. Existe para las funciones que escriben en
-- `notifications` directo en vez de pasar por `notify_employees`.
DECLARE
  g   record;
  v_n integer := 0;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN 0; END IF;
  FOR g IN
    SELECT n.title, n.body, n.link, array_agg(DISTINCT n.recipient_id) AS ids
      FROM public.notifications n
     WHERE n.id = ANY(p_ids)
     GROUP BY n.title, n.body, n.link
  LOOP
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := jsonb_build_object(
        'title',        g.title,
        'message',      coalesce(g.body, ''),
        'url',          coalesce(g.link, '/home'),
        'target_type',  'EMPLOYEE',
        'target_value', to_jsonb(g.ids)));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.push_de_notificaciones(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_de_notificaciones(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_salas(p_ym_cerrado text, p_ultimo_intento boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ym_nuevo    text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes    integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_fini        date;
  v_ffin        date;
  v_clave       text;
  v_n           integer;
  v_ids         uuid[];
BEGIN
  IF p_ym_cerrado IS NULL OR p_ym_cerrado !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_cerrado;
  END IF;
  v_fini  := (p_ym_cerrado || '-01')::date;
  v_ffin  := (v_fini + interval '1 month -1 day')::date;
  v_clave := 'METAS_CIERRE_SALA:' || p_ym_cerrado;

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
    -- Una vez por persona y por mes cerrado. La marca vive fuera de la campana:
    -- borrar el aviso ya no lo vuelve a pedir.
    WHERE NOT EXISTS (
      SELECT 1 FROM public.avisos_emitidos a
       WHERE a.recipient_id = d.employee_id AND a.clave = v_clave
    )
    RETURNING id, recipient_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT v_clave, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*), array_agg(id) INTO v_n, v_ids FROM ins;

  -- También al teléfono (2026-09-23).
  PERFORM public.push_de_notificaciones(v_ids);

  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_admin(p_ym_cerrado text, p_ultimo_intento boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ym_nuevo   text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes   integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_fini       date;
  v_ffin       date;
  v_clave      text;
  v_n          integer;
  v_ids        uuid[];
BEGIN
  IF p_ym_cerrado IS NULL OR p_ym_cerrado !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_cerrado;
  END IF;
  v_fini  := (p_ym_cerrado || '-01')::date;
  v_ffin  := (v_fini + interval '1 month -1 day')::date;
  v_clave := 'METAS_CIERRE_EMPRESA:' || p_ym_cerrado;

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
        SELECT 1 FROM public.avisos_emitidos a
         WHERE a.recipient_id = d.employee_id AND a.clave = v_clave
      )
    RETURNING id, recipient_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT v_clave, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*), array_agg(id) INTO v_n, v_ids FROM ins;

  -- También al teléfono (2026-09-23).
  PERFORM public.push_de_notificaciones(v_ids);

  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.metas_notificar_rol(p_role_name text, p_type text, p_title text, p_body text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_n integer;
  v_ids uuid[];
BEGIN
  WITH destinatarios AS (
    SELECT e.id FROM public.employees e
    JOIN public.roles r ON r.name = p_role_name
    WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
      AND e.status = 'ACTIVO'
  ),
  refrescados AS (
    UPDATE public.notifications n
    SET body = p_body, created_at = now()
    WHERE n.recipient_id IN (SELECT d.id FROM destinatarios d)
      AND n.type = p_type AND n.title = p_title AND n.read_at IS NULL
    RETURNING n.id, n.recipient_id
  ),
  nuevos AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link)
    SELECT d.id, p_type, p_title, p_body, '/metas?tab=confirmacion'
    FROM destinatarios d
    WHERE d.id NOT IN (SELECT r.recipient_id FROM refrescados r)
    RETURNING id, recipient_id
  )
  SELECT (SELECT count(*) FROM refrescados) + (SELECT count(*) FROM nuevos),
         (SELECT array_agg(id) FROM (SELECT id FROM refrescados UNION ALL SELECT id FROM nuevos) x)
    INTO v_n, v_ids;

  -- También al teléfono (2026-09-23), incluido el aviso que se refresca.
  PERFORM public.push_de_notificaciones(v_ids);

  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_decision_diferencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_prod    text;
    v_num     integer;
    v_sala    text;
    v_sala_b  integer;
    v_bodega  integer;
    v_rotulo  text;
    v_titulo  text;
    v_cuerpo  text;
    v_dest    uuid[];
    v_ids     uuid[];
BEGIN
    SELECT p.numero INTO v_num FROM public.pedidos p WHERE p.id = NEW.pedido_id;
    SELECT pr.nombre INTO v_prod FROM public.products pr WHERE pr.id = NEW.erp_product_id;
    SELECT m.nombre, m.branch_id INTO v_sala, v_sala_b
      FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = NEW.erp_sucursal_id;
    SELECT m.branch_id INTO v_bodega FROM public.erp_sucursal_map m WHERE m.es_bodega;

    SELECT o.rotulo INTO v_rotulo FROM public.diferencia_opcion o
     WHERE o.error_tipo = NEW.error_tipo AND o.valor = NEW.resolucion_tipo;

    v_prod := coalesce(v_prod, 'un producto');

    IF NEW.resolucion_status = 'propuesta' THEN
        v_titulo := 'Te piden una decisión';
        v_cuerpo := coalesce(v_sala, 'Una sala') || ' propone: ' || coalesce(v_rotulo, '—')
                 || ' · ' || v_prod || ' del pedido #' || coalesce(v_num::text, '?');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id = v_bodega AND e.id <> coalesce(NEW.resuelto_por, e.id);

    ELSIF NEW.resolucion_status = 'contrapropuesta' THEN
        v_titulo := 'Bodega propone otra salida';
        v_cuerpo := 'Bodega propone: ' || coalesce(v_rotulo, '—')
                 || ' · ' || v_prod || ' del pedido #' || coalesce(v_num::text, '?');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id = v_sala_b AND e.id <> coalesce(NEW.resuelto_por, e.id);

    ELSIF NEW.resolucion_status = 'escalada' THEN
        v_titulo := 'Una diferencia sin acuerdo';
        v_cuerpo := coalesce(v_sala, 'Una sala') || ' y bodega no coinciden sobre ' || v_prod
                 || ' del pedido #' || coalesce(v_num::text, '?')
                 || coalesce(' — ' || NEW.nota_rechazo, '');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;

    ELSIF NEW.resolucion_status IN ('acordada', 'confirmada') THEN
        v_titulo := CASE WHEN NEW.resolucion_status = 'confirmada'
                         THEN 'Diferencia cerrada' ELSE 'Quedaron de acuerdo' END;
        v_cuerpo := coalesce(v_rotulo, '—') || ' · ' || v_prod
                 || ' del pedido #' || coalesce(v_num::text, '?');
        -- A las dos partes: el acuerdo le cambia el trabajo a los dos lados.
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id IN (v_sala_b, v_bodega)
           AND e.id <> coalesce(NEW.confirmado_suc_por, NEW.supervisado_por, e.id);
    ELSE
        RETURN NEW;
    END IF;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RETURN NEW;
    END IF;

    WITH ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'PEDIDO_DIFERENCIA', v_titulo, v_cuerpo, '/pedidos',
           jsonb_build_object('pedido_id', NEW.pedido_id, 'pedido_item_id', NEW.id,
                              'erp_sucursal_id', NEW.erp_sucursal_id, 'estado', NEW.resolucion_status),
           v_sala_b, coalesce(NEW.resuelto_por, NEW.confirmado_suc_por)
      FROM unnest(v_dest) d
    RETURNING id)
    SELECT array_agg(id) INTO v_ids FROM ins;

    -- También al teléfono (2026-09-23).
    PERFORM public.push_de_notificaciones(v_ids);

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.promociones_cerrar_meses_de_laboratorio()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_n     integer := 0;
    v_pm    record;
    v_costo numeric;
    v_dest  uuid[];
BEGIN
    FOR v_pm IN
        SELECT pm.id, pm.nombre, pm.year_month
          FROM public.promociones pm
         WHERE pm.tipo = 'laboratorio'
           AND pm.estado = 'activa'
           -- El mes tiene que haber TERMINADO. Un borrador nunca llega acá
           -- porque no está activa: cerrar un borrador congelaría una matriz
           -- que nadie decidió.
           AND ((pm.year_month || '-01')::date
                + interval '1 month')::date <= v_hoy
           AND NOT EXISTS (SELECT 1 FROM public.promocion_cierre_sala c
                            WHERE c.promocion_id = pm.id)
    LOOP
        INSERT INTO public.promocion_cierre_sala
            (promocion_id, branch_id, venta, nivel, monto_por_persona, personas, costo)
        SELECT v_pm.id, a.branch_id, a.venta, a.nivel,
               a.monto_por_persona, a.personas, a.costo
          FROM public.promocion_laboratorio_avance(v_pm.id, v_pm.year_month) a;

        SELECT coalesce(sum(c.costo), 0) INTO v_costo
          FROM public.promocion_cierre_sala c WHERE c.promocion_id = v_pm.id;

        UPDATE public.promociones
           SET estado = 'finalizada', updated_at = now()
         WHERE id = v_pm.id;

        PERFORM public.promocion_log(v_pm.id, NULL, NULL, 'mes_cerrado',
            'activa', 'finalizada',
            v_pm.year_month || ' congelado · costo ' || to_char(v_costo, 'FM999999990.00'));
        v_n := v_n + 1;

        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha,'empleado') = 'empleado'
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.module_key = 'promociones' AND rp.can_view
                          AND rp.role_id IN (e.role_id, e.secondary_role_id));

        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(
                v_dest, 'PROMO_CERRADA',
                'Cerró el mes — ' || v_pm.nombre,
                'Los niveles de ' || v_pm.year_month || ' quedaron congelados. '
                  || 'Costo del programa: $' || to_char(v_costo, 'FM999999990.00') || '.',
                '/promociones?tab=historico',
                jsonb_build_object('promocion_id', v_pm.id,
                                   'year_month',   v_pm.year_month),
                true, NULL);
        END IF;
    END LOOP;

    RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.promociones_ciclo_diario()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_lote     integer := 0;
    v_fecha    integer := 0;
    v_final    integer := 0;
    v_avisos   integer := 0;
    v_lab      integer := 0;
    v_fila     record;
    v_sala     record;
    v_dest     uuid[];
    v_donde    text;
    v_titulo   text;
    v_cuerpo   text;
    v_salida   text := '';
    -- Lo que hace falta para contestar «¿cuándo terminó?» y «¿hubo campaña?».
    v_ult_fin  date;
    v_motivo   text;
    v_viva     timestamptz;
    v_dia_viva date;
BEGIN
    -- El avance se calcula UNA sola vez: lo necesitan el cierre por lote, el
    -- aviso por sala y el «dónde sí hay» de cada aviso. Llamarlo dentro del
    -- bucle costaba una pasada completa por cada sala avisada.
    DROP TABLE IF EXISTS _promo_av;
    CREATE TEMP TABLE _promo_av ON COMMIT DROP AS
        SELECT * FROM public.promocion_avance(true);
    CREATE INDEX ON _promo_av (renglon_id, branch_id);

    -- ── 1 · Cerrar los que se quedaron sin lote ──────────────────────────────
    FOR v_fila IN
        WITH tot AS (
            SELECT a.renglon_id, sum(a.vendido) AS vendido
              FROM _promo_av a
             GROUP BY a.renglon_id
        )
        SELECT r.id, r.promocion_id, r.lote_total, p.nombre AS producto,
               tot.vendido
          FROM public.promocion_renglon r
          JOIN tot ON tot.renglon_id = r.id
          JOIN public.products p ON p.id = r.erp_product_id
         WHERE r.estado = 'abierto' AND tot.vendido >= r.lote_total
    LOOP
        UPDATE public.promocion_renglon
           SET estado = 'cerrado', cerrado_at = now(),
               cerrado_motivo = 'lote_agotado', updated_at = now()
         WHERE id = v_fila.id;

        PERFORM public.promocion_log(
            v_fila.promocion_id, v_fila.id, NULL, 'cerrado_lote_agotado',
            'abierto', 'cerrado',
            v_fila.producto || ': se vendieron ' || v_fila.vendido::int ||
            ' de un lote de ' || v_fila.lote_total);
        v_lote := v_lote + 1;
    END LOOP;

    -- ── 2 · Cerrar los que se les venció la fecha ────────────────────────────
    FOR v_fila IN
        SELECT r.id, r.promocion_id, r.fin, p.nombre AS producto
          FROM public.promocion_renglon r
          JOIN public.products p ON p.id = r.erp_product_id
         WHERE r.estado = 'abierto' AND r.fin < v_hoy
    LOOP
        UPDATE public.promocion_renglon
           SET estado = 'cerrado', cerrado_at = now(),
               cerrado_motivo = 'fin_de_vigencia', updated_at = now()
         WHERE id = v_fila.id;

        PERFORM public.promocion_log(
            v_fila.promocion_id, v_fila.id, NULL, 'cerrado_fin_de_vigencia',
            'abierto', 'cerrado',
            v_fila.producto || ': venció el ' || v_fila.fin::text);
        v_fecha := v_fecha + 1;
    END LOOP;

    -- ── 3 · La promoción se finaliza cuando cierra su ÚLTIMO renglón ─────────
    FOR v_fila IN
        SELECT pm.id, pm.nombre, pm.created_at
          FROM public.promociones pm
         WHERE pm.estado = 'activa'
           AND pm.tipo = 'producto'
           AND EXISTS (SELECT 1 FROM public.promocion_renglon r WHERE r.promocion_id = pm.id)
           AND NOT EXISTS (SELECT 1 FROM public.promocion_renglon r
                            WHERE r.promocion_id = pm.id AND r.estado = 'abierto')
    LOOP
        UPDATE public.promociones
           SET estado = 'finalizada', updated_at = now()
         WHERE id = v_fila.id;

        PERFORM public.promocion_log(v_fila.id, NULL, NULL, 'finalizada',
            'activa', 'finalizada', 'cerró su último producto');
        v_final := v_final + 1;

        -- Cuándo venció el último producto, y qué lo cerró. El motivo sólo se
        -- nombra cuando es UNO solo: con una promoción que cerró mitad por
        -- fecha y mitad por lote, decir «venció» sería la mitad de la verdad.
        SELECT max(r.fin),
               CASE WHEN count(DISTINCT r.cerrado_motivo) = 1
                    THEN min(r.cerrado_motivo) END
          INTO v_ult_fin, v_motivo
          FROM public.promocion_renglon r
         WHERE r.promocion_id = v_fila.id;

        /* ── ¿Estuvo viva alguna vez? ────────────────────────────────────
         * El anclaje es la ACTIVACIÓN y no la creación: una promoción puede
         * pasar semanas en borrador sin que eso diga nada de si corrió. Si su
         * último producto ya había vencido ese día, no hubo campaña — se cierra
         * igual, pero no es noticia para nadie. */
        SELECT min(h.created_at) INTO v_viva
          FROM public.promocion_historial h
         WHERE h.promocion_id = v_fila.id AND h.evento = 'activada';
        v_dia_viva := (coalesce(v_viva, v_fila.created_at)
                       AT TIME ZONE 'America/El_Salvador')::date;

        IF v_ult_fin IS NOT NULL AND v_ult_fin < v_dia_viva THEN
            -- Queda escrito por qué NO se avisó: un aviso que no sale y no deja
            -- rastro se lee igual que uno que se perdió.
            PERFORM public.promocion_log(v_fila.id, NULL, NULL,
                'finalizada_sin_aviso', 'activa', 'finalizada',
                'se activó el ' || v_dia_viva::text || ', con el último producto '
                || 'vencido desde el ' || v_ult_fin::text || ': no hubo campaña que avisar');
            CONTINUE;
        END IF;

        -- La fecha en palabras. El año sólo cuando no es el de hoy: «venció el
        -- 31 de agosto» se entiende, y «de 2026» sobra doce meses de cada doce.
        v_cuerpo := CASE
            WHEN v_motivo = 'fin_de_vigencia' AND v_ult_fin IS NOT NULL THEN
                'Venció el ' || extract(day from v_ult_fin)::int || ' de ' ||
                (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                       'agosto','septiembre','octubre','noviembre','diciembre'])
                    [extract(month from v_ult_fin)::int] ||
                CASE WHEN extract(year from v_ult_fin) <> extract(year from v_hoy)
                     THEN ' de ' || extract(year from v_ult_fin)::int::text ELSE '' END || '.'
            WHEN v_motivo = 'lote_agotado' THEN 'Se vendió todo el lote.'
            ELSE 'Cerró su último producto.'
        END || ' Podés ver cómo quedó en Promociones.';

        -- A quien lleva las promociones: se terminó una.
        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha,'empleado') = 'empleado'
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.module_key = 'promociones' AND rp.can_view
                          AND rp.role_id IN (e.role_id, e.secondary_role_id));

        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(
                v_dest, 'PROMO_CERRADA',
                'Promoción terminada — ' || v_fila.nombre,
                v_cuerpo,
                '/promociones?tab=historico',
                jsonb_build_object('promocion_id', v_fila.id),
                true, NULL);
        END IF;
    END LOOP;

    -- ── 4 · El aviso de «se te está acabando», por sala ──────────────────────
    -- Se marca la fecha del aviso en la fila del reparto, así que un segundo
    -- pase del mismo día no lo repite. El del 100% sale aunque ya haya salido
    -- el del 80%: son dos momentos distintos.
    FOR v_sala IN
        WITH av AS (SELECT * FROM _promo_av)
        SELECT rep.id AS reparto_id, rep.renglon_id, rep.branch_id,
               rep.asignado_vigente, rep.avisado_80_at, rep.avisado_100_at,
               coalesce(av.vendido, 0)                                  AS vendido,
               greatest(rep.asignado_vigente - coalesce(av.vendido,0),0) AS queda,
               CASE WHEN rep.asignado_vigente > 0
                    THEN coalesce(av.vendido,0) / rep.asignado_vigente * 100
               END AS pct,
               b.name  AS sala,
               pr.nombre AS producto,
               pm.id   AS promocion_id,
               pm.nombre AS promocion
          FROM public.promocion_reparto rep
          JOIN public.promocion_renglon r  ON r.id  = rep.renglon_id
          JOIN public.promociones       pm ON pm.id = r.promocion_id
          JOIN public.products          pr ON pr.id = r.erp_product_id
          JOIN public.branches          b  ON b.id  = rep.branch_id
          LEFT JOIN av ON av.renglon_id = rep.renglon_id AND av.branch_id = rep.branch_id
         WHERE r.estado = 'abierto' AND pm.estado = 'activa'
           AND rep.asignado_vigente > 0
           AND coalesce(av.vendido,0) / rep.asignado_vigente * 100 >= 80
           AND (rep.avisado_80_at IS NULL
                OR (rep.avisado_100_at IS NULL
                    AND coalesce(av.vendido,0) >= rep.asignado_vigente))
    LOOP
        -- Dónde SÍ hay: las otras salas del mismo renglón que todavía tienen.
        -- Sin esto el aviso dice «se te acaba» y deja a la persona sin nada que
        -- hacer con esa información.
        SELECT string_agg(x.sala || ' ' || x.queda::int, ' · ' ORDER BY x.queda DESC)
          INTO v_donde
          FROM (
            SELECT b2.name AS sala,
                   rep2.asignado_vigente - coalesce(av2.vendido,0) AS queda
              FROM public.promocion_reparto rep2
              JOIN public.branches b2 ON b2.id = rep2.branch_id
              LEFT JOIN _promo_av av2
                     ON av2.renglon_id = rep2.renglon_id AND av2.branch_id = rep2.branch_id
             WHERE rep2.renglon_id = v_sala.renglon_id
               AND rep2.branch_id <> v_sala.branch_id
               AND rep2.asignado_vigente - coalesce(av2.vendido,0) > 0
             ORDER BY 2 DESC
             LIMIT 3
          ) x;

        IF v_sala.queda <= 0 THEN
            v_titulo := 'Se acabó tu lote — ' || v_sala.producto;
            v_cuerpo := v_sala.promocion || ': vendiste las ' ||
                        v_sala.asignado_vigente || ' unidades que te tocaban.';
        ELSE
            v_titulo := 'Te quedan ' || v_sala.queda::int || ' — ' || v_sala.producto;
            v_cuerpo := v_sala.promocion || ': llevás ' || v_sala.vendido::int ||
                        ' de ' || v_sala.asignado_vigente || ' unidades (' ||
                        round(v_sala.pct)::int || '%).';
        END IF;

        v_cuerpo := v_cuerpo || CASE
            WHEN v_donde IS NOT NULL THEN ' Todavía hay en: ' || v_donde || '.'
            ELSE ' Ya no queda en ninguna otra sala.' END;

        -- A la sala: quien puede pedir un traslado, que es quien puede ACTUAR
        -- sobre este aviso.
        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND e.branch_id = v_sala.branch_id
           AND coalesce(e.tipo_ficha,'empleado') = 'empleado'
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.module_key = 'traslados' AND rp.can_edit
                          AND rp.role_id IN (e.role_id, e.secondary_role_id));

        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(
                v_dest, 'PROMO_LOTE_BAJO', v_titulo, v_cuerpo, '/traslados',
                jsonb_build_object('promocion_id', v_sala.promocion_id,
                                   'renglon_id',   v_sala.renglon_id,
                                   'branch_id',    v_sala.branch_id),
                true, v_sala.branch_id::integer);
            v_avisos := v_avisos + 1;
        END IF;

        -- Y a supervisión, que es quien puede mover producto entre salas.
        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha,'empleado') = 'empleado'
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.module_key = 'promociones' AND rp.can_view
                          AND rp.role_id IN (e.role_id, e.secondary_role_id));

        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(
                v_dest, 'PROMO_LOTE_BAJO',
                v_sala.sala || ': ' || v_titulo, v_cuerpo, '/promociones',
                jsonb_build_object('promocion_id', v_sala.promocion_id,
                                   'renglon_id',   v_sala.renglon_id,
                                   'branch_id',    v_sala.branch_id),
                true, NULL);
        END IF;

        UPDATE public.promocion_reparto
           SET avisado_80_at  = coalesce(avisado_80_at, now()),
               avisado_100_at = CASE WHEN v_sala.queda <= 0
                                     THEN coalesce(avisado_100_at, now())
                                     ELSE avisado_100_at END,
               updated_at     = now()
         WHERE id = v_sala.reparto_id;

        PERFORM public.promocion_log(
            v_sala.promocion_id, v_sala.renglon_id, v_sala.branch_id,
            CASE WHEN v_sala.queda <= 0 THEN 'aviso_lote_agotado_sala'
                 ELSE 'aviso_lote_bajo_sala' END,
            NULL, round(v_sala.pct)::int || '%', v_sala.sala);
    END LOOP;

    -- ── 5 · Congelar el mes de las promociones de LABORATORIO ────────────────
    -- Va al final a propósito: los pasos 1-4 son del tipo producto y ninguno
    -- toca estas filas, así que el orden no cambia el resultado — pero un paso
    -- que escribe el cierre definitivo de un mes se lee mejor último.
    v_lab := public.promociones_cerrar_meses_de_laboratorio();

    -- Lo que queda en `cron.job_run_details.return_message`. Un cron que
    -- devuelve siempre lo mismo no deja ver si hizo algo.
    IF v_lote  > 0 THEN v_salida := v_salida || 'cerrados_por_lote='  || v_lote  || ' '; END IF;
    IF v_fecha > 0 THEN v_salida := v_salida || 'cerrados_por_fecha=' || v_fecha || ' '; END IF;
    IF v_final > 0 THEN v_salida := v_salida || 'finalizadas='        || v_final || ' '; END IF;
    IF v_avisos> 0 THEN v_salida := v_salida || 'avisos='             || v_avisos|| ' '; END IF;
    IF v_lab   > 0 THEN v_salida := v_salida || 'meses_cerrados='     || v_lab   || ' '; END IF;

    RETURN coalesce(nullif(btrim(v_salida), ''), 'sin novedades');
END;
$function$;
