SET lock_timeout = '5s';

-- Revisión de código de la pestaña «Regalías» (2026-11-25):
-- · El historial firma con quien hace el cambio (`auth_employee_id()`), no con
--   el último que guardó: un UPDATE por SQL no toca `actualizado_por`.
-- · La lectura devuelve la descripción de la factura (`descripcion`) para que
--   guardar desde la pestaña no la pise con el nombre del catálogo.
CREATE OR REPLACE FUNCTION public.compra_regalia_al_historial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.compra_regalia_historial (proveedor_nit, codigo_proveedor, descripcion, accion, compra_despues, regalo_despues, cambiado_por)
    VALUES (NEW.proveedor_nit, NEW.codigo_proveedor, NEW.descripcion, 'alta', NEW.compra, NEW.regalo, coalesce(public.auth_employee_id(), NEW.actualizado_por));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (OLD.compra, OLD.regalo) IS DISTINCT FROM (NEW.compra, NEW.regalo) THEN
      INSERT INTO public.compra_regalia_historial (proveedor_nit, codigo_proveedor, descripcion, accion, compra_antes, regalo_antes, compra_despues, regalo_despues, cambiado_por)
      VALUES (NEW.proveedor_nit, NEW.codigo_proveedor, NEW.descripcion, 'cambio', OLD.compra, OLD.regalo, NEW.compra, NEW.regalo, coalesce(public.auth_employee_id(), NEW.actualizado_por));
    END IF;
    RETURN NEW;
  ELSE
    INSERT INTO public.compra_regalia_historial (proveedor_nit, codigo_proveedor, descripcion, accion, compra_antes, regalo_antes, cambiado_por)
    VALUES (OLD.proveedor_nit, OLD.codigo_proveedor, OLD.descripcion, 'baja', OLD.compra, OLD.regalo, public.auth_employee_id());
    RETURN OLD;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_regalia_al_historial() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.compra_regalias_de_proveedor(p_nit text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('compras', 'can_view'))
       OR (SELECT public.auth_has_module_permission('facturas_compra', 'can_view'))
       OR (SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN json_build_object(
    'productos', (
      SELECT coalesce(json_agg(to_json(t) ORDER BY t.compra IS NULL, t.producto NULLS LAST, t.codigo), '[]'::json)
        FROM (
          SELECT c.codigo,
                 coalesce(p.nombre, r.descripcion) AS producto, r.descripcion, a.product_id,
                 r.compra, r.regalo, r.actualizado_por, e.name AS actualizado_por_nombre, r.updated_at
            FROM (SELECT upper(btrim(codigo_proveedor)) AS codigo FROM public.compra_producto_alias
                   WHERE emisor_nit = p_nit AND codigo_proveedor NOT LIKE '#%'
                  UNION SELECT codigo_proveedor FROM public.compra_regalia WHERE proveedor_nit = p_nit) c
            LEFT JOIN LATERAL (SELECT x.product_id FROM public.compra_producto_alias x
                                WHERE x.emisor_nit = p_nit AND upper(btrim(x.codigo_proveedor)) = c.codigo
                                ORDER BY x.veces_usado DESC NULLS LAST LIMIT 1) a ON true
            LEFT JOIN public.products p ON p.id = a.product_id
            LEFT JOIN public.compra_regalia r ON r.proveedor_nit = p_nit AND r.codigo_proveedor = c.codigo
            LEFT JOIN public.employees e ON e.id = r.actualizado_por
        ) t),
    'historial', (
      SELECT coalesce(json_agg(to_json(h) ORDER BY h.created_at DESC), '[]'::json)
        FROM (SELECT x.id, x.created_at, x.codigo_proveedor, x.descripcion, x.accion,
                     x.compra_antes, x.regalo_antes, x.compra_despues, x.regalo_despues,
                     x.cambiado_por, e.name AS cambiado_por_nombre
                FROM public.compra_regalia_historial x
                LEFT JOIN public.employees e ON e.id = x.cambiado_por
               WHERE x.proveedor_nit = p_nit
               ORDER BY x.created_at DESC LIMIT 300) h)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_regalias_de_proveedor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_regalias_de_proveedor(text) TO authenticated, service_role;
