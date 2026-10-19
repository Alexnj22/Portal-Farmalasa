SET lock_timeout = '5s';
-- Mayoreo (2026-10-19) · Aprobar a mano desde los candidatos, rechazar con
-- motivo, y bajar o retirar con los 15 días de las Condiciones §6.
--
-- Decisiones del dueño (2026-10-19):
--   · Candidatos: todo cliente al que se le vendió a precio de mayoreo en los
--     últimos 6 meses, más las fichas con «(4)»/«(5)» en el nombre. Se
--     aprueban o NO uno por uno, sin aprobación automática. «No aprobar» a un
--     candidato que no lo pidió es `descartar`: no se le avisa (no pidió nada).
--   · Aprueba cualquier cargo «admin» y quien tenga `can_approve` del módulo
--     `mayoristas`: a Gerente General (2) le faltaba. El aviso de solicitud
--     (`clientes_mayoristas_avisar_solicitud`) ya va a quien tiene
--     `can_approve`, así que con esta fila también le llega.
--   · Rechazo: con motivo (ya era obligatorio); el aviso al cliente lo manda
--     `avisos-clientes` leyendo el historial. Volver a pedirlo: permitido sin
--     espera (las Condiciones no ponen ninguna; §2.4 sólo pide comunicar el
--     motivo).
--   · Bajar de Mayoreo Plus a Mayoreo y retirar: rigen 15 días después de
--     avisar (§6). La bajada queda en `precio_programado`/`precio_programado_el`
--     y la aplica `mayoristas_rehacer_resumen` (cron diario), que ahora deja
--     fila en el historial —antes el retiro se aplicaba sin rastro—.
--   · Quién decidió se ve en el portal: el listado y el detalle devuelven el
--     `employees.id` para pintar foto + nombre corto.

UPDATE public.role_permissions SET can_approve = true
 WHERE role_id = 2 AND module_key = 'mayoristas' AND NOT can_approve;
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve)
SELECT 2, 'mayoristas', true, true, true
 WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = 2 AND module_key = 'mayoristas');

ALTER TABLE public.clientes_mayoristas DROP CONSTRAINT IF EXISTS clientes_mayoristas_estado_check;
ALTER TABLE public.clientes_mayoristas ADD CONSTRAINT clientes_mayoristas_estado_check
  CHECK (estado IN ('solicitado', 'aprobado', 'rechazado', 'retirado', 'descartado'));
ALTER TABLE public.clientes_mayoristas ADD COLUMN IF NOT EXISTS precio_programado text
  CHECK (precio_programado IN ('mayoreo', 'mayoreo_plus'));
ALTER TABLE public.clientes_mayoristas ADD COLUMN IF NOT EXISTS precio_programado_el date;

