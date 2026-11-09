SET lock_timeout = '5s';

-- Cómo se parte un renglón de factura en varios productos (2026-11-09): Diszasa
-- factura «PACK OFF FAMILY + OFF SPRAY» en uno y son dos del inventario.
-- `document_id` NULL = se recuerda para el código; con valor = sólo esa factura
-- (y `partes` vacío ahí = «esta vez se deja entero»).
CREATE TABLE public.compra_renglon_particion (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  emisor_nit   text NOT NULL,
  llave        text NOT NULL,
  document_id  bigint REFERENCES public.purchase_dte_documents(id) ON DELETE CASCADE,
  partes       jsonb NOT NULL,
  creado_por   uuid REFERENCES public.employees(id),
  CONSTRAINT compra_renglon_particion_unica UNIQUE NULLS NOT DISTINCT (emisor_nit, llave, document_id)
);
CREATE INDEX compra_renglon_particion_document_idx ON public.compra_renglon_particion(document_id);

ALTER TABLE public.compra_renglon_particion ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_renglon_particion_select ON public.compra_renglon_particion
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('compras','can_view'))
      OR (SELECT auth_has_module_permission('facturas_compra','can_view'))
      OR (SELECT auth_has_module_permission('cargar_compra','can_view')));
REVOKE ALL ON public.compra_renglon_particion FROM anon;

