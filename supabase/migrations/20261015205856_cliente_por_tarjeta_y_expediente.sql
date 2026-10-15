SET lock_timeout = '5s';

-- Escanear la tarjeta del cliente (2026-10-15): `cliente_por_tarjeta` resuelve
-- lo que llegó del lector (código, URL del QR, DUI o teléfono) y devuelve los
-- candidatos; `cliente_expediente` arma todo lo de UNA ficha en un solo json.
-- Permiso: `puntos_tab_consulta`; créditos e inyecciones con el de su módulo.
-- SECURITY DEFINER (lee tablas de otros módulos) con el permiso adentro.
-- plpgsql: con `SET search_path` una función sql nace con plan genérico.

CREATE OR REPLACE FUNCTION public.cliente_por_tarjeta(p_entrada text)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_txt  text := left(trim(coalesce(p_entrada, '')), 300);
  v_cod  text;
  v_num  text;
  v_tel  text;
  v_modo text := 'nada';
  v_filas json := '[]'::json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar clientes.' USING ERRCODE = '42501';
  END IF;

  IF v_txt ~* '[?&]codigo=' THEN
    v_txt := coalesce(substring(v_txt from '(?i)[?&]codigo=([^&#[:space:]]*)'), '');
  END IF;

  v_cod := upper(regexp_replace(v_txt, '[^A-Za-z0-9]', '', 'g'));
  v_num := regexp_replace(v_txt, '\D', '', 'g');

  IF v_cod ~ '^[ACDEFGHJKMNPQRTUVWXY34679]{7}$' THEN
    v_modo := 'codigo';
    SELECT coalesce(json_agg(to_json(x)), '[]'::json) INTO v_filas FROM (
      SELECT c.id AS customer_id, c.name AS nombre, c.dui, c.phone AS telefono
        FROM public.puntos_codigo_acceso k
        JOIN public.customers c ON c.id = k.customer_id
       WHERE k.codigo = v_cod
    ) x;
  ELSIF v_cod ~ '^[0-9]+$' AND length(v_num) = 9 THEN
    v_modo := 'dui';
    SELECT coalesce(json_agg(to_json(x)), '[]'::json) INTO v_filas FROM (
      SELECT c.id AS customer_id, c.name AS nombre, c.dui, c.phone AS telefono
        FROM public.customers c
       WHERE regexp_replace(coalesce(c.dui, ''), '\D', '', 'g') = v_num
       ORDER BY c.name, c.id
       LIMIT 10
    ) x;
  ELSIF v_cod ~ '^[0-9]+$' AND length(v_num) BETWEEN 8 AND 11 THEN
    v_modo := 'telefono';
    v_tel := right(v_num, 8);
    SELECT coalesce(json_agg(to_json(x)), '[]'::json) INTO v_filas FROM (
      SELECT c.id AS customer_id, c.name AS nombre, c.dui, c.phone AS telefono
        FROM public.customers c
       WHERE right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = v_tel
          OR right(regexp_replace(coalesce(c.telefono2, ''), '\D', '', 'g'), 8) = v_tel
       ORDER BY c.name, c.id
       LIMIT 10
    ) x;
  END IF;

  RETURN json_build_object('modo', v_modo, 'clientes', v_filas);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_por_tarjeta(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_por_tarjeta(text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.cliente_expediente(p_customer_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ve_creditos boolean;
  v_ve_inyecciones boolean;
  v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar clientes.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RETURN NULL;
  END IF;

  v_ve_creditos := (SELECT public.auth_has_module_permission('cuentas_por_cobrar', 'can_view'));
  v_ve_inyecciones := (SELECT public.auth_has_module_permission('caja_vales', 'can_edit'))
                   OR (SELECT public.auth_has_module_permission('inyecciones_tab_pendientes', 'can_view'));

  SELECT json_build_object(
    'cliente', (
      SELECT json_build_object(
        'id', c.id, 'nombre', c.name, 'dui', c.dui, 'nit', c.nit,
        'telefono', c.phone, 'telefono2', c.telefono2, 'email', c.email,
        'categoria', c.categoria, 'fecha_nacimiento', c.fecha_nacimiento,
        'municipio', c.municipio, 'departamento', c.departamento,
        'acumula', coalesce(c.acumula_puntos, true),
        'acepta_programa', c.acepta_programa_puntos,
        'acepta_promociones', c.acepta_promociones)
        FROM public.customers c WHERE c.id = p_customer_id),

    'es_empleado', public.cliente_es_empleado(p_customer_id),

    'mayorista', (
      SELECT json_build_object('estado', m.estado, 'precio', m.precio,
                               'desde', m.aprobado_desde, 'retiro_programado', m.retiro_programado)
        FROM public.clientes_mayoristas m
       WHERE m.customer_id = p_customer_id AND m.estado IN ('aprobado', 'solicitado')
       LIMIT 1),

    'puntos', (
      SELECT json_build_object('saldo', coalesce(pc.saldo, 0), 'ganados', coalesce(pc.ganados, 0),
                               'usados', coalesce(pc.usados, 0), 'tiene_codigo', k.customer_id IS NOT NULL)
        FROM (SELECT 1) d
        LEFT JOIN public.puntos_cuenta pc ON pc.customer_id = p_customer_id
        LEFT JOIN public.puntos_codigo_acceso k ON k.customer_id = p_customer_id),

    'nivel', (
      SELECT json_build_object('clave', n.clave, 'nombre', n.nombre, 'compra_12m', x.compra)
        FROM (SELECT public.puntos_compra_12m(p_customer_id, v_hoy, NULL) AS compra) x,
             LATERAL public.puntos_nivel_de(x.compra) n),

    'por_vencer', (
      SELECT coalesce(json_agg(json_build_object('vence_el', s.vence_el, 'puntos', s.puntos) ORDER BY s.vence_el), '[]'::json)
        FROM (SELECT l.vence_el, sum(l.restantes)::int AS puntos
                FROM public.puntos_lote l
               WHERE l.customer_id = p_customer_id AND l.restantes > 0
                 AND l.vence_el >= v_hoy AND l.vence_el <= v_hoy + 60
               GROUP BY l.vence_el
               ORDER BY l.vence_el
               LIMIT 6) s),

    'app', (
      SELECT json_build_object(
        'alguna_vez', count(*) > 0,
        'sesiones', count(*) FILTER (WHERE s.revocada_at IS NULL),
        'avisos', coalesce(bool_or(s.revocada_at IS NULL AND s.push_token IS NOT NULL AND s.acepta_avisos), false),
        'ultimo_uso', max(s.ultimo_uso_at) FILTER (WHERE s.revocada_at IS NULL),
        'plataformas', coalesce(to_json(array_agg(DISTINCT s.plataforma)
                                FILTER (WHERE s.revocada_at IS NULL AND s.plataforma IS NOT NULL)), '[]'::json))
        FROM public.app_cliente_sesiones s WHERE s.customer_id = p_customer_id),

    'reservas', (
      SELECT coalesce(json_agg(to_json(r)), '[]'::json) FROM (
        SELECT a.id, a.estado, a.producto_nombre, a.cantidad, a.precio_unitario, a.pago_estado,
               a.entrega, a.pedido, a.vence_at, a.created_at AS creada_at, a.receta_estado, b.name AS sala
          FROM public.app_reservas a
          LEFT JOIN public.branches b ON b.id = a.branch_id
         WHERE a.customer_id = p_customer_id AND a.estado IN ('en_revision', 'pendiente', 'lista')
         ORDER BY a.created_at DESC
         LIMIT 20) r),

    'encargos', (
      SELECT coalesce(json_agg(to_json(e)), '[]'::json) FROM (
        SELECT g.id, g.estado, g.producto_nombre, g.cantidad, g.precio_unitario, g.anticipo,
               g.pago_estado, g.fecha_estimada, g.created_at AS creado_at, b.name AS sala
          FROM public.app_encargos g
          LEFT JOIN public.branches b ON b.id = g.branch_id
         WHERE g.customer_id = p_customer_id
           AND g.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
         ORDER BY g.created_at DESC
         LIMIT 20) e),

    'tratamientos', (
      SELECT coalesce(json_agg(to_json(t)), '[]'::json) FROM (
        SELECT a.id, a.nombre, a.intervalo_dias, a.ultima_compra, a.veces,
               (a.ultima_compra + a.intervalo_dias) AS proxima
          FROM public.app_tratamientos a
         WHERE a.customer_id = p_customer_id AND a.estado = 'activo'
         ORDER BY (a.ultima_compra + a.intervalo_dias) NULLS LAST
         LIMIT 20) t),

    'creditos', CASE WHEN v_ve_creditos THEN (
      SELECT coalesce(json_agg(to_json(x)), '[]'::json) FROM (
        SELECT cr.id, cr.fecha, cr.numero_doc, cr.tipo_doc, cr.total, cr.abonado, cr.saldo, b.name AS sala
          FROM public.creditos_de_clientes cr
          LEFT JOIN public.branches b ON b.id = cr.branch_id
         WHERE cr.customer_id = p_customer_id
           AND cr.saldo > 0.004 AND cr.anulado_el IS NULL AND cr.estado <> 'ANULADO'
         ORDER BY cr.fecha
         LIMIT 50) x) END,

    'inyecciones', CASE WHEN v_ve_inyecciones THEN (
      SELECT coalesce(json_agg(to_json(x)), '[]'::json) FROM (
        SELECT a.id, a.producto, a.precio, c.registrado_at AS pagada_at, b.name AS sala
          FROM public.inyeccion_aplicaciones a
          JOIN public.caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
          LEFT JOIN public.branches b ON b.id = a.branch_id
         WHERE a.customer_id = p_customer_id
           AND a.confirmada AND a.aplicada_at IS NULL AND a.mezcla_de IS NULL
         ORDER BY c.registrado_at DESC
         LIMIT 20) x) END,

    'compras', (
      SELECT coalesce(json_agg(to_json(x)), '[]'::json) FROM (
        SELECT si.id, si.fecha, si.hora, si.tipo_documento, si.total, b.name AS sala
          FROM public.sales_invoices si
          LEFT JOIN public.branches b ON b.id = si.branch_id
         WHERE si.customer_id = p_customer_id AND public.venta_valida(si.estado)
         ORDER BY si.fecha DESC, si.hora DESC
         LIMIT 8) x)
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_expediente(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_expediente(bigint) TO authenticated, service_role;
