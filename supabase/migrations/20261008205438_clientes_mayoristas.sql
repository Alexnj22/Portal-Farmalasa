SET lock_timeout = '5s';
-- Clientes Mayoristas (2026-10-08), según las Condiciones del Cliente
-- Mayorista y el Procedimiento de Clientes (docs/legal, vigentes 15-oct-2026):
--   · Nadie es mayorista por defecto: lo pide el cliente (app) o el
--     dependiente (portal) y lo decide Administración, que NO puede ser quien
--     lo pidió. Requisito: promedio ≥ $100/mes en 3 meses o una factura ≥ $500,
--     y ficha completa (nombre, documento, teléfono).
--   · Precios (Procedimiento §1): Mayoreo = columna `clinica`, Mayoreo Plus =
--     columna `mayoreo`; `premium` y `precio_7` no se usan. Una venta cuenta
--     como «a mayoreo» si su precio es uno de esos dos Y está por debajo del
--     Preferente (`vip`).
--   · Rangos (Condiciones §4): Jade desde el ingreso; Zafiro ≥ $300, Rubí ≥
--     $800, Diamante ≥ $2,000 de promedio en los 3 meses completos anteriores.
--   · Retiro o bajada rigen 15 días después del aviso (§6).
--   · Las fichas con «(4)»/«(5)» en el nombre entran ya aprobadas (§3).

CREATE TABLE IF NOT EXISTS public.clientes_mayoristas (
  customer_id bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  estado text NOT NULL CHECK (estado IN ('solicitado', 'aprobado', 'rechazado', 'retirado')),
  precio text NOT NULL DEFAULT 'mayoreo' CHECK (precio IN ('mayoreo', 'mayoreo_plus')),
  origen text NOT NULL CHECK (origen IN ('app', 'sala', 'portal')),
  solicitado_por uuid REFERENCES public.employees(id),
  solicitado_at timestamptz NOT NULL DEFAULT now(),
  nota_solicitud text,
  resuelto_por uuid REFERENCES public.employees(id),
  resuelto_at timestamptz,
  aprobado_desde date,
  retiro_programado date,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clientes_mayoristas_estado ON public.clientes_mayoristas (estado);

CREATE TABLE IF NOT EXISTS public.clientes_mayoristas_historial (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  accion text NOT NULL,
  estado text,
  precio text,
  origen text,
  nota text,
  por uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clientes_mayoristas_historial_cliente ON public.clientes_mayoristas_historial (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mayoristas_resumen_mensual (
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  mes date NOT NULL,
  total numeric(12,2) NOT NULL DEFAULT 0,
  a_mayoreo numeric(12,2) NOT NULL DEFAULT 0,
  a_plus numeric(12,2) NOT NULL DEFAULT 0,
  facturas integer NOT NULL DEFAULT 0,
  facturas_mayoreo integer NOT NULL DEFAULT 0,
  mayor_factura numeric(12,2) NOT NULL DEFAULT 0,
  costo numeric(12,2) NOT NULL DEFAULT 0,
  ultima_compra date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, mes)
);

ALTER TABLE public.clientes_mayoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_mayoristas_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mayoristas_resumen_mensual ENABLE ROW LEVEL SECURITY;
CREATE POLICY clientes_mayoristas_ver ON public.clientes_mayoristas FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('mayoristas', 'can_view')));
CREATE POLICY clientes_mayoristas_historial_ver ON public.clientes_mayoristas_historial FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('mayoristas', 'can_view')));
CREATE POLICY mayoristas_resumen_mensual_ver ON public.mayoristas_resumen_mensual FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('mayoristas', 'can_view')));

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve)
SELECT rp.role_id, 'mayoristas', rp.can_view, rp.can_view, rp.can_approve
  FROM public.role_permissions rp
 WHERE rp.module_key = 'clientes' AND rp.can_view
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = rp.role_id AND x.module_key = 'mayoristas');

