SET lock_timeout = '5s';

-- ═══ Puntos: la pestaña Consulta y un permiso por pestaña ═══════════════════
-- Pedido del usuario (2026-09-25): el panel de puntos sale de la ficha del
-- cliente y todo vive en la vista Puntos. «Resumen» pasa a «Consulta», con
-- gráficas y la lista de clientes debajo; cada pestaña con su permiso:
--   · Consulta y Cuentas por asignar: también para quien ya ve Clientes (la
--     caja consulta el saldo aquí antes de un canje)
--   · Avisos: sólo administración
-- Asignar una cuenta sigue siendo `puntos.can_edit` (Gerencia, Administración,
-- Supervisión de Ventas).

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, k.clave, true, false, false, 'ALL'
  FROM public.role_permissions rp
  CROSS JOIN (VALUES ('puntos'), ('puntos_tab_consulta'), ('puntos_tab_por_asignar')) k(clave)
 WHERE rp.module_key = 'clientes' AND rp.can_view
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true;

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, k.clave, true, false, false, 'ALL'
  FROM public.roles r
  CROSS JOIN (VALUES ('puntos_tab_consulta'), ('puntos_tab_por_asignar')) k(clave)
 WHERE r.name IN ('Gerente General', 'Administrador', 'Supervisor/a de Ventas', 'QA / Testing (CI)')
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true;

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'puntos_tab_avisos', true, false, false, 'ALL'
  FROM public.roles r
 WHERE r.name IN ('Gerente General', 'Administrador', 'QA / Testing (CI)')
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true;

-- Avisos: sólo con su pestaña.
CREATE OR REPLACE FUNCTION public.puntos_panel_avisos()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los avisos de puntos.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(json_agg(x ORDER BY x.cuando DESC), '[]'::json) INTO v FROM (
    SELECT 'canje_sin_saldo' AS tipo, s.created_at AS cuando, s.customer_id, c.name AS cliente,
           coalesce(b.name, s.sucursal) AS sala, si.correlativo AS documento, si.id AS invoice_id,
           s.puntos AS puntos,
           nullif(substring(s.motivo FROM 'faltaron ([0-9]+) puntos'), '')::int AS faltaron
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.invoice_id IS NOT NULL AND s.motivo LIKE '%faltaron%'
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'anulada_con_puntos_gastados', coalesce(pe.anulada_at, pe.created_at), si.customer_id, c.name,
           coalesce(b.name, pe.sucursal), si.correlativo, si.id,
           pe.puntos_no_recuperados, pe.puntos_no_recuperados
      FROM public.puntos_enviados pe
      JOIN public.sales_invoices si ON si.id = pe.invoice_id
      LEFT JOIN public.customers c ON c.id = si.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = pe.sucursal
     WHERE pe.reversion = 'PUNTOS_YA_DADOS'
       AND pe.fecha >= coalesce((SELECT inicio FROM public.puntos_config WHERE id), DATE '2026-10-01')
       AND coalesce(pe.anulada_at, pe.created_at) >= now() - interval '60 days'
  ) x;
  RETURN v;
END;
$$;

-- ── La serie diaria de las gráficas ────────────────────────────────────────
-- Acumulado y canjeado por día, de la misma fuente que el resumen: antes del
-- arranque, las ventas que el puente mandó con puntos y las ventas con canje;
-- desde el arranque, el libro.
CREATE OR REPLACE FUNCTION public.puntos_panel_serie(p_dias integer DEFAULT 30)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json; v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date; v_desde date;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  v_desde := v_hoy - (least(greatest(coalesce(p_dias, 30), 7), 120) - 1);

  IF public.puntos_fuente() <> 'portal' THEN
    SELECT coalesce(json_agg(json_build_object('fecha', d::date, 'acumulado', coalesce(a.pts, 0),
                                               'canjeado', coalesce(k.pts, 0)) ORDER BY d), '[]'::json)
      INTO v
      FROM generate_series(v_desde, v_hoy, interval '1 day') g(d)
      LEFT JOIN (SELECT fecha, sum(floor(total))::bigint pts FROM public.puntos_enviados
                  WHERE fecha >= v_desde AND estado_puntos IN ('pendiente', 'acumulado') GROUP BY 1) a
             ON a.fecha = g.d::date
      LEFT JOIN (SELECT si.fecha, sum(greatest(round(((SELECT coalesce(sum(ii.total_linea), 0) FROM public.sales_invoice_items ii
                                                       WHERE ii.invoice_id = si.id) - si.total - coalesce(si.retencion, 0)) * 100), 0))::bigint pts
                   FROM public.sales_invoices si
                   JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
                   LEFT JOIN public.customers cu ON cu.id = si.customer_id
                  WHERE si.fecha >= v_desde AND si.has_puntos AND si.estado = 'FINALIZADA'
                    AND coalesce(cu.acumula_puntos, true)
                  GROUP BY 1) k
             ON k.fecha = g.d::date;
  ELSE
    SELECT coalesce(json_agg(json_build_object('fecha', d::date, 'acumulado', coalesce(a.pts, 0),
                                               'canjeado', coalesce(k.pts, 0)) ORDER BY d), '[]'::json)
      INTO v
      FROM generate_series(v_desde, v_hoy, interval '1 day') g(d)
      LEFT JOIN (SELECT ganado_el fecha, sum(puntos)::bigint pts FROM public.puntos_lote
                  WHERE origen = 'venta' AND ganado_el >= v_desde GROUP BY 1) a
             ON a.fecha = g.d::date
      LEFT JOIN (SELECT (created_at AT TIME ZONE 'America/El_Salvador')::date fecha, sum(puntos)::bigint pts
                   FROM public.puntos_salida
                  WHERE tipo = 'canje' AND invoice_id IS NOT NULL
                    AND created_at >= (v_desde::timestamp AT TIME ZONE 'America/El_Salvador')
                  GROUP BY 1) k
             ON k.fecha = g.d::date;
  END IF;
  RETURN v;
