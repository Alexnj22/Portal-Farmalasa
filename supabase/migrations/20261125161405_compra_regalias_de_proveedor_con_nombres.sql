SET lock_timeout = '5s';

-- La pestaña «Regalías» muestra quién cambió cada nivel (foto + nombre corto).
-- El nombre está en `employees`, así que la lectura pasa a DEFINER con la
-- misma regla de las policies de `compra_regalia`: ver Compras, Facturas de
-- compra o Cargar compra.
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
                 coalesce(p.nombre, r.descripcion) AS producto, a.product_id,
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
