SET lock_timeout = '5s';
-- El conteo «Bajo receta» cuadra TODOS los antibióticos, no sólo los del libro
-- (pedido del usuario, 2026-10-28: «que se haga cada mes en cada sucursal y
-- bodega»). La Guía de BPAD 3.3/3.4 pide registro trazable y existencia física
-- igual al registro de TODOS los antibióticos; el conteo contaba sólo los que
-- el catálogo de origen marca (`es_antibiotico`), 85 productos contra 148 del
-- listado.
--
-- El conjunto es UNO y vive acá: el listado de Bitácoras (molécula asignada a
-- mano, o reconocida por nombre/principio activo) más todo lo que entra al
-- libro. Lo que se marcó «No es antibiótico» (fila de `antibioticos_producto`
-- con molécula NULL) queda afuera, igual que en el listado. Si cambia la forma
-- en que `get_listado_antibioticos` reconoce un producto, se cambia también acá.

CREATE FUNCTION public.antibioticos_del_cuadre()
RETURNS integer[] LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(array_agg(p.id ORDER BY p.id), '{}')
    FROM public.products p
    LEFT JOIN public.antibioticos_producto ap ON ap.product_id = p.id
    LEFT JOIN public.dispensacion_clases dc ON dc.erp_product_id = p.id
   WHERE (p.activo AND ap.product_id IS NOT NULL AND ap.molecula IS NOT NULL)
      OR (p.activo AND ap.product_id IS NULL AND EXISTS (
            SELECT 1 FROM public.antibioticos_aware a
             WHERE coalesce(p.pactivo_norm, '') LIKE '%' || a.molecula || '%'
                OR coalesce(p.nombre_norm, '')  LIKE '%' || a.molecula || '%'))
      OR public.va_al_libro(dc.clase, p.es_antibiotico);
$$;
REVOKE EXECUTE ON FUNCTION public.antibioticos_del_cuadre() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.antibioticos_del_cuadre() TO authenticated, service_role;

DO $$
DECLARE def text; nuevo text;
BEGIN
  SELECT pg_get_functiondef('public.crear_conteo_inventario(bigint,text,jsonb,integer[],text,text)'::regprocedure) INTO def;
  nuevo := replace(def,
    'OR (p_scope_type = ''BAJO_RECETA'' AND p.es_antibiotico = true)',
    'OR (p_scope_type = ''BAJO_RECETA'' AND i.erp_product_id = ANY((SELECT public.antibioticos_del_cuadre())))');
  IF nuevo = def THEN RAISE EXCEPTION 'Sin ancla en crear_conteo_inventario'; END IF;
  EXECUTE nuevo;

  SELECT pg_get_functiondef('public.sincronizar_conteo_en_vivo(uuid)'::regprocedure) INTO def;
  nuevo := replace(def,
    'SELECT array_agg(id) INTO v_scope_ids FROM public.products WHERE es_antibiotico = true;',
    'v_scope_ids := public.antibioticos_del_cuadre();');
  IF nuevo = def THEN RAISE EXCEPTION 'Sin ancla en sincronizar_conteo_en_vivo'; END IF;
  EXECUTE nuevo;
END $$;
