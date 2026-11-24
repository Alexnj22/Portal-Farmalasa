-- «Por confirmar» buscaba en el navegador DESPUÉS del tope de 500 filas.
-- Medido el 2026-11-24: 3,436 renglones confirmados, la pantalla pide los 500
-- con más facturas y filtra eso. GRIIN FLEX y ULTRA FLEX (2–4 renglones) no
-- entraban nunca: buscarlos daba vacío y no había cómo corregir lo confirmado.
-- Ahora la búsqueda viaja como p_busca y la regla del portal
-- (busqueda_coincide) decide ANTES del LIMIT. Mismo cuerpo, mismo orden.
-- Pasa a plpgsql para tokenizar la búsqueda una sola vez.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_productos_por_confirmar(text, integer);

CREATE FUNCTION public.get_productos_por_confirmar(
  p_estado text, p_limite integer, p_busca text DEFAULT NULL)
RETURNS TABLE(id bigint, emisor_nit text, proveedor text, codigo_proveedor text, descripcion text, llave text, renglones integer, documentos integer, unidades numeric, ultima_fecha date, sugerido_product_id integer, sugerido_nombre text, sugerido_origen text, sugerido_similitud real, resuelto boolean, ignorado boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_tok jsonb := CASE WHEN nullif(btrim(coalesce(p_busca, '')), '') IS NULL THEN NULL
                      ELSE public.busqueda_palabras(p_busca) END;
BEGIN
  RETURN QUERY
  SELECT q.* FROM (
    SELECT r.id, r.emisor_nit,
           coalesce((SELECT m.nombre FROM public.proveedores_maestro m
                      WHERE m.nit = r.emisor_nit ORDER BY m.id LIMIT 1),
                    (SELECT d.emisor_nombre FROM public.purchase_dte_documents d
                      WHERE d.emisor_nit = r.emisor_nit ORDER BY d.id DESC LIMIT 1)) AS proveedor,
           r.codigo_proveedor, r.descripcion, r.llave,
           r.renglones, r.documentos, r.unidades, r.ultima_fecha,
           coalesce(a.product_id, r.sugerido_product_id) AS sugerido_product_id,
           (SELECT p.nombre FROM public.products p
             WHERE p.id = coalesce(a.product_id, r.sugerido_product_id)) AS sugerido_nombre,
           CASE WHEN a.product_id IS NOT NULL THEN 'aprendido' ELSE r.sugerido_origen END AS sugerido_origen,
           CASE WHEN a.product_id IS NOT NULL THEN 1.0::real ELSE r.sugerido_similitud END AS sugerido_similitud,
           a.product_id IS NOT NULL AS resuelto,
           r.ignorado
      FROM public.compra_renglon_pendiente r
      LEFT JOIN public.compra_producto_alias a
             ON a.emisor_nit = r.emisor_nit AND a.codigo_proveedor = r.llave
     WHERE (SELECT auth_has_module_permission('cargar_compra','can_view')
             OR auth_has_module_permission('compras','can_view'))
       AND CASE lower(coalesce(p_estado, 'pendientes'))
             WHEN 'pendientes' THEN a.product_id IS NULL AND NOT r.ignorado
               AND NOT EXISTS (SELECT 1 FROM public.compra_renglon_particion x
                                WHERE x.emisor_nit = r.emisor_nit AND x.llave = r.llave AND x.document_id IS NULL)
             WHEN 'apartados'  THEN r.ignorado
             WHEN 'resueltos'  THEN a.product_id IS NOT NULL AND NOT r.ignorado
             ELSE true
           END
  ) q
  WHERE v_tok IS NULL
     OR public.busqueda_coincide(v_tok,
          coalesce(q.proveedor, '') || ' ' || coalesce(q.descripcion, '') || ' ' ||
          coalesce(q.codigo_proveedor, '') || ' ' || coalesce(q.sugerido_nombre, ''))
  ORDER BY q.resuelto, q.ignorado, q.renglones DESC, q.id
  LIMIT greatest(1, least(coalesce(p_limite, 500), 2000));
END;
$function$;

COMMENT ON FUNCTION public.get_productos_por_confirmar(text, integer, text) IS
  'Preguntas distintas (proveedor, su código) ordenadas por cuánto destraba cada una. p_estado: pendientes | apartados | resueltos | todos. p_busca: la regla del portal sobre proveedor + descripción + código + producto, aplicada ANTES del LIMIT (antes se filtraba en el navegador sobre 500 de 3,436 confirmados).';

REVOKE EXECUTE ON FUNCTION public.get_productos_por_confirmar(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_productos_por_confirmar(text, integer, text) TO authenticated, service_role;
