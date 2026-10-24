-- ═══════════════════════════════════════════════════════════════════════════
-- 20 · Condiciones del Cliente Mayorista v2 (vigentes el 15-nov-2026)
--
-- DEPENDE DE: la migración de la tanda PUNTOS que crea
--   `puntos_config.reglas_v2_desde` y `public.reglas_v2_desde()`, y de la 10
--   de esta tanda (`sumar_dias_habiles`).
--
-- DESDE CUÁNDO RIGE: todo lo nuevo pregunta `hoy SV >= reglas_v2_desde()`.
--   Antes de esa fecha cada función hace EXACTAMENTE lo de hoy: la rama vieja
--   es la definición viva de producción del 2026-10-24 (pg_get_functiondef),
--   letra por letra. Si `reglas_v2_desde()` diera NULL, rige lo viejo.
--
-- QUÉ CAMBIA (cláusulas de las Condiciones):
--   §4   Rangos: Jade al ingresar · Zafiro desde US$200 · Rubí desde US$500 ·
--        Diamante desde US$1,000 (antes 300/800/2000), sobre el promedio de
--        los 3 meses completos anteriores de COMPRAS ELEGIBLES (antes: todo).
--        Un solo juez: `mayorista_umbrales(dia)` + `mayorista_rango_de(prom, dia)`.
--   §5.5 Compra elegible = el renglón que acumula puntos (laboratorio que
--        acumula y producto fuera de `puntos_producto_no_acumula`: telefonía,
--        bebidas, helados, paletas) y que NO se vendió por debajo de su precio
--        asignado (Mayoreo / Mayoreo Plus, `precio_de_lista`, margen 2% como
--        `ventas_elegibles_puntos`). Nueva columna
--        `mayoristas_resumen_mensual.elegible`, la llena el cron diario.
--        LÍMITES (dichos en el informe): el precio asignado se compara con el
--        precio ACTUAL del catálogo y la condición ACTUAL del cliente, como ya
--        hace la clasificación mayoreo/plus de esta tabla; y «promociones
--        especiales» no tiene marca en los datos, así que no se puede excluir.
--   §2.3 Requisito para pedirlo (promedio ≥ US$100 en los 3 meses completos
--        anteriores, o una factura ≥ US$500 en los últimos 6): lo exige
--        `mayorista_solicitar_app` en el servidor (la app ya lo muestra).
--   §2.4 Persona jurídica: correo electrónico en la ficha para APROBAR.
--        No se toca ninguna ficha ni a quien ya está aprobado.
--   §2.4 Respuesta en 5 días hábiles: `mayoristas_vigilar_plazos` avisa a
--        quien aprueba un día antes y al vencer (una vez cada uno).
--   §2.5 Pérdida tras 6 meses sin compras: el cron programa el retiro para el
--        día en que se cumplen los 6 meses (mínimo 15 días después del aviso)
--        y deja `retiro_avisado` en el historial, que `avisos-clientes` ya
--        convierte en aviso al cliente (sin redeploy). Si vuelve a comprar
--        antes, se cancela solo. Marca: `clientes_mayoristas.retiro_por_inactividad`.
--   §6   Revisión trimestral (ene/abr/jul/oct): recordatorio a quien aprueba,
--        una vez por trimestre.
--
-- TABLAS: `mayoristas_resumen_mensual` (+1 columna), `clientes_mayoristas`
--   (+1 columna). Ninguna es caliente (las escribe el cron diario y el portal).
--   Lee `sales_invoices`/`sales_invoice_items` (caliente) SOLO en lectura.
--
-- VERIFICADO en staging (execute_sql, sin apply_migration): ver el informe de
--   la tanda MAYORISTA+DATOS — casos fabricados con reglas_v2_desde movida a
--   ayer y a mañana: rangos 250→jade/zafiro, 600→zafiro/rubi, 1500→rubi/diamante;
--   solicitud sin requisito rechazada sólo con la fecha vigente; jurídica sin
--   correo rechazada sólo con la fecha vigente; inactivo de 7 meses → retiro
--   programado a +15 y `retiro_avisado`; compra posterior → cancelado.
--   Medido el 2026-10-24 (staging bbfotmyuvmrtmbuqxmhf):
--     · cliente 71, un renglón pasado a «no acumula»: sep $975.76 total /
--       $798.70 elegible. Con la fecha en mañana: zafiro (prom 686.41, total);
--       en ayer: rubí (prom 627.39, elegible). Cliente 157 con un renglón
--       vendido bajo su precio de mayoreo: 508.41 → 443.33, zafiro en los dos.
--     · jurídica sin correo: v2 «La ficha no está completa: … correo»; con
--       correo aprueba; con la fecha en mañana aprueba sin correo (como hoy).
--     · solicitar desde la app sin compras: v1 ok; v2 ok:false 'requisito'
--       «… Tu promedio es de $0.00 al mes.»; cliente con $703/mes: ok.
--     · aprobado desde 01-mar sin compras: retiro_avisado para el 08-nov
--       (hoy+15); segunda corrida no duplica; aprobado_desde 20-oct →
--       cambio_cancelado «Volvió a comprar…»; con fecha en mañana no toca
--       nada; retiro_programado = hoy → `retirado`.
--     · vigilar_plazos: dos solicitudes de 6 y 9 días → dos avisos «se pasó el
--       plazo», la segunda corrida 0; revisión trimestral de oct una vez.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