CREATE OR REPLACE FUNCTION public.mayorista_resolver(p_customer bigint, p_accion text, p_precio text, p_nota text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_actual public.clientes_mayoristas;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_rige date := (now() AT TIME ZONE 'America/El_Salvador')::date + 15;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('mayoristas', 'can_approve')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_accion NOT IN ('aprobar', 'rechazar', 'descartar', 'retirar', 'cambiar_precio', 'cancelar_cambio') THEN
    RAISE EXCEPTION 'Acción no válida';
  END IF;
  IF p_accion IN ('aprobar', 'cambiar_precio') AND coalesce(p_precio, '') NOT IN ('mayoreo', 'mayoreo_plus') THEN
    RAISE EXCEPTION 'Elige el precio';
  END IF;
  IF p_accion IN ('rechazar', 'retirar') AND v_nota IS NULL THEN RAISE EXCEPTION 'Escribe el motivo'; END IF;

  SELECT * INTO v_actual FROM public.clientes_mayoristas WHERE customer_id = p_customer FOR UPDATE;

  -- ── Aprobar: una solicitud abierta, o un candidato directamente (2026-10-19)
  IF p_accion = 'aprobar' THEN
    IF v_actual.estado = 'aprobado' THEN RAISE EXCEPTION 'Ya es Cliente Mayorista'; END IF;
    IF v_actual.estado = 'solicitado' AND v_actual.solicitado_por = v_emp THEN
      RAISE EXCEPTION 'Quien aprueba no puede ser quien hizo la solicitud';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM public.customers c WHERE c.id = p_customer AND btrim(coalesce(c.name, '')) <> ''
            AND coalesce(nullif(btrim(c.dui), ''), nullif(btrim(c.nit), '')) IS NOT NULL
            AND length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 8) THEN
      RAISE EXCEPTION 'La ficha no está completa: falta el documento o el teléfono';
    END IF;
    INSERT INTO public.clientes_mayoristas (customer_id, estado, precio, origen, solicitado_por, solicitado_at, resuelto_por, resuelto_at,
                                            aprobado_desde, motivo, retiro_programado, precio_programado, precio_programado_el, updated_at)
    VALUES (p_customer, 'aprobado', p_precio, 'portal', v_emp, now(), v_emp, now(), v_hoy, v_nota, NULL, NULL, NULL, now())
    ON CONFLICT (customer_id) DO UPDATE SET estado = 'aprobado', precio = p_precio,
       -- Si venía de una solicitud, se conserva quién y desde dónde la pidió.
       origen = CASE WHEN public.clientes_mayoristas.estado = 'solicitado' THEN public.clientes_mayoristas.origen ELSE 'portal' END,
       solicitado_por = CASE WHEN public.clientes_mayoristas.estado = 'solicitado' THEN public.clientes_mayoristas.solicitado_por ELSE v_emp END,
       solicitado_at = CASE WHEN public.clientes_mayoristas.estado = 'solicitado' THEN public.clientes_mayoristas.solicitado_at ELSE now() END,
       resuelto_por = v_emp, resuelto_at = now(), aprobado_desde = v_hoy, motivo = v_nota,
       retiro_programado = NULL, precio_programado = NULL, precio_programado_el = NULL, updated_at = now();
    INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota, por)
    VALUES (p_customer, 'aprobado', 'aprobado', p_precio, 'portal',
            coalesce(v_nota, CASE WHEN v_actual.estado = 'solicitado' THEN NULL ELSE 'Desde la lista de candidatos' END), v_emp);
    RETURN json_build_object('ok', true, 'estado', 'aprobado');
  END IF;

  -- ── Rechazar: sólo una solicitud abierta, y con motivo (se le avisa al cliente)
  IF p_accion = 'rechazar' THEN
    IF v_actual IS NULL OR v_actual.estado <> 'solicitado' THEN
      RAISE EXCEPTION 'No hay una solicitud abierta: a un candidato se le dice «No aprobar»';
    END IF;
    IF v_actual.solicitado_por = v_emp THEN RAISE EXCEPTION 'Quien aprueba no puede ser quien hizo la solicitud'; END IF;
    UPDATE public.clientes_mayoristas SET estado = 'rechazado', resuelto_por = v_emp, resuelto_at = now(), motivo = v_nota, updated_at = now()
     WHERE customer_id = p_customer;
    INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota, por)
    VALUES (p_customer, 'rechazado', 'rechazado', v_actual.precio, 'portal', v_nota, v_emp);
    RETURN json_build_object('ok', true, 'estado', 'rechazado');
  END IF;

  -- ── No aprobar a un candidato que no lo pidió: sin aviso al cliente
  IF p_accion = 'descartar' THEN
    IF v_actual.estado IN ('solicitado', 'aprobado') THEN
      RAISE EXCEPTION 'Ese cliente está %', CASE v_actual.estado WHEN 'aprobado' THEN 'aprobado: se retira' ELSE 'en revisión: se rechaza' END;
    END IF;
    INSERT INTO public.clientes_mayoristas (customer_id, estado, precio, origen, solicitado_por, solicitado_at, resuelto_por, resuelto_at, motivo, updated_at)
    VALUES (p_customer, 'descartado', 'mayoreo', 'portal', v_emp, now(), v_emp, now(), v_nota, now())
    ON CONFLICT (customer_id) DO UPDATE SET estado = 'descartado', resuelto_por = v_emp, resuelto_at = now(), motivo = v_nota, updated_at = now();
    INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, origen, nota, por)
    VALUES (p_customer, 'descartado', 'descartado', 'portal', v_nota, v_emp);
    RETURN json_build_object('ok', true, 'estado', 'descartado');
  END IF;

  IF v_actual IS NULL OR v_actual.estado <> 'aprobado' THEN RAISE EXCEPTION 'Sólo a un mayorista aprobado'; END IF;

  -- ── Retirar: rige a los 15 días (§6); lo aplica el cron y deja historial
  IF p_accion = 'retirar' THEN
    UPDATE public.clientes_mayoristas SET retiro_programado = v_rige, precio_programado = NULL, precio_programado_el = NULL,
           resuelto_por = v_emp, resuelto_at = now(), motivo = v_nota, updated_at = now()
     WHERE customer_id = p_customer;
    INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota, por)
    VALUES (p_customer, 'retiro_avisado', 'aprobado', v_actual.precio, 'portal', v_nota || ' · rige el ' || to_char(v_rige, 'DD/MM/YYYY'), v_emp);
    RETURN json_build_object('ok', true, 'estado', 'aprobado', 'retiro_programado', v_rige);
  END IF;

  -- ── Deshacer un retiro o una bajada que todavía no rige
  IF p_accion = 'cancelar_cambio' THEN
    IF v_actual.retiro_programado IS NULL AND v_actual.precio_programado IS NULL THEN
      RAISE EXCEPTION 'No hay ningún cambio por aplicar';
    END IF;
    UPDATE public.clientes_mayoristas SET retiro_programado = NULL, precio_programado = NULL, precio_programado_el = NULL,
           resuelto_por = v_emp, resuelto_at = now(), updated_at = now()
     WHERE customer_id = p_customer;
    INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota, por)
    VALUES (p_customer, 'cambio_cancelado', 'aprobado', v_actual.precio, 'portal', v_nota, v_emp);
    RETURN json_build_object('ok', true, 'estado', 'aprobado');
  END IF;

  -- ── Cambiar el precio: subir rige desde que se comunica; bajar, a los 15 días
  IF p_precio = v_actual.precio AND v_actual.precio_programado IS NULL THEN RAISE EXCEPTION 'Ya tiene ese precio'; END IF;
  IF p_precio = 'mayoreo' AND v_actual.precio = 'mayoreo_plus' THEN
    IF v_nota IS NULL THEN RAISE EXCEPTION 'Escribe el motivo: se le avisa al cliente'; END IF;
    UPDATE public.clientes_mayoristas SET precio_programado = 'mayoreo', precio_programado_el = v_rige,
           resuelto_por = v_emp, resuelto_at = now(), motivo = v_nota, updated_at = now()
     WHERE customer_id = p_customer;
    INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota, por)
    VALUES (p_customer, 'baja_avisada', 'aprobado', 'mayoreo', 'portal', v_nota || ' · rige el ' || to_char(v_rige, 'DD/MM/YYYY'), v_emp);
    RETURN json_build_object('ok', true, 'estado', 'aprobado', 'precio_programado_el', v_rige);
  END IF;
  UPDATE public.clientes_mayoristas SET precio = p_precio, precio_programado = NULL, precio_programado_el = NULL,
         resuelto_por = v_emp, resuelto_at = now(), motivo = v_nota, updated_at = now()
   WHERE customer_id = p_customer;
  INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota, por)
  VALUES (p_customer, 'precio_cambiado', 'aprobado', p_precio, 'portal', v_nota, v_emp);
  RETURN json_build_object('ok', true, 'estado', 'aprobado');
