-- Alcance por sala en lo que escribe, y el aviso de varias salas para la
-- jefatura (2026-11-10). Segunda parte de la auditoría pedida por el usuario.
--
-- 1. Cuatro funciones escribían con sólo el permiso de VER y sin mirar la sala.
--    Hoy sólo las alcanza un cargo con alcance de sala («Revisión de tienda»),
--    pero el permiso decía «de su sala» y la base no lo hacía cumplir:
--    - encuesta_cliente_guardar_lectura / _resumen: guardaban la lectura de la
--      encuesta de cualquier sala (o la de toda la red, p_branch NULL).
--    - inyeccion_vincular_cobro: vinculaba un cobro de cualquier sala.
--    - avisar_productos_sin_venta (modo muestra): mandaba a quien la pedía la
--      lista de productos parados de TODAS las salas. Sin alcance de red, sólo
--      la de la suya. El cron (sin sesión) no cambia.
-- 2. Puntos → Avisos: «Compró en 3 salas o más» lo ve también la jefatura de
--    cada sala nombrada (antes sólo admin, porque no tiene una sala sola).
--    Mismo criterio en la policy de `puntos_irregularidad`.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.encuesta_cliente_guardar_lectura(p_id uuid, p_branch integer, p_texto text, p_respuestas_n integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_prev public.encuesta_cliente_lecturas; v_n integer;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    -- Alcance (2026-11-10): sin ALL, sólo la lectura de su sala.
    IF (SELECT public.auth_module_scope('encuestas_clientes')) IS DISTINCT FROM 'ALL'
       AND p_branch IS DISTINCT FROM (SELECT public.auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF btrim(coalesce(p_texto, '')) = '' THEN RAISE EXCEPTION 'Lectura vacía'; END IF;
    v_n := public.encuesta_cliente_respuestas_n(p_id, p_branch);
    IF p_respuestas_n IS NULL OR p_respuestas_n < 1 OR p_respuestas_n > v_n THEN
        RAISE EXCEPTION 'La lectura no corresponde a las respuestas de la encuesta';
    END IF;
    SELECT * INTO v_prev FROM public.encuesta_cliente_lecturas
     WHERE encuesta_id = p_id AND branch_key = coalesce(p_branch, 0) FOR UPDATE;
    IF FOUND AND v_prev.respuestas_n > p_respuestas_n THEN
        RETURN json_build_object('guardado', false);
    END IF;
    INSERT INTO public.encuesta_cliente_lecturas (encuesta_id, branch_key, texto, respuestas_n, generado_por)
    VALUES (p_id, coalesce(p_branch, 0), left(p_texto, 8000), p_respuestas_n, public.auth_employee_id())
    ON CONFLICT (encuesta_id, branch_key) DO UPDATE
       SET texto = EXCLUDED.texto, respuestas_n = EXCLUDED.respuestas_n,
           generado_por = EXCLUDED.generado_por, created_at = now();
    RETURN json_build_object('guardado', true);
END $function$;

CREATE OR REPLACE FUNCTION public.encuesta_cliente_guardar_resumen(p_id uuid, p_branch integer, p_texto text, p_hasta timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_prev public.encuesta_cliente_resumenes;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    -- Alcance (2026-11-10): sin ALL, sólo el resumen de su sala.
    IF (SELECT public.auth_module_scope('encuestas_clientes')) IS DISTINCT FROM 'ALL'
       AND p_branch IS DISTINCT FROM (SELECT public.auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF btrim(coalesce(p_texto, '')) = '' THEN RAISE EXCEPTION 'Resumen vacío'; END IF;
    SELECT * INTO v_prev FROM public.encuesta_cliente_resumenes
     WHERE encuesta_id = p_id AND branch_key = coalesce(p_branch, 0) FOR UPDATE;
    IF FOUND AND v_prev.hasta >= p_hasta THEN
        RETURN json_build_object('guardado', false, 'texto', v_prev.texto);
    END IF;
    INSERT INTO public.encuesta_cliente_resumenes (encuesta_id, branch_key, texto, comentarios_n, hasta, generado_por)
    VALUES (p_id, coalesce(p_branch, 0), left(p_texto, 6000),
            public.encuesta_cliente_con_texto(p_id, p_branch, NULL), p_hasta, public.auth_employee_id())
    ON CONFLICT (encuesta_id, branch_key) DO UPDATE
       SET texto = EXCLUDED.texto, comentarios_n = EXCLUDED.comentarios_n, hasta = EXCLUDED.hasta,
           generado_por = EXCLUDED.generado_por, created_at = now();
    RETURN json_build_object('guardado', true);
END $function$;

CREATE OR REPLACE FUNCTION public.puntos_panel_avisos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json; v_todas boolean; v_sala integer; v_sala_nombre text;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los avisos de puntos.' USING ERRCODE = '42501';
  END IF;
  -- Alcance (2026-11-10): ALL ve todas las salas; la jefatura (BRANCH), sólo
  -- la suya. Un aviso sin sala no se le muestra a quien no ve todas.
  v_todas := public.auth_module_scope('puntos_tab_avisos') = 'ALL';
  v_sala  := public.auth_employee_branch_id();
  v_sala_nombre := (SELECT name FROM public.branches WHERE id = v_sala);

  -- Quién vendió y cómo quedó la venta (2026-10-01): se agrega UNA vez sobre
  -- la unión, desde la factura del aviso. El vendedor sale de
  -- `cod_vendedor` → `employees.code` (único, medido: 0 duplicados).
  SELECT coalesce(json_agg(y ORDER BY y.cuando DESC), '[]'::json) INTO v FROM (
  SELECT x.tipo, x.cuando, x.customer_id, x.cliente, x.sala, x.documento, x.invoice_id,
         x.puntos, x.faltaron,
         -- El canje sin saldo dice qué pasó y cuál es el error, con el MISMO
         -- texto de la notificación (2026-11-10).
         CASE WHEN x.tipo = 'canje_sin_saldo' AND x.pedidos IS NOT NULL
              THEN public.puntos_aviso_sin_saldo_texto(x.invoice_id, x.pedidos, x.tenia)->>'cuerpo'
              ELSE x.nota END AS nota,
         x.quien_id, x.quien, x.pedidos, x.tenia, x.descuento,
         ven.id AS vendedor_id, coalesce(ven.name, vs.cod_vendedor) AS vendedor,
         vs.fecha AS venta_fecha, vs.hora AS venta_hora, vs.total AS venta_total,
         vs.estado AS venta_estado, public.venta_valida(vs.estado) AS venta_vigente
    FROM (
    SELECT z.*,
           z.puntos + z.faltaron AS pedidos, z.puntos AS tenia,
           coalesce(z.monto, (z.puntos + z.faltaron) / 100.0) AS descuento
      FROM (
      SELECT 'canje_sin_saldo' AS tipo, s.created_at AS cuando, s.customer_id, c.name AS cliente,
             coalesce(b.name, s.sucursal) AS sala, si.correlativo AS documento, si.id AS invoice_id,
             s.puntos AS puntos,
             nullif(substring(s.motivo FROM 'faltaron ([0-9]+) puntos'), '')::int AS faltaron,
             NULL::text AS nota, NULL::uuid AS quien_id, NULL::text AS quien, b.id AS branch_id, s.monto
        FROM public.puntos_salida s
        JOIN public.customers c ON c.id = s.customer_id
        LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
        LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
       WHERE s.tipo = 'canje' AND s.invoice_id IS NOT NULL AND s.motivo LIKE '%faltaron%'
         AND s.created_at >= now() - interval '60 days'
      ) z
    UNION ALL
    SELECT 'anulada_con_puntos_gastados', g.created_at, g.customer_id, c.name,
           coalesce(b.name, g.sucursal), si.correlativo, si.id,
           g.no_recuperados, g.no_recuperados, NULL, NULL, NULL, b.id, NULL, NULL::int, NULL::int, NULL::numeric
      FROM public.puntos_anulacion_gastada g
      JOIN public.sales_invoices si ON si.id = g.invoice_id
      LEFT JOIN public.customers c ON c.id = g.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = g.sucursal
     WHERE g.created_at >= now() - interval '60 days'
    UNION ALL
    -- Regla del usuario (2026-09-28): un canje no puede dejar la venta en $0.00.
    SELECT 'canje_venta_en_cero', s.created_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int, NULL, NULL, NULL, b.id, NULL, NULL, NULL, NULL
      FROM public.puntos_salida s
      JOIN public.sales_invoices si ON si.id = s.invoice_id
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL AND si.total < public.puntos_minimo_a_pagar(si.fecha)
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'canje_devuelto', s.revertida_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int, NULL, NULL, NULL, b.id, NULL, NULL, NULL, NULL
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at >= now() - interval '60 days'
    UNION ALL
    -- Movimientos fuera de lo normal (2026-10-01). Incluye el canje hecho con
    -- saldo 0, que no deja salida en el libro: «faltaron» y «tenia» viajan en
    -- `detalle`, y `puntos` es lo que aplicó la caja.
    SELECT i.tipo, i.created_at, i.customer_id, c.name,
           coalesce(b.name, i.sucursal), si.correlativo, i.invoice_id,
           i.puntos, (i.detalle->>'faltaron')::int, i.nota, i.employee_id, e.name, b.id, NULL,
           CASE WHEN i.tipo = 'canje_sin_saldo' THEN i.puntos END,
           CASE WHEN i.tipo = 'canje_sin_saldo' THEN coalesce((i.detalle->>'tenia')::int, 0) END,
           CASE WHEN i.tipo = 'canje_sin_saldo' THEN i.puntos / 100.0 END
      FROM public.puntos_irregularidad i
      LEFT JOIN public.customers c ON c.id = i.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = i.invoice_id
      -- Unos avisos guardan el código de la sala (FLS2) y otros su nombre
      -- (Salud 2: mismo vendedor, venta a sí mismo, acumulación alta).
      LEFT JOIN public.branches b ON b.codigo_puntos = i.sucursal OR b.name = i.sucursal
      LEFT JOIN public.employees e ON e.id = i.employee_id
     WHERE i.tipo <> 'anulada_gastada' AND i.created_at >= now() - interval '60 days'
  ) x
    LEFT JOIN public.sales_invoices vs ON vs.id = x.invoice_id
    LEFT JOIN public.employees ven ON ven.code = vs.cod_vendedor
   WHERE NOT (x.tipo = 'canje_sin_saldo' AND vs.id IS NOT NULL
              AND NOT public.venta_valida(vs.estado))
     AND (v_todas OR (v_sala IS NOT NULL AND coalesce(x.branch_id, vs.branch_id) = v_sala)
          -- «Compró en 3 salas o más» nombra varias salas (2026-11-10): lo ve
          -- la jefatura de cada una de ellas.
          OR (x.tipo = 'varias_salas' AND v_sala_nombre = ANY (string_to_array(x.sala, ', '))))
  ) y;
  RETURN v;
END;
$function$;


DROP POLICY IF EXISTS puntos_irregularidad_select ON public.puntos_irregularidad;
CREATE POLICY puntos_irregularidad_select ON public.puntos_irregularidad
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view'))
         AND ((SELECT public.auth_module_scope('puntos_tab_avisos')) = 'ALL'
              OR sucursal IN (SELECT x FROM public.branches b,
                                LATERAL (VALUES (b.codigo_puntos), (b.name)) v(x)
                               WHERE b.id = (SELECT public.auth_employee_branch_id()))
              OR (tipo = 'varias_salas'
                  AND (SELECT b.name FROM public.branches b WHERE b.id = (SELECT public.auth_employee_branch_id()))
                      = ANY (string_to_array(sucursal, ', ')))));

CREATE OR REPLACE FUNCTION public.inyeccion_vincular_cobro(p_cobro_id bigint, p_invoice_id bigint, p_linea_num integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp   uuid := (SELECT auth_employee_id());
  v_cobro record;
  v_venta record;
  v_reng  record;
  v_n     integer;
  i       integer;
BEGIN
  IF NOT (SELECT auth_has_module_permission('inyecciones_dosis', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT id, branch_id, monto, registrado_at, registrado_por, tipo_codigo, anulado_at INTO v_cobro
    FROM caja_movimientos_portal WHERE id = p_cobro_id;
  IF v_cobro.id IS NULL OR v_cobro.tipo_codigo <> 'APLICACION' OR v_cobro.anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese cobro no es una aplicación vigente.';
  END IF;
  -- Alcance (2026-11-10): sin ALL, sólo un cobro de su sala.
  IF (SELECT auth_module_scope('inyecciones_dosis')) IS DISTINCT FROM 'ALL'
     AND v_cobro.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM inyeccion_aplicaciones WHERE cobro_id = p_cobro_id) THEN
    RAISE EXCEPTION 'Ese cobro ya está asignado.';
  END IF;
  SELECT id, branch_id, customer_id, cliente INTO v_venta FROM sales_invoices
   WHERE id = p_invoice_id AND public.venta_valida(estado);
  IF v_venta.id IS NULL OR v_venta.branch_id <> v_cobro.branch_id THEN
    RAISE EXCEPTION 'La venta no existe, está anulada o es de otra sala.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('inyeccion_venta'), p_invoice_id::int);
  SELECT * INTO v_reng FROM public.inyeccion_renglones_de_venta(ARRAY[p_invoice_id]) WHERE linea_num = p_linea_num;
  IF v_reng.linea_num IS NULL THEN RAISE EXCEPTION 'Ese renglón no es una inyección.'; END IF;
  v_n := greatest(round(v_cobro.monto / nullif((SELECT precio FROM inyeccion_precios WHERE origen = 'COMPRADA'), 0))::int, 1);
  IF v_n > v_reng.disponibles THEN
    RAISE EXCEPTION 'El cobro equivale a % aplicaciones y a ese renglón le quedan %.', v_n, v_reng.disponibles;
  END IF;
  FOR i IN 1..v_n LOOP
    INSERT INTO inyeccion_aplicaciones (branch_id, origen, invoice_id, linea_num, customer_id, cliente, producto,
                                        precio, cobro_id, confirmada, aplicada_at, aplicada_por, aplicada_branch_id,
                                        creada_por, vinculada_por)
    VALUES (v_cobro.branch_id, 'COMPRADA', p_invoice_id, p_linea_num, v_venta.customer_id, v_venta.cliente,
            v_reng.descripcion, round(v_cobro.monto / v_n, 2), p_cobro_id, true,
            v_cobro.registrado_at, coalesce(v_cobro.registrado_por, v_emp), v_cobro.branch_id, v_emp, v_emp);
  END LOOP;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_productos_sin_venta(p_muestra_a uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_salas  constant jsonb := '[{"erp":5,"branch":2,"sala":"La Popular"},{"erp":1,"branch":4,"sala":"Salud 1"},
                                 {"erp":2,"branch":25,"sala":"Salud 2"},{"erp":3,"branch":27,"sala":"Salud 3"},
                                 {"erp":4,"branch":28,"sala":"Salud 4"},{"erp":7,"branch":29,"sala":"Salud 5"}]';
    v_nombre constant jsonb := '{"1":"Salud 1","2":"Salud 2","3":"Salud 3","4":"Salud 4","5":"La Popular","6":"Bodega","7":"Salud 5"}';
    s        jsonb;
    v_erp    integer;
    v_lista  jsonb;
    v_nuevos jsonb;
    v_dest   uuid[];
    v_meta   jsonb;
    v_n      integer;
    v_costo  numeric;
    v_total  integer := 0;
    v_solo   integer;
BEGIN
    -- Sólo el cron (sin sesión) o quien pide una muestra para sí mismo con
    -- permiso de ver Gestión de stock.
    IF coalesce(current_setting('request.jwt.claims', true), '') <> ''
       AND (SELECT auth.role()) <> 'service_role'
       AND NOT (p_muestra_a IS NOT NULL
                AND p_muestra_a = public.auth_employee_id()
                AND coalesce(public.auth_has_module_permission('gestion_stock', 'can_view'), false)) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    -- Alcance (2026-11-10): la muestra de quien no ve toda la red trae sólo su
    -- sala. El cron (p_muestra_a NULL) recorre todas, como siempre.
    IF p_muestra_a IS NOT NULL AND coalesce(public.auth_module_scope('gestion_stock'), '') <> 'ALL' THEN
        v_solo := coalesce(public.auth_employee_branch_id(), -1);
    END IF;

    FOR s IN SELECT * FROM jsonb_array_elements(v_salas) LOOP
        CONTINUE WHEN v_solo IS NOT NULL AND (s->>'branch')::int <> v_solo;
        v_erp   := (s->>'erp')::int;
        v_lista := public.productos_parados_de_sala(v_erp)::jsonb;

        IF p_muestra_a IS NULL THEN
            -- Lo que dejó de estar parado vuelve a poder avisarse.
            DELETE FROM public.productos_sin_venta_avisados a
             WHERE a.erp_sucursal_id = v_erp
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lista) e
                                WHERE (e->>'erp_product_id')::int = a.erp_product_id);
            SELECT coalesce(jsonb_agg(e), '[]'::jsonb) INTO v_nuevos
              FROM jsonb_array_elements(v_lista) e
             WHERE NOT EXISTS (SELECT 1 FROM public.productos_sin_venta_avisados a
                                WHERE a.erp_sucursal_id = v_erp
                                  AND a.erp_product_id = (e->>'erp_product_id')::int);
        ELSE
            v_nuevos := v_lista;
        END IF;

        CONTINUE WHEN jsonb_array_length(v_nuevos) = 0;

        IF p_muestra_a IS NOT NULL THEN
            v_dest := ARRAY[p_muestra_a];
        ELSE
            SELECT array_agg(e.id) INTO v_dest
              FROM public.employees e JOIN public.roles r ON r.id = coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id)
             WHERE coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = (s->>'branch')::int AND e.status = 'ACTIVO' AND r.name = 'Jefe/a de Sala';
        END IF;
        CONTINUE WHEN v_dest IS NULL;

        v_n     := jsonb_array_length(v_nuevos);
        v_costo := (SELECT sum(coalesce((e->>'costo')::numeric, 0)) FROM jsonb_array_elements(v_nuevos) e);

        v_meta := jsonb_build_object('parados', jsonb_build_object(
            'sala', s->>'sala',
            'erp', v_erp,
            'productos', v_n,
            'costo', round(v_costo, 2),
            'en_la_lista', jsonb_array_length(v_lista),
            'muestra', p_muestra_a IS NOT NULL,
            'destinos', (SELECT jsonb_agg(jsonb_build_object(
                                        'erp', g.dest::int, 'sala', v_nombre->>g.dest,
                                        'productos', g.n, 'costo', g.c) ORDER BY g.n DESC, g.dest)
                           FROM (SELECT e->>'destino' AS dest, count(*) AS n,
                                        round(sum(coalesce((e->>'costo')::numeric, 0)), 2) AS c
                                   FROM jsonb_array_elements(v_nuevos) e
                                  GROUP BY 1) g),
            -- Los tres más caros: los que más vale la pena mover primero.
            'ejemplos', (SELECT jsonb_agg(jsonb_build_object(
                                    'producto', e->>'producto',
                                    'existencia', (e->>'existencia')::numeric,
                                    'costo', (e->>'costo')::numeric,
                                    'destino', v_nombre->>(e->>'destino'),
                                    'desde', e->>'desde',
                                    'dias', (e->>'dias')::int,
                                    'ultima_venta', e->>'ultima_venta',
                                    'ultima_entrada', e->>'ultima_entrada',
                                    'entrada_via', e->>'entrada_via',
                                    'reingreso', e->>'reingreso'))
                           FROM (SELECT e FROM jsonb_array_elements(v_nuevos) e
                                  ORDER BY coalesce((e->>'costo')::numeric, 0) DESC LIMIT 3) t)));

        v_total := v_total + public.notify_employees(
            v_dest,
            'PRODUCTOS_SIN_VENTA',
            'Productos sin venta · ' || (s->>'sala'),
            v_n || CASE WHEN v_n = 1 THEN ' producto lleva' ELSE ' productos llevan' END
                || ' 6 meses sin venderse · $' || to_char(v_costo, 'FM999,990.00'),
            '/gestion-stock?sala=' || v_erp,
            v_meta,
            true,
            (s->>'branch')::int);

        IF p_muestra_a IS NULL THEN
            INSERT INTO public.productos_sin_venta_avisados (erp_sucursal_id, erp_product_id)
            SELECT v_erp, (e->>'erp_product_id')::int FROM jsonb_array_elements(v_nuevos) e
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    RETURN v_total;
END;
$function$;