ALTER TABLE public.mayoristas_resumen_mensual ADD COLUMN IF NOT EXISTS elegible numeric NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.mayoristas_resumen_mensual.elegible IS
  'Compras elegibles del mes (Condiciones v2 §4 y §5.5): lo que acumula puntos y no se vendió bajo el precio asignado. Rige el rango desde reglas_v2_desde().';

ALTER TABLE public.clientes_mayoristas ADD COLUMN IF NOT EXISTS retiro_por_inactividad boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.clientes_mayoristas.retiro_por_inactividad IS
  'El retiro_programado lo puso el cron por seis meses sin compras (Condiciones v2 §2.5): se cancela solo si vuelve a comprar.';

-- ── ¿Ya rigen las condiciones v2? Una sola pregunta para todas ──────────────
CREATE OR REPLACE FUNCTION public.mayorista_v2(p_dia date DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(coalesce(p_dia, (now() AT TIME ZONE 'America/El_Salvador')::date) >= public.reglas_v2_desde(), false);
$$;

-- ── Los umbrales del rango vigentes en un día ───────────────────────────────
CREATE OR REPLACE FUNCTION public.mayorista_umbrales(p_dia date DEFAULT NULL)
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT CASE WHEN public.mayorista_v2(p_dia)
    THEN json_build_object('version', 2, 'zafiro', 200, 'rubi', 500, 'diamante', 1000, 'elegibles', true,
                           'desde', public.reglas_v2_desde())
    ELSE json_build_object('version', 1, 'zafiro', 300, 'rubi', 800, 'diamante', 2000, 'elegibles', false,
                           'desde', public.reglas_v2_desde()) END;
$$;

CREATE OR REPLACE FUNCTION public.mayorista_rango_de(p_prom numeric, p_dia date DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT CASE WHEN public.mayorista_v2(p_dia) THEN
           CASE WHEN coalesce(p_prom, 0) >= 1000 THEN 'diamante' WHEN coalesce(p_prom, 0) >= 500 THEN 'rubi'
                WHEN coalesce(p_prom, 0) >= 200 THEN 'zafiro' ELSE 'jade' END
         ELSE
           CASE WHEN coalesce(p_prom, 0) >= 2000 THEN 'diamante' WHEN coalesce(p_prom, 0) >= 800 THEN 'rubi'
                WHEN coalesce(p_prom, 0) >= 300 THEN 'zafiro' ELSE 'jade' END END;
$$;

REVOKE EXECUTE ON FUNCTION public.mayorista_v2(date), public.mayorista_umbrales(date), public.mayorista_rango_de(numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mayorista_v2(date), public.mayorista_umbrales(date), public.mayorista_rango_de(numeric, date) TO authenticated, service_role;

-- ── mayorista_rango: desde la fecha, umbrales v2 sobre lo elegible ─────────
CREATE OR REPLACE FUNCTION public.mayorista_rango(p_customer bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH v AS (SELECT public.mayorista_v2() AS v2),
  m AS (
    SELECT coalesce(sum(CASE WHEN v.v2 THEN r.elegible ELSE r.total END), 0) / 3.0 AS prom
      FROM v LEFT JOIN public.mayoristas_resumen_mensual r
        ON r.customer_id = p_customer
       AND r.mes >= date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date - interval '3 months')::date
       AND r.mes <  date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date)::date
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.clientes_mayoristas WHERE customer_id = p_customer AND estado = 'aprobado') THEN NULL
              ELSE public.mayorista_rango_de(m.prom) END
    FROM m;
$function$;

-- ── El vigilante de plazos (§2.4 cinco días hábiles, §6 revisión trimestral)
CREATE OR REPLACE FUNCTION public.mayoristas_vigilar_plazos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dest uuid[];
  v_f record;
  v_n integer := 0;
  v_ins integer;
  v_clave text;
  v_aprobados integer;
BEGIN
  IF NOT public.mayorista_v2(v_hoy) THEN RETURN 0; END IF;

  -- Quien puede aprobar: la MISMA lista del aviso de solicitud nueva.
  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'mayoristas'
                 AND rp.can_approve AND rp.role_id IN (e.role_id, e.secondary_role_id));

  -- §2.4: «responde la solicitud en un máximo de cinco (5) días hábiles».
  FOR v_f IN
    SELECT m.customer_id, c.name, m.solicitado_at,
           public.sumar_dias_habiles((m.solicitado_at AT TIME ZONE 'America/El_Salvador')::date, 5) AS vence
      FROM public.clientes_mayoristas m JOIN public.customers c ON c.id = m.customer_id
     WHERE m.estado = 'solicitado' AND m.solicitado_at IS NOT NULL
  LOOP
    CONTINUE WHEN v_f.vence > v_hoy + 1;
    v_clave := 'mayorista-plazo:' || v_f.customer_id || ':' || extract(epoch FROM v_f.solicitado_at)::bigint || ':'
               || CASE WHEN v_f.vence < v_hoy THEN 'vencida' ELSE 'apremia' END;
    INSERT INTO public.avisos_emitidos (clave, recipient_id) VALUES (v_clave, NULL) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    CONTINUE WHEN v_ins = 0 OR v_dest IS NULL;
    v_n := v_n + public.notify_employees(v_dest, 'MAYORISTA_SOLICITUD',
      CASE WHEN v_f.vence < v_hoy THEN 'Se pasó el plazo de una solicitud de Cliente Mayorista'
           ELSE 'Una solicitud de Cliente Mayorista vence ' || CASE WHEN v_f.vence = v_hoy THEN 'hoy' ELSE 'mañana' END END,
      coalesce(v_f.name, 'Un cliente') || ' la pidió el ' || to_char((v_f.solicitado_at AT TIME ZONE 'America/El_Salvador')::date, 'DD/MM/YYYY')
        || '. Las condiciones dan cinco días hábiles para responder: vence el ' || to_char(v_f.vence, 'DD/MM/YYYY') || '.',
      '/mayoristas', jsonb_build_object('customer_id', v_f.customer_id, 'check_key', v_clave), true, NULL);
  END LOOP;

  -- §6: «cada trimestre —en enero, abril, julio y octubre— la Empresa revisa».
  IF extract(month FROM v_hoy) IN (1, 4, 7, 10) THEN
    v_clave := 'mayoristas-revision:' || to_char(v_hoy, 'YYYY-MM');
    INSERT INTO public.avisos_emitidos (clave, recipient_id) VALUES (v_clave, NULL) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins > 0 AND v_dest IS NOT NULL THEN
      SELECT count(*) INTO v_aprobados FROM public.clientes_mayoristas WHERE estado = 'aprobado';
      v_n := v_n + public.notify_employees(v_dest, 'MAYORISTA_REVISION', 'Revisión trimestral de Clientes Mayoristas',
        'Este mes toca revisar a los ' || v_aprobados || ' Clientes Mayoristas: mantener o cambiar su precio, o retirar a quien '
          || 'dejó de comprar con regularidad. Una bajada o un retiro rigen quince días después del aviso.',
        '/mayoristas', jsonb_build_object('check_key', v_clave), true, NULL);
    END IF;
  END IF;
  RETURN v_n;
END $function$;

REVOKE EXECUTE ON FUNCTION public.mayoristas_vigilar_plazos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mayoristas_vigilar_plazos() TO service_role;

-- ── El cron diario: + elegible, + pérdida a los 6 meses, + vigilante ───────
CREATE OR REPLACE FUNCTION public.mayoristas_rehacer_resumen()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
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
                             AND pp.clinica < coalesce(nullif(pp.vip, 0), pp.vineta) - 0.005) THEN 'mayoreo' END AS precio,
           -- Condiciones v2 §5.5 (2026-11-15): ¿el renglón cuenta para el rango?
           -- Acumula (la regla de `ventas_elegibles_puntos`: el laboratorio y la
           -- lista por producto) y NO se vendió bajo el precio asignado del
           -- cliente aprobado. Sin precio de lista para comparar, no se le
           -- acusa de estar por debajo.
           bool_or(coalesce(lab.acumula_puntos, true)
                   AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x WHERE x.product_id = ii.erp_product_id))
           AND NOT (max(cm.precio) IS NOT NULL
                    AND NOT coalesce(bool_or(public.precio_de_lista(cm.precio, pp.vineta, pp.vip, pp.clinica, pp.mayoreo) IS NULL
                                             OR ii.precio_unitario >= public.precio_de_lista(cm.precio, pp.vineta, pp.vip, pp.clinica, pp.mayoreo) * 0.98), true))
             AS elegible
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
      LEFT JOIN public.product_precios pp ON pp.product_id = ii.erp_product_id
           AND coalesce(pp.factor, 1) = coalesce(ii.factor_unidades, 1) AND pp.activo
      LEFT JOIN public.products prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios lab ON lab.id = prd.laboratorio_id
      LEFT JOIN public.clientes_mayoristas cm ON cm.customer_id = si.customer_id AND cm.estado = 'aprobado'
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
         max(it.fecha) AS ultima_compra,
         round(coalesce(sum(it.total_linea) FILTER (WHERE it.elegible), 0), 2) AS elegible
    FROM it JOIN quienes q ON q.customer_id = it.customer_id
   GROUP BY 1, 2;
  DELETE FROM public.mayoristas_resumen_mensual WHERE mes >= v_desde OR mes < v_desde - interval '1 year';
  INSERT INTO public.mayoristas_resumen_mensual (customer_id, mes, total, a_mayoreo, a_plus, facturas, facturas_mayoreo, mayor_factura, costo, ultima_compra, elegible)
  SELECT * FROM _r;
  GET DIAGNOSTICS v = ROW_COUNT;

  -- ── §2.5 (2026-11-15): seis meses sin compras ────────────────────────────
  -- Va ANTES de aplicar los retiros que rigen hoy, para que una compra de
  -- última hora cancele el suyo antes de que se aplique.
  IF public.mayorista_v2(v_hoy) THEN
    -- La última compra o, si nunca compró después, el día que lo aprobaron.
    CREATE TEMP TABLE _u ON COMMIT DROP AS
    SELECT m.customer_id, m.precio, m.retiro_programado, m.retiro_por_inactividad,
           greatest(m.aprobado_desde,
                    (SELECT max(si.fecha) FROM public.sales_invoices si
                      WHERE si.customer_id = m.customer_id AND public.venta_valida(si.estado))) AS ultima
      FROM public.clientes_mayoristas m
     WHERE m.estado = 'aprobado';

    -- Volvió a comprar: el retiro que puso el cron ya no corresponde.
    WITH c AS (
      UPDATE public.clientes_mayoristas m SET retiro_programado = NULL, retiro_por_inactividad = false, updated_at = now()
        FROM _u
       WHERE _u.customer_id = m.customer_id AND m.retiro_por_inactividad AND m.retiro_programado IS NOT NULL
         AND (_u.ultima + interval '6 months')::date - 15 > v_hoy
      RETURNING m.customer_id, m.precio
    )
    INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota)
    SELECT customer_id, 'cambio_cancelado', 'aprobado', precio, 'portal', 'Volvió a comprar: se mantiene como Cliente Mayorista' FROM c;

    -- Se cumplen (o están por cumplirse) seis meses: se avisa con al menos 15
    -- días, y rige el día de los seis meses. Un retiro ya programado a mano no
    -- se toca.
    WITH a AS (
      UPDATE public.clientes_mayoristas m
         SET retiro_programado = greatest((_u.ultima + interval '6 months')::date, v_hoy + 15),
             retiro_por_inactividad = true, precio_programado = NULL, precio_programado_el = NULL, updated_at = now()
        FROM _u
       WHERE _u.customer_id = m.customer_id AND m.retiro_programado IS NULL AND _u.ultima IS NOT NULL
         AND (_u.ultima + interval '6 months')::date - 15 <= v_hoy
      RETURNING m.customer_id, m.precio, m.retiro_programado, _u.ultima
    )
    INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota)
    SELECT customer_id, 'retiro_avisado', 'aprobado', precio, 'portal',
           'Seis meses sin compras (desde el ' || to_char(ultima, 'DD/MM/YYYY') || '). Si compras antes, se mantiene · rige el '
             || to_char(retiro_programado, 'DD/MM/YYYY')
      FROM a;
  END IF;

  -- Retiros que ya rigen (§6, 15 días después del aviso).
  WITH r AS (
    UPDATE public.clientes_mayoristas SET estado = 'retirado', retiro_programado = NULL, retiro_por_inactividad = false,
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

  -- Plazos de respuesta y revisión trimestral. Un fallo del aviso no puede
  -- tumbar el resumen: queda en la bitácora.
  BEGIN
    PERFORM public.mayoristas_vigilar_plazos();
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_logs (action, user_name, source, severity, details)
    VALUES ('MAYORISTAS_VIGILANTE_FALLO', 'Vigilante', 'SYSTEM', 'WARNING', jsonb_build_object('error', SQLERRM));
  END;
  RETURN v;
END $function$;

-- ── Listado del portal: rango sugerido, requisito, correo, plazo ───────────
CREATE OR REPLACE FUNCTION public.mayoristas_listado()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_v2 boolean := public.mayorista_v2();
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
             sum(elegible) FILTER (WHERE mes >= date_trunc('month', current_date - interval '3 months')::date
                                  AND mes < date_trunc('month', current_date)::date) / 3.0 AS prom_3m_elegible,
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
                        AND length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 8
                        -- §2.4 v2: la persona jurídica, además, con correo.
                        AND (NOT v_v2 OR c.tipo_persona IS DISTINCT FROM 'juridica'
                             OR coalesce(c.email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
      'tipo_persona', c.tipo_persona, 'correo', nullif(btrim(coalesce(c.email, '')), ''),
      'falta_correo', v_v2 AND c.tipo_persona = 'juridica' AND coalesce(c.email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$',
      'prom_3m', round(coalesce(r.prom_3m, 0), 2), 'prom_6m', round(coalesce(r.prom_6m, 0), 2),
      'prom_3m_elegible', round(coalesce(r.prom_3m_elegible, 0), 2),
      'cumple', coalesce(r.prom_3m, 0) >= 100 OR coalesce(r.mayor_factura, 0) >= 500,
      'rango_sugerido', public.mayorista_rango_de(CASE WHEN v_v2 THEN r.prom_3m_elegible ELSE r.prom_3m END),
      -- §2.4 v2: cinco días hábiles para responder una solicitud abierta.
      'vence_respuesta', CASE WHEN v_v2 AND m.estado = 'solicitado' AND m.solicitado_at IS NOT NULL
                              THEN public.sumar_dias_habiles((m.solicitado_at AT TIME ZONE 'America/El_Salvador')::date, 5) END,
      'retiro_por_inactividad', coalesce(m.retiro_por_inactividad, false),
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

-- ── Detalle: + elegible por mes y los umbrales vigentes ────────────────────
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
                      'facturas', facturas, 'facturas_mayoreo', facturas_mayoreo, 'elegible', elegible) ORDER BY mes), '[]'::json)
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
    'rango', public.mayorista_rango(p_customer),
    'umbrales', public.mayorista_umbrales());