END $function$;

-- El cron diario aplica lo que ya rige y lo anota (antes el retiro no dejaba
-- fila: el historial decía «retiro avisado» y nunca «retirado»).
CREATE OR REPLACE FUNCTION public.mayoristas_rehacer_resumen()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v integer; v_desde date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date - interval '6 months')::date;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  CREATE TEMP TABLE _r ON COMMIT DROP AS
  WITH it AS (
    -- Un renglón = una fila. product_precios tiene VARIAS presentaciones activas
    -- con el mismo (producto, factor) —1,615 combinaciones el 2026-10-12— y el
    -- join sin agrupar duplicaba el renglón: los totales salían 44% inflados
    -- ($963,872 guardados contra $669,146 reales en los 6 meses).
    SELECT si.customer_id, si.id AS inv, si.fecha, max(si.total) AS total_factura,
           max(ii.total_linea) AS total_linea,
           max(coalesce(ii.costo_unitario, 0) * coalesce(ii.cantidad, 0)) AS costo_linea,
           CASE WHEN bool_or(pp.mayoreo > 0 AND abs(ii.precio_unitario - pp.mayoreo) < 0.005
                             AND pp.mayoreo < coalesce(nullif(pp.vip, 0), pp.vineta) - 0.005) THEN 'plus'
                WHEN bool_or(pp.clinica > 0 AND abs(ii.precio_unitario - pp.clinica) < 0.005
                             AND pp.clinica < coalesce(nullif(pp.vip, 0), pp.vineta) - 0.005) THEN 'mayoreo' END AS precio
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
      LEFT JOIN public.product_precios pp ON pp.product_id = ii.erp_product_id
           AND coalesce(pp.factor, 1) = coalesce(ii.factor_unidades, 1) AND pp.activo
     WHERE si.fecha >= v_desde AND si.customer_id IS NOT NULL AND public.venta_valida(si.estado)
     GROUP BY ii.id, si.customer_id, si.id, si.fecha
  ), quienes AS (
    SELECT DISTINCT customer_id FROM it WHERE precio IS NOT NULL
    UNION SELECT customer_id FROM public.clientes_mayoristas
    -- Las fichas con «(4)»/«(5)» en el nombre también son candidatas (2026-10-19).
    UNION SELECT id FROM public.customers WHERE name ~ '\([45]\)'
  )
  SELECT it.customer_id, date_trunc('month', it.fecha)::date AS mes,
         round(sum(it.total_linea), 2) AS total,
         round(coalesce(sum(it.total_linea) FILTER (WHERE it.precio = 'mayoreo'), 0), 2) AS a_mayoreo,
         round(coalesce(sum(it.total_linea) FILTER (WHERE it.precio = 'plus'), 0), 2) AS a_plus,
         count(DISTINCT it.inv) AS facturas,
         count(DISTINCT it.inv) FILTER (WHERE it.precio IS NOT NULL) AS facturas_mayoreo,
         round(max(it.total_factura), 2) AS mayor_factura,
         round(sum(it.costo_linea), 2) AS costo,
         max(it.fecha) AS ultima_compra
    FROM it JOIN quienes q ON q.customer_id = it.customer_id
   GROUP BY 1, 2;
  DELETE FROM public.mayoristas_resumen_mensual WHERE mes >= v_desde OR mes < v_desde - interval '1 year';
  INSERT INTO public.mayoristas_resumen_mensual (customer_id, mes, total, a_mayoreo, a_plus, facturas, facturas_mayoreo, mayor_factura, costo, ultima_compra)
  SELECT * FROM _r;
  GET DIAGNOSTICS v = ROW_COUNT;

  -- Retiros que ya rigen (§6, 15 días después del aviso).
  WITH r AS (
    UPDATE public.clientes_mayoristas SET estado = 'retirado', retiro_programado = NULL,
           precio_programado = NULL, precio_programado_el = NULL, updated_at = now()
     WHERE estado = 'aprobado' AND retiro_programado <= v_hoy
    RETURNING customer_id, precio
  )
  INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota)
  SELECT customer_id, 'retirado', 'retirado', precio, 'portal', 'Rige el retiro avisado 15 días antes' FROM r;

  -- Bajadas de Mayoreo Plus a Mayoreo que ya rigen.
  WITH b AS (
    UPDATE public.clientes_mayoristas SET precio = precio_programado,
           precio_programado = NULL, precio_programado_el = NULL, updated_at = now()
     WHERE estado = 'aprobado' AND precio_programado IS NOT NULL AND precio_programado_el <= v_hoy
    RETURNING customer_id, precio
  )
  INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota)
  SELECT customer_id, 'precio_bajado', 'aprobado', precio, 'portal', 'Rige el cambio de precio avisado 15 días antes' FROM b;
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.mayoristas_listado()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('mayoristas', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH r AS (
      SELECT customer_id, sum(total) total, sum(a_mayoreo) a_mayoreo, sum(a_plus) a_plus, sum(facturas) facturas,
             sum(facturas_mayoreo) facturas_mayoreo, max(mayor_factura) mayor_factura, max(ultima_compra) ultima_compra,
             sum(total) FILTER (WHERE mes >= date_trunc('month', current_date - interval '3 months')::date
                                  AND mes < date_trunc('month', current_date)::date) / 3.0 AS prom_3m,
             sum(total) FILTER (WHERE mes < date_trunc('month', current_date)::date) / 6.0 AS prom_6m,
             sum(costo) AS costo,
             count(*) FILTER (WHERE facturas > 0 AND mes < date_trunc('month', current_date)::date) AS meses_con_compra
        FROM public.mayoristas_resumen_mensual
       WHERE mes >= date_trunc('month', current_date - interval '6 months')::date
       GROUP BY 1
    )
    SELECT coalesce(json_agg(json_build_object(
      'customer_id', c.id, 'nombre', c.name, 'documento', coalesce(c.dui, c.nit), 'telefono', c.phone, 'categoria', c.categoria,
      'total', round(coalesce(r.total, 0), 2), 'a_mayoreo', round(coalesce(r.a_mayoreo, 0) + coalesce(r.a_plus, 0), 2),
      'a_plus', round(coalesce(r.a_plus, 0), 2), 'facturas', coalesce(r.facturas, 0), 'facturas_mayoreo', coalesce(r.facturas_mayoreo, 0),
      'mayor_factura', coalesce(r.mayor_factura, 0), 'ultima_compra', r.ultima_compra,
      'margen', CASE WHEN coalesce(r.total, 0) > 0 THEN round((1 - r.costo / r.total) * 100, 1) END,
      'meses_con_compra', coalesce(r.meses_con_compra, 0),
      'primera_compra', (SELECT min(si.fecha) FROM public.sales_invoices si WHERE si.customer_id = c.id),
      'ficha_completa', btrim(coalesce(c.name, '')) <> '' AND coalesce(nullif(btrim(c.dui), ''), nullif(btrim(c.nit), '')) IS NOT NULL
                        AND length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 8,
      'prom_3m', round(coalesce(r.prom_3m, 0), 2), 'prom_6m', round(coalesce(r.prom_6m, 0), 2),
      'cumple', coalesce(r.prom_3m, 0) >= 100 OR coalesce(r.mayor_factura, 0) >= 500,
      'rango_sugerido', CASE WHEN coalesce(r.prom_3m, 0) >= 2000 THEN 'diamante' WHEN coalesce(r.prom_3m, 0) >= 800 THEN 'rubi'
                             WHEN coalesce(r.prom_3m, 0) >= 300 THEN 'zafiro' ELSE 'jade' END,
      -- «(5)» en el nombre = Mayoreo Plus; «(4)» = Mayoreo (Procedimiento §3.4).
      'precio_en_nombre', CASE WHEN c.name ~ '\(5\)' THEN 'mayoreo_plus' WHEN c.name ~ '\(4\)' THEN 'mayoreo' END,
      'precio_sugerido', CASE WHEN c.name ~ '\(5\)' THEN 'mayoreo_plus' WHEN c.name ~ '\(4\)' THEN 'mayoreo'
                              WHEN coalesce(r.a_plus, 0) > coalesce(r.a_mayoreo, 0) THEN 'mayoreo_plus' ELSE 'mayoreo' END,
      'estado', m.estado, 'precio', m.precio, 'origen', m.origen, 'solicitado_at', m.solicitado_at, 'resuelto_at', m.resuelto_at,
      'nota_solicitud', m.nota_solicitud, 'solicitado_por', se.name, 'solicitado_por_id', m.solicitado_por,
      'resuelto_por', re.name, 'resuelto_por_id', m.resuelto_por,
      'retiro_programado', m.retiro_programado, 'motivo', m.motivo,
      'precio_programado', m.precio_programado, 'precio_programado_el', m.precio_programado_el,
      'rango', CASE WHEN m.estado = 'aprobado' THEN public.mayorista_rango(c.id) END)
      ORDER BY (m.estado = 'solicitado') DESC NULLS LAST, coalesce(r.a_mayoreo, 0) + coalesce(r.a_plus, 0) DESC), '[]'::json)
      FROM public.customers c
      LEFT JOIN r ON r.customer_id = c.id
      LEFT JOIN public.clientes_mayoristas m ON m.customer_id = c.id
      LEFT JOIN public.employees se ON se.id = m.solicitado_por
      LEFT JOIN public.employees re ON re.id = m.resuelto_por
     WHERE r.customer_id IS NOT NULL OR m.customer_id IS NOT NULL OR c.name ~ '\([45]\)');