CREATE OR REPLACE FUNCTION public.mayoristas_rehacer_resumen()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v integer; v_desde date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date - interval '6 months')::date;
BEGIN
  CREATE TEMP TABLE _r ON COMMIT DROP AS
  WITH it AS (
    SELECT si.customer_id, si.id AS inv, si.fecha, si.total AS total_factura, ii.total_linea,
           coalesce(ii.costo_unitario, 0) * coalesce(ii.cantidad, 0) AS costo_linea,
           CASE WHEN pp.mayoreo > 0 AND abs(ii.precio_unitario - pp.mayoreo) < 0.005
                      AND pp.mayoreo < coalesce(nullif(pp.vip, 0), pp.vineta) - 0.005 THEN 'plus'
                WHEN pp.clinica > 0 AND abs(ii.precio_unitario - pp.clinica) < 0.005
                      AND pp.clinica < coalesce(nullif(pp.vip, 0), pp.vineta) - 0.005 THEN 'mayoreo' END AS precio
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
      LEFT JOIN public.product_precios pp ON pp.product_id = ii.erp_product_id
           AND coalesce(pp.factor, 1) = coalesce(ii.factor_unidades, 1) AND pp.activo
     WHERE si.fecha >= v_desde AND si.customer_id IS NOT NULL AND public.venta_valida(si.estado)
  ), quienes AS (
    SELECT DISTINCT customer_id FROM it WHERE precio IS NOT NULL
    UNION SELECT customer_id FROM public.clientes_mayoristas
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
  UPDATE public.clientes_mayoristas SET estado = 'retirado', retiro_programado = NULL, updated_at = now()
   WHERE estado = 'aprobado' AND retiro_programado <= (now() AT TIME ZONE 'America/El_Salvador')::date;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.mayorista_rango(p_customer bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH m AS (
    SELECT coalesce(sum(r.total), 0) / 3.0 AS prom
      FROM public.mayoristas_resumen_mensual r
     WHERE r.customer_id = p_customer
       AND r.mes >= date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date - interval '3 months')::date
       AND r.mes <  date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date)::date
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.clientes_mayoristas WHERE customer_id = p_customer AND estado = 'aprobado') THEN NULL
              WHEN m.prom >= 2000 THEN 'diamante' WHEN m.prom >= 800 THEN 'rubi' WHEN m.prom >= 300 THEN 'zafiro'
              ELSE 'jade' END
    FROM m;
$$;

CREATE OR REPLACE FUNCTION public.mayoristas_listado()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
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
      'precio_sugerido', CASE WHEN coalesce(r.a_plus, 0) > coalesce(r.a_mayoreo, 0) THEN 'mayoreo_plus' ELSE 'mayoreo' END,
      'estado', m.estado, 'precio', m.precio, 'origen', m.origen, 'solicitado_at', m.solicitado_at, 'resuelto_at', m.resuelto_at,
      'nota_solicitud', m.nota_solicitud, 'solicitado_por', se.name, 'solicitado_por_id', m.solicitado_por,
      'retiro_programado', m.retiro_programado, 'motivo', m.motivo,
      'rango', CASE WHEN m.estado = 'aprobado' THEN public.mayorista_rango(c.id) END)
      ORDER BY (m.estado = 'solicitado') DESC NULLS LAST, coalesce(r.a_mayoreo, 0) + coalesce(r.a_plus, 0) DESC), '[]'::json)
      FROM public.customers c
      LEFT JOIN r ON r.customer_id = c.id
      LEFT JOIN public.clientes_mayoristas m ON m.customer_id = c.id
      LEFT JOIN public.employees se ON se.id = m.solicitado_por
     WHERE r.customer_id IS NOT NULL OR m.customer_id IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.mayorista_detalle(p_customer bigint)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
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
    'historial', (SELECT coalesce(json_agg(json_build_object('accion', h.accion, 'estado', h.estado, 'precio', h.precio, 'origen', h.origen,
                      'nota', h.nota, 'por', e.name, 'cuando', h.created_at) ORDER BY h.created_at DESC), '[]'::json)
                    FROM public.clientes_mayoristas_historial h LEFT JOIN public.employees e ON e.id = h.por
                   WHERE h.customer_id = p_customer),
    'rango', public.mayorista_rango(p_customer));
END $$;