END $function$;

-- ── Lo que ve la app: promedio elegible desde la fecha y los umbrales ──────
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
    -- Desde reglas_v2_desde(): el promedio de lo ELEGIBLE (Condiciones v2 §4).
    'prom_3m', (SELECT round(coalesce(sum(CASE WHEN public.mayorista_v2() THEN r.elegible ELSE r.total END), 0) / 3.0, 2)
                  FROM public.mayoristas_resumen_mensual r
                 WHERE r.customer_id = m.customer_id
                   AND r.mes >= date_trunc('month', current_date - interval '3 months')::date AND r.mes < date_trunc('month', current_date)::date),
    'umbrales', public.mayorista_umbrales())
    FROM public.clientes_mayoristas m WHERE m.customer_id = p_customer;
$function$;

-- ── §2.3 en el servidor ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mayorista_solicitar_app(p_customer bigint, p_nota text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_actual text;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_prom numeric; v_mayor numeric;
BEGIN
  SELECT estado INTO v_actual FROM public.clientes_mayoristas WHERE customer_id = p_customer;
  IF v_actual = 'aprobado' THEN RETURN json_build_object('ok', false, 'mensaje', 'Ya eres Cliente Mayorista.'); END IF;
  IF v_actual = 'solicitado' THEN RETURN json_build_object('ok', false, 'mensaje', 'Tu solicitud ya está en revisión.'); END IF;
  -- Condiciones v2 §2.3 (2026-11-15): un promedio de US$100.00 al mes en los
  -- tres meses completos anteriores, o una sola factura de US$500.00 o más (en
  -- los últimos seis meses, la misma ventana del listado del portal).
  IF public.mayorista_v2(v_hoy) THEN
    SELECT coalesce(sum(si.total) FILTER (WHERE si.fecha >= date_trunc('month', v_hoy - interval '3 months')::date
                                            AND si.fecha < date_trunc('month', v_hoy)::date), 0) / 3.0,
           coalesce(max(si.total), 0)
      INTO v_prom, v_mayor
      FROM public.sales_invoices si
     WHERE si.customer_id = p_customer AND public.venta_valida(si.estado)
       AND si.fecha >= date_trunc('month', v_hoy - interval '6 months')::date;
    IF v_prom < 100 AND v_mayor < 500 THEN
      RETURN json_build_object('ok', false, 'motivo', 'requisito',
        'mensaje', 'Para pedirlo necesitas haber comprado en promedio $100.00 al mes en los últimos tres meses, o una compra de $500.00 o más en una sola factura. Tu promedio es de $'
                   || to_char(round(v_prom, 2), 'FM999,990.00') || ' al mes.');
    END IF;
  END IF;
  INSERT INTO public.clientes_mayoristas (customer_id, estado, precio, origen, solicitado_at, nota_solicitud, updated_at)
  VALUES (p_customer, 'solicitado', 'mayoreo', 'app', now(), nullif(left(btrim(coalesce(p_nota, '')), 300), ''), now())
  ON CONFLICT (customer_id) DO UPDATE SET estado = 'solicitado', origen = 'app', solicitado_por = NULL, solicitado_at = now(),
     nota_solicitud = EXCLUDED.nota_solicitud, resuelto_por = NULL, resuelto_at = NULL, motivo = NULL, updated_at = now();
  INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, origen, nota)
  VALUES (p_customer, 'solicitado', 'solicitado', 'app', nullif(left(btrim(coalesce(p_nota, '')), 300), ''));
  RETURN json_build_object('ok', true);
