-- Preventa (2026-11-16, usuario): la foto del cliente, si la subió desde la
-- app. `preventa_cliente` devuelve la RUTA y el navegador la firma; para eso
-- quien usa Preventa tiene que poder leer la carpeta `perfil/` del bucket, que
-- hasta hoy era sólo de quien atiende el chat.
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
  v_prog text; v_compra numeric; v_nivel record; v_ult record; v_foto text;
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
       json_build_object('fecha', v_ult.fecha, 'total', v_ult.total, 'sucursal', v_ult.sucursal) END);
END $$;
REVOKE EXECUTE ON FUNCTION public.preventa_cliente(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preventa_cliente(bigint, bigint) TO authenticated, service_role;


DROP POLICY IF EXISTS app_clientes_archivos_select ON storage.objects;
CREATE POLICY app_clientes_archivos_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'app-clientes-archivos' AND (
    ((storage.foldername(name))[1] = 'recetas' AND (storage.foldername(name))[2] ~ '^[0-9]+$'
      AND public.receta_app_puede_aprobar(((storage.foldername(name))[2])::bigint))
    OR ((storage.foldername(name))[1] = ANY (ARRAY['chat', 'perfil'])
      AND (SELECT public.auth_has_module_permission('chat_clientes', 'can_view')))
    OR ((storage.foldername(name))[1] = 'perfil'
      AND (SELECT public.auth_has_module_permission('preventa', 'can_view')))
  )
);