CREATE OR REPLACE FUNCTION public.mayorista_proponer(p_customer bigint, p_precio text, p_nota text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_emp uuid := public.auth_employee_id(); v_actual text;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('mayoristas', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_precio NOT IN ('mayoreo', 'mayoreo_plus') THEN RAISE EXCEPTION 'Elige el precio'; END IF;
  SELECT estado INTO v_actual FROM public.clientes_mayoristas WHERE customer_id = p_customer;
  IF v_actual IN ('solicitado', 'aprobado') THEN RAISE EXCEPTION 'Ese cliente ya está %', CASE v_actual WHEN 'aprobado' THEN 'aprobado' ELSE 'en revisión' END; END IF;
  INSERT INTO public.clientes_mayoristas (customer_id, estado, precio, origen, solicitado_por, solicitado_at, nota_solicitud, resuelto_por, resuelto_at, motivo, updated_at)
  VALUES (p_customer, 'solicitado', p_precio, 'sala', v_emp, now(), nullif(btrim(coalesce(p_nota, '')), ''), NULL, NULL, NULL, now())
  ON CONFLICT (customer_id) DO UPDATE SET estado = 'solicitado', precio = EXCLUDED.precio, origen = 'sala', solicitado_por = v_emp,
     solicitado_at = now(), nota_solicitud = EXCLUDED.nota_solicitud, resuelto_por = NULL, resuelto_at = NULL, motivo = NULL, updated_at = now();
  INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota, por)
  VALUES (p_customer, 'propuesto', 'solicitado', p_precio, 'sala', nullif(btrim(coalesce(p_nota, '')), ''), v_emp);
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.mayorista_solicitar_app(p_customer bigint, p_nota text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_actual text;
BEGIN
  SELECT estado INTO v_actual FROM public.clientes_mayoristas WHERE customer_id = p_customer;
  IF v_actual = 'aprobado' THEN RETURN json_build_object('ok', false, 'mensaje', 'Ya eres Cliente Mayorista.'); END IF;
  IF v_actual = 'solicitado' THEN RETURN json_build_object('ok', false, 'mensaje', 'Tu solicitud ya está en revisión.'); END IF;
  INSERT INTO public.clientes_mayoristas (customer_id, estado, precio, origen, solicitado_at, nota_solicitud, updated_at)
  VALUES (p_customer, 'solicitado', 'mayoreo', 'app', now(), nullif(left(btrim(coalesce(p_nota, '')), 300), ''), now())
  ON CONFLICT (customer_id) DO UPDATE SET estado = 'solicitado', origen = 'app', solicitado_por = NULL, solicitado_at = now(),
     nota_solicitud = EXCLUDED.nota_solicitud, resuelto_por = NULL, resuelto_at = NULL, motivo = NULL, updated_at = now();
  INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, origen, nota)
  VALUES (p_customer, 'solicitado', 'solicitado', 'app', nullif(left(btrim(coalesce(p_nota, '')), 300), ''));
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.mayorista_resolver(p_customer bigint, p_accion text, p_precio text, p_nota text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_emp uuid := public.auth_employee_id(); v_estado text; v_actual public.clientes_mayoristas;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('mayoristas', 'can_approve')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  v_estado := CASE p_accion WHEN 'aprobar' THEN 'aprobado' WHEN 'rechazar' THEN 'rechazado' WHEN 'retirar' THEN 'aprobado' WHEN 'cambiar_precio' THEN 'aprobado' END;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'Acción no válida'; END IF;
  IF p_accion IN ('aprobar', 'cambiar_precio') AND p_precio NOT IN ('mayoreo', 'mayoreo_plus') THEN RAISE EXCEPTION 'Elige el precio'; END IF;
  IF p_accion IN ('rechazar', 'retirar') AND nullif(btrim(coalesce(p_nota, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribe el motivo'; END IF;
  SELECT * INTO v_actual FROM public.clientes_mayoristas WHERE customer_id = p_customer;
  IF p_accion IN ('aprobar', 'rechazar') AND (v_actual IS NULL OR v_actual.estado <> 'solicitado') THEN
    RAISE EXCEPTION 'Primero hay que solicitarlo: no hay una solicitud abierta';
  END IF;
  IF p_accion IN ('aprobar', 'rechazar') AND v_actual.solicitado_por = v_emp THEN
    RAISE EXCEPTION 'Quien aprueba no puede ser quien hizo la solicitud';
  END IF;
  IF p_accion = 'aprobar' AND NOT EXISTS (
       SELECT 1 FROM public.customers c WHERE c.id = p_customer AND btrim(coalesce(c.name, '')) <> ''
          AND coalesce(nullif(btrim(c.dui), ''), nullif(btrim(c.nit), '')) IS NOT NULL
          AND length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 8) THEN
    RAISE EXCEPTION 'La ficha no está completa: falta el documento o el teléfono';
  END IF;
  IF p_accion = 'retirar' THEN
    IF v_actual IS NULL OR v_actual.estado <> 'aprobado' THEN RAISE EXCEPTION 'Sólo a un mayorista aprobado'; END IF;
    UPDATE public.clientes_mayoristas SET retiro_programado = (now() AT TIME ZONE 'America/El_Salvador')::date + 15,
           resuelto_por = v_emp, resuelto_at = now(), motivo = btrim(p_nota), updated_at = now()
     WHERE customer_id = p_customer;
    INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota, por)
    VALUES (p_customer, 'retiro_avisado', 'aprobado', v_actual.precio, 'portal', btrim(p_nota) || ' · rige el ' || to_char((now() AT TIME ZONE 'America/El_Salvador')::date + 15, 'DD/MM/YYYY'), v_emp);
    RETURN json_build_object('ok', true, 'estado', 'aprobado', 'retiro_programado', (now() AT TIME ZONE 'America/El_Salvador')::date + 15);
  END IF;
  IF p_accion = 'cambiar_precio' AND (v_actual IS NULL OR v_actual.estado <> 'aprobado') THEN RAISE EXCEPTION 'Sólo a un mayorista aprobado'; END IF;
  INSERT INTO public.clientes_mayoristas (customer_id, estado, precio, origen, solicitado_por, solicitado_at, resuelto_por, resuelto_at, aprobado_desde, motivo, updated_at)
  VALUES (p_customer, v_estado, coalesce(p_precio, 'mayoreo'), 'portal', v_emp, now(), v_emp, now(),
          CASE WHEN v_estado = 'aprobado' THEN (now() AT TIME ZONE 'America/El_Salvador')::date END,
          nullif(btrim(coalesce(p_nota, '')), ''), now())
  ON CONFLICT (customer_id) DO UPDATE SET estado = v_estado,
     precio = CASE WHEN p_accion IN ('aprobar', 'cambiar_precio') THEN p_precio ELSE public.clientes_mayoristas.precio END,
     resuelto_por = v_emp, resuelto_at = now(),
     aprobado_desde = CASE WHEN p_accion = 'aprobar' THEN (now() AT TIME ZONE 'America/El_Salvador')::date ELSE public.clientes_mayoristas.aprobado_desde END,
     motivo = nullif(btrim(coalesce(p_nota, '')), ''), updated_at = now();
  INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota, por)
  VALUES (p_customer, CASE p_accion WHEN 'aprobar' THEN 'aprobado' WHEN 'rechazar' THEN 'rechazado' ELSE 'precio_cambiado' END,
          v_estado, p_precio, 'portal', nullif(btrim(coalesce(p_nota, '')), ''), v_emp);
  RETURN json_build_object('ok', true, 'estado', v_estado);
END $$;

CREATE OR REPLACE FUNCTION public.mayorista_de(p_customer bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT json_build_object('estado', m.estado, 'precio', m.precio, 'motivo', m.motivo, 'retiro_programado', m.retiro_programado,
    'rango', CASE WHEN m.estado = 'aprobado' THEN public.mayorista_rango(m.customer_id) END,
    'prom_3m', (SELECT round(coalesce(sum(total), 0) / 3.0, 2) FROM public.mayoristas_resumen_mensual r
                 WHERE r.customer_id = m.customer_id
                   AND r.mes >= date_trunc('month', current_date - interval '3 months')::date AND r.mes < date_trunc('month', current_date)::date))
    FROM public.clientes_mayoristas m WHERE m.customer_id = p_customer;
$$;

REVOKE EXECUTE ON FUNCTION public.mayoristas_rehacer_resumen() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mayorista_rango(bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mayoristas_listado() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mayorista_detalle(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mayorista_proponer(bigint, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mayorista_solicitar_app(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mayorista_resolver(bigint, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mayorista_de(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mayoristas_rehacer_resumen() TO service_role;
GRANT EXECUTE ON FUNCTION public.mayorista_rango(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.mayoristas_listado() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mayorista_detalle(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mayorista_proponer(bigint, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mayorista_solicitar_app(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mayorista_resolver(bigint, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mayorista_de(bigint) TO service_role;

WITH f AS (
  SELECT id, CASE WHEN name ~ '\(5\)' THEN 'mayoreo_plus' ELSE 'mayoreo' END AS precio FROM public.customers WHERE name ~ '\([45]\)'
), ins AS (
  INSERT INTO public.clientes_mayoristas (customer_id, estado, precio, origen, solicitado_at, resuelto_at, aprobado_desde, nota_solicitud)
  SELECT id, 'aprobado', precio, 'portal', now(), now(), (now() AT TIME ZONE 'America/El_Salvador')::date,
         'Ingreso por el Procedimiento de Clientes §3.4: precio escrito en el nombre de la ficha'
    FROM f ON CONFLICT (customer_id) DO NOTHING RETURNING customer_id, precio
)
INSERT INTO public.clientes_mayoristas_historial (customer_id, accion, estado, precio, origen, nota)
SELECT customer_id, 'aprobado', 'aprobado', precio, 'portal', 'Ingreso por el Procedimiento §3.4 (precio en el nombre de la ficha)' FROM ins;

SELECT cron.schedule('mayoristas-resumen-diario', '50 8 * * *', $c$SELECT public.mayoristas_rehacer_resumen()$c$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mayoristas-resumen-diario');