END;
$$;

-- ── La lista de clientes con puntos ────────────────────────────────────────
-- Del libro (que desde la migración es el espejo del sistema anterior). Busca
-- por nombre, DUI o teléfono y pagina en el servidor: son ~10,600 cuentas.
CREATE OR REPLACE FUNCTION public.puntos_panel_clientes(
  p_busqueda text DEFAULT NULL, p_limite integer DEFAULT 25, p_desde integer DEFAULT 0
) RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json; v_q text; v_qd text; v_lim int := least(greatest(coalesce(p_limite, 25), 1), 100);
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  v_q := nullif(upper(unaccent(trim(coalesce(p_busqueda, '')))), '');
  v_qd := nullif(regexp_replace(coalesce(p_busqueda, ''), '\D', '', 'g'), '');

  WITH base AS (
    SELECT pc.customer_id, c.name AS nombre, c.dui, c.phone AS telefono,
           pc.saldo, pc.ganados AS acumulados, pc.usados AS canjeados,
           (SELECT max(ganado_el) FROM public.puntos_lote l WHERE l.customer_id = pc.customer_id) AS ultima_acumulacion
      FROM public.puntos_cuenta pc
      JOIN public.customers c ON c.id = pc.customer_id
     WHERE v_q IS NULL
        OR upper(unaccent(c.name)) LIKE '%' || v_q || '%'
        OR (length(v_qd) >= 4 AND (regexp_replace(coalesce(c.dui, ''), '\D', '', 'g') LIKE v_qd || '%'
                                   OR regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%' || v_qd || '%'))
  )
  SELECT json_build_object(
    'total', (SELECT count(*) FROM base),
    'filas', coalesce((SELECT json_agg(to_json(x)) FROM (
               SELECT * FROM base ORDER BY saldo DESC, customer_id
               LIMIT v_lim OFFSET greatest(coalesce(p_desde, 0), 0)) x), '[]'::json))
  INTO v;
  RETURN v;
END;
$$;

-- ── Todo de un cliente ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_panel_cliente(p_customer_id bigint)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  SELECT json_build_object(
    'cliente', (SELECT json_build_object('id', c.id, 'nombre', c.name, 'dui', c.dui, 'telefono', c.phone,
                                         'correo', c.email, 'acumula', coalesce(c.acumula_puntos, true))
                  FROM public.customers c WHERE c.id = p_customer_id),
    'cuenta', public.puntos_estado_cuenta(p_customer_id),
    'cuentas_anteriores', (
      SELECT coalesce(json_agg(json_build_object('id', a.id_cliente, 'como', a.asignada_como,
                                                 'cuando', a.asignada_at, 'nota', a.asignada_nota,
                                                 'saldo_alla', a.puntos) ORDER BY a.id_cliente), '[]'::json)
        FROM public.puntos_archivo_cliente a
        JOIN public.puntos_archivo_carga k ON k.id = a.carga_id AND k.completa
       WHERE a.asignada_a = p_customer_id)
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.puntos_panel_serie(integer), public.puntos_panel_clientes(text, integer, integer),
                           public.puntos_panel_cliente(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_panel_serie(integer), public.puntos_panel_clientes(text, integer, integer),
                           public.puntos_panel_cliente(bigint) TO authenticated, service_role;