END $function$;

CREATE OR REPLACE FUNCTION public.mayorista_detalle(p_customer bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('mayoristas', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN json_build_object(
    'meses', (SELECT coalesce(json_agg(json_build_object('mes', mes, 'total', total, 'a_mayoreo', a_mayoreo + a_plus, 'a_plus', a_plus,
                      'facturas', facturas, 'facturas_mayoreo', facturas_mayoreo) ORDER BY mes), '[]'::json)
                FROM public.mayoristas_resumen_mensual WHERE customer_id = p_customer),
    'facturas', (SELECT coalesce(json_agg(f ORDER BY f.fecha DESC, f.id DESC), '[]'::json) FROM (
        SELECT si.id, si.fecha, si.correlativo, si.tipo_documento, round(si.total, 2) AS total, b.name AS sala
          FROM public.sales_invoices si LEFT JOIN public.branches b ON b.id = si.branch_id
         WHERE si.customer_id = p_customer AND public.venta_valida(si.estado)
           AND si.fecha >= current_date - 200
         ORDER BY si.fecha DESC, si.id DESC LIMIT 40) f),
    -- `por_id` (2026-10-19): para la foto de quién lo hizo.
    'historial', (SELECT coalesce(json_agg(json_build_object('accion', h.accion, 'estado', h.estado, 'precio', h.precio, 'origen', h.origen,
                      'nota', h.nota, 'por', e.name, 'por_id', h.por, 'cuando', h.created_at) ORDER BY h.created_at DESC), '[]'::json)
                    FROM public.clientes_mayoristas_historial h LEFT JOIN public.employees e ON e.id = h.por
                   WHERE h.customer_id = p_customer),
    'rango', public.mayorista_rango(p_customer));
END $function$;

-- La app: el motivo de un rechazo y la bajada de precio avisada (2026-10-19).
CREATE OR REPLACE FUNCTION public.mayorista_de(p_customer bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  -- «descartado» es una decisión interna sobre alguien que no pidió nada: para
  -- la app es como si no hubiera fila, y su nota no sale.
  SELECT json_build_object('estado', nullif(m.estado, 'descartado'),
    'precio', m.precio, 'motivo', CASE WHEN m.estado <> 'descartado' THEN m.motivo END, 'retiro_programado', m.retiro_programado,
    'aprobado_desde', m.aprobado_desde, 'resuelto_at', m.resuelto_at,
    'precio_programado', m.precio_programado, 'precio_programado_el', m.precio_programado_el,
    'rango', CASE WHEN m.estado = 'aprobado' THEN public.mayorista_rango(m.customer_id) END,
    'prom_3m', (SELECT round(coalesce(sum(total), 0) / 3.0, 2) FROM public.mayoristas_resumen_mensual r
                 WHERE r.customer_id = m.customer_id
                   AND r.mes >= date_trunc('month', current_date - interval '3 months')::date AND r.mes < date_trunc('month', current_date)::date))
    FROM public.clientes_mayoristas m WHERE m.customer_id = p_customer;
$function$;