END $function$;

-- ── Aprobar: §2.4 correo de la persona jurídica; retiro manual limpia la marca
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
    -- Condiciones v2 §2.4 (2026-11-15): la persona jurídica, con correo.
    IF public.mayorista_v2(v_hoy) AND EXISTS (
         SELECT 1 FROM public.customers c WHERE c.id = p_customer AND c.tipo_persona = 'juridica'
            AND coalesce(c.email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
      RAISE EXCEPTION 'La ficha no está completa: a una empresa o institución le falta el correo electrónico';
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
       retiro_programado = NULL, retiro_por_inactividad = false, precio_programado = NULL, precio_programado_el = NULL, updated_at = now();
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
    UPDATE public.clientes_mayoristas SET retiro_programado = v_rige, retiro_por_inactividad = false, precio_programado = NULL, precio_programado_el = NULL,
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
    -- Un retiro por seis meses sin compras (§2.5) no es una decisión de
    -- Administración: se cancela solo cuando el cliente vuelve a comprar.
    IF v_actual.retiro_por_inactividad AND public.mayorista_v2(v_hoy) THEN
      RAISE EXCEPTION 'Ese retiro es por seis meses sin compras: se cancela solo si el cliente vuelve a comprar antes';
    END IF;
    UPDATE public.clientes_mayoristas SET retiro_programado = NULL, retiro_por_inactividad = false, precio_programado = NULL, precio_programado_el = NULL,
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
