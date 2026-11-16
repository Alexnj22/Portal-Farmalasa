-- Preventa (2026-11-16, usuario: «ver en algún lado sus últimas compras»):
-- `preventa_cliente` suma sus 5 últimas compras con los productos de cada una
-- y lo que más compra en 12 meses, para agregarlo a la venta de un toque.
-- No se calcula para el cliente de mostrador ni el genérico: sus miles de
-- facturas son de todo el mundo y no dicen nada de nadie.
-- Parte de la definición VIVA (md5 b411e3f1… comparado antes de reescribir).
SET lock_timeout = '5s';

-- La ficha del cliente para la pantalla de Preventa: datos, tipo, nivel,
-- puntos y su última compra. Una sola llamada al elegirlo.
CREATE OR REPLACE FUNCTION public.preventa_cliente(p_branch bigint, p_customer bigint)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  c public.customers; v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_prog text; v_compra numeric; v_nivel record; v_ult record; v_foto text; v_ultimas json; v_frecuentes json;
BEGIN
  IF NOT public.preventa_puede(public.auth_employee_id(), p_branch, 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.customers WHERE id = p_customer;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_prog := CASE
    WHEN public.es_cliente_mostrador(c.name, c.erp_id) THEN 'mostrador'
    WHEN c.tipo_persona IS NOT DISTINCT FROM 'juridica' THEN 'empresa'
    WHEN NOT coalesce(c.acumula_puntos, true) OR c.acepta_programa_puntos IS NOT DISTINCT FROM false THEN 'fuera'
    WHEN EXISTS (SELECT 1 FROM public.clientes_mayoristas cm WHERE cm.customer_id = c.id AND cm.estado = 'aprobado') THEN 'mayorista'
    ELSE 'socio' END;
  IF v_prog IN ('socio', 'mayorista') THEN
    v_compra := public.puntos_compra_12m(c.id, v_hoy, NULL);
    SELECT * INTO v_nivel FROM public.puntos_nivel_de(v_compra, v_hoy);
  END IF;
  SELECT si.fecha, si.total, b.name AS sucursal INTO v_ult
    FROM public.sales_invoices si LEFT JOIN public.branches b ON b.id = si.branch_id
   WHERE si.customer_id = c.id AND public.venta_valida(si.estado)
   ORDER BY si.fecha DESC, si.id DESC LIMIT 1;
  -- La foto que el cliente subió desde la app (si el equipo no la quitó).
  SELECT ruta INTO v_foto FROM public.app_cliente_fotos WHERE customer_id = c.id AND quitada_at IS NULL;
  IF v_prog <> 'mostrador' AND NOT public.cliente_es_generico(c.id) THEN
    SELECT coalesce(json_agg(u ORDER BY u.fecha DESC, u.id DESC), '[]'::json) INTO v_ultimas FROM (
      SELECT si.id, si.fecha, si.total, si.tipo_documento, b.name AS sucursal,
             (SELECT coalesce(json_agg(json_build_object(
                       'producto_id', it.erp_product_id, 'nombre', coalesce(p.nombre, it.descripcion),
                       'cantidad', it.cantidad, 'presentacion', it.presentacion, 'total', it.total_linea,
                       'foto_url', p.foto_url, 'activo', coalesce(p.activo, true)) ORDER BY it.linea_num), '[]'::json)
                FROM public.sales_invoice_items it LEFT JOIN public.products p ON p.id = it.erp_product_id
               WHERE it.invoice_id = si.id) AS productos
        FROM public.sales_invoices si LEFT JOIN public.branches b ON b.id = si.branch_id
       WHERE si.customer_id = c.id AND public.venta_valida(si.estado)
       ORDER BY si.fecha DESC, si.hora DESC NULLS LAST, si.id DESC LIMIT 5) u;
    SELECT coalesce(json_agg(f ORDER BY f.veces DESC, f.ultima DESC), '[]'::json) INTO v_frecuentes FROM (
      SELECT it.erp_product_id AS producto_id, max(p.nombre) AS nombre, max(p.foto_url) AS foto_url,
             count(DISTINCT si.id) AS veces, max(si.fecha) AS ultima
        -- Sus 200 compras más recientes del año: acota al cliente de miles
        -- de facturas (una clínica) sin cambiar nada para el resto.
        FROM (SELECT x.id, x.fecha FROM public.sales_invoices x
               WHERE x.customer_id = c.id AND public.venta_valida(x.estado) AND x.fecha >= v_hoy - 365
               ORDER BY x.fecha DESC LIMIT 200) si
        JOIN public.sales_invoice_items it ON it.invoice_id = si.id
        JOIN public.products p ON p.id = it.erp_product_id AND coalesce(p.activo, true)
       GROUP BY it.erp_product_id
       ORDER BY count(DISTINCT si.id) DESC, max(si.fecha) DESC LIMIT 6) f;
  END IF;
  RETURN json_build_object(
    'id', c.id, 'foto_ruta', v_foto, 'name', c.name, 'categoria', c.categoria, 'tipo_persona', c.tipo_persona,
    'nit', c.nit, 'dui', c.dui, 'nrc', c.nrc, 'giro', c.giro, 'phone', c.phone, 'email', c.email,
    'direccion', c.direccion, 'erp_id', c.erp_id,
    'lista', public.lista_de_precio_del_cliente(c.id), 'generico', public.cliente_es_generico(c.id),
    'empleado', public.cliente_es_empleado(c.id), 'mayorista', public.mayorista_de(c.id),
    'programa', v_prog,
    'rango', CASE WHEN v_prog = 'mayorista' THEN public.mayorista_rango(c.id) END,
    'nivel', v_nivel.nombre, 'compra_12m', round(v_compra, 2),
    'puntos', public.preventa_puntos_del_cliente(c.id),
    'minimo_a_pagar', public.puntos_minimo_a_pagar(v_hoy),
    'ultima_compra', CASE WHEN v_ult.fecha IS NOT NULL THEN
       json_build_object('fecha', v_ult.fecha, 'total', v_ult.total, 'sucursal', v_ult.sucursal) END,
    'ultimas_compras', coalesce(v_ultimas, '[]'::json), 'frecuentes', coalesce(v_frecuentes, '[]'::json));
END $$;
REVOKE EXECUTE ON FUNCTION public.preventa_cliente(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preventa_cliente(bigint, bigint) TO authenticated, service_role;