CREATE FUNCTION public.guardar_particion_renglon(
  p_emisor_nit text, p_llave text, p_partes jsonb, p_document_id bigint DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_emp uuid;
  v_nit text := nullif(btrim(coalesce(p_emisor_nit,'')),'');
  v_llave text := nullif(btrim(coalesce(p_llave,'')),'');
  v_n int;
  v_malas int;
  v_suma numeric;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','facturas_compra','cargar_compra']) THEN
    RAISE EXCEPTION 'No tenés permiso para partir renglones de compra.';
  END IF;
  IF v_nit IS NULL OR v_llave IS NULL THEN
    RAISE EXCEPTION 'Falta el proveedor o su código de producto.';
  END IF;
  IF jsonb_typeof(coalesce(p_partes,'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Las partes no son válidas.';
  END IF;
  IF p_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.purchase_dte_documents d WHERE d.id = p_document_id AND d.emisor_nit = v_nit
  ) THEN
    RAISE EXCEPTION 'Esa factura no es de este proveedor.';
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';

  v_n := jsonb_array_length(p_partes);
  IF v_n = 0 AND p_document_id IS NULL THEN
    -- Dejar entero, recordado: se borra la regla y la excepción de cualquier factura.
    DELETE FROM public.compra_renglon_particion WHERE emisor_nit = v_nit AND llave = v_llave;
    RETURN;
  END IF;

  IF v_n > 0 THEN
    IF v_n > 6 THEN RAISE EXCEPTION 'Un renglón se parte en 6 productos como máximo.'; END IF;
    SELECT count(*) FILTER (WHERE NOT (
             (x->>'product_id') ~ '^[0-9]+$'
             AND (x->>'unidades') ~ '^[0-9]+$' AND (x->>'unidades')::numeric BETWEEN 1 AND 1000
             AND (x->>'porcentaje') ~ '^[0-9]+(\.[0-9]+)?$' AND (x->>'porcentaje')::numeric > 0
           )),
           sum(CASE WHEN (x->>'porcentaje') ~ '^[0-9]+(\.[0-9]+)?$' THEN (x->>'porcentaje')::numeric END)
      INTO v_malas, v_suma
      FROM jsonb_array_elements(p_partes) x;
    IF v_malas > 0 THEN RAISE EXCEPTION 'Cada parte lleva un producto, unidades enteras y su parte del costo.'; END IF;
    IF v_suma <> 100 THEN RAISE EXCEPTION 'El costo tiene que sumar 100 %% (va en %).', v_suma; END IF;
    IF v_n = 1 AND (p_partes->0->>'unidades')::numeric < 2 THEN
      RAISE EXCEPTION 'Con un solo producto de 1 unidad no hay nada que partir.';
    END IF;
    IF (SELECT count(DISTINCT x->>'product_id') FROM jsonb_array_elements(p_partes) x) <> v_n THEN
      RAISE EXCEPTION 'El mismo producto está dos veces.';
    END IF;
    IF (SELECT count(*) FROM public.products p
         WHERE p.id IN (SELECT (x->>'product_id')::integer FROM jsonb_array_elements(p_partes) x)) <> v_n THEN
      RAISE EXCEPTION 'Uno de los productos no existe.';
    END IF;
  END IF;

  INSERT INTO public.compra_renglon_particion (emisor_nit, llave, document_id, partes, creado_por)
  VALUES (v_nit, v_llave, p_document_id, p_partes, v_emp)
  ON CONFLICT ON CONSTRAINT compra_renglon_particion_unica DO UPDATE
     SET partes = EXCLUDED.partes, creado_por = EXCLUDED.creado_por, updated_at = now();

  -- Lo que se recuerda vale de inmediato: sin excepción vieja en otras facturas.
  IF p_document_id IS NULL THEN
    DELETE FROM public.compra_renglon_particion
     WHERE emisor_nit = v_nit AND llave = v_llave AND document_id IS NOT NULL;
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.guardar_particion_renglon(text,text,jsonb,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_particion_renglon(text,text,jsonb,bigint) TO authenticated, service_role;

-- Un código ya partido deja de preguntarse en «Por confirmar».
CREATE OR REPLACE FUNCTION public.get_productos_por_confirmar(p_estado text, p_limite integer)
 RETURNS TABLE(id bigint, emisor_nit text, proveedor text, codigo_proveedor text, descripcion text, llave text, renglones integer, documentos integer, unidades numeric, ultima_fecha date, sugerido_product_id integer, sugerido_nombre text, sugerido_origen text, sugerido_similitud real, resuelto boolean, ignorado boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT r.id, r.emisor_nit,
         coalesce((SELECT m.nombre FROM public.proveedores_maestro m
                    WHERE m.nit = r.emisor_nit ORDER BY m.id LIMIT 1),
                  (SELECT d.emisor_nombre FROM public.purchase_dte_documents d
                    WHERE d.emisor_nit = r.emisor_nit ORDER BY d.id DESC LIMIT 1)),
         r.codigo_proveedor, r.descripcion, r.llave,
         r.renglones, r.documentos, r.unidades, r.ultima_fecha,
         coalesce(a.product_id, r.sugerido_product_id),
         (SELECT p.nombre FROM public.products p
           WHERE p.id = coalesce(a.product_id, r.sugerido_product_id)),
         CASE WHEN a.product_id IS NOT NULL THEN 'aprendido' ELSE r.sugerido_origen END,
         CASE WHEN a.product_id IS NOT NULL THEN 1.0::real ELSE r.sugerido_similitud END,
         a.product_id IS NOT NULL,
         r.ignorado
    FROM public.compra_renglon_pendiente r
    LEFT JOIN public.compra_producto_alias a
           ON a.emisor_nit = r.emisor_nit AND a.codigo_proveedor = r.llave
   WHERE (SELECT auth_has_module_permission('cargar_compra','can_view')
           OR auth_has_module_permission('compras','can_view'))
     AND CASE lower(coalesce(p_estado, 'pendientes'))
           -- Lo que todavía hay que contestar.
           WHEN 'pendientes' THEN a.product_id IS NULL AND NOT r.ignorado
             AND NOT EXISTS (SELECT 1 FROM public.compra_renglon_particion x
                              WHERE x.emisor_nit = r.emisor_nit AND x.llave = r.llave AND x.document_id IS NULL)
           -- Lo que alguien marcó «no es un producto» — para revisar si fue un
           -- error o si desde entonces cambió algo.
           WHEN 'apartados'  THEN r.ignorado
           -- Lo ya contestado, que es donde vive el botón para corregirlo.
           WHEN 'resueltos'  THEN a.product_id IS NOT NULL AND NOT r.ignorado
           ELSE true          -- 'todos'
         END
   ORDER BY (a.product_id IS NOT NULL), r.ignorado, r.renglones DESC, r.id
   LIMIT greatest(1, least(coalesce(p_limite, 500), 2000));
$function$;
