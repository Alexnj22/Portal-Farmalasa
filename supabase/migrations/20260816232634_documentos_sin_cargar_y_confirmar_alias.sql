-- Lo que le falta a la pantalla de carga: qué documentos esperan, y guardar la
-- confirmación de un producto para no volver a preguntarla.

SET lock_timeout = '5s';

-- ── 1. Los documentos que esperan ───────────────────────────────────────────
-- Mismo cruce que usa el libro de compras para decidir si un documento «ya está
-- registrado» — sello, o número de documento contra el código de generación
-- (que el sistema corta a 20 caracteres). Se reusa a propósito: si las dos
-- pantallas usaran criterios distintos, una diría que falta cargar algo que la
-- otra da por cargado.
CREATE OR REPLACE FUNCTION public.get_documentos_sin_cargar(p_dias integer DEFAULT 60)
RETURNS TABLE (
    document_id       bigint,
    fecha_emision     date,
    emisor_nombre     text,
    emisor_nit        text,
    codigo_generacion text,
    numero_control    text,
    monto_total       numeric,
    renglones         integer,
    tiene_pdf         boolean,
    proveedor_ficha   text,
    dias_desde        integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT d.id, d.fecha_emision, d.emisor_nombre, d.emisor_nit,
         d.codigo_generacion::text, d.numero_control, d.monto_total,
         coalesce(array_length(string_to_array(d.items_text, ' | '), 1), 0)::integer,
         d.pdf_path IS NOT NULL,
         (SELECT m.nombre FROM public.proveedores_maestro m
           WHERE m.nit = d.emisor_nit ORDER BY m.id LIMIT 1),
         (current_date - d.fecha_emision)::integer
    FROM public.purchase_dte_documents d
   WHERE NOT d.invalidado
     AND d.tipo_dte IN ('01','03')
     AND d.json_path IS NOT NULL
     AND d.fecha_emision >= current_date - coalesce(p_dias, 60)
     AND (SELECT auth_has_module_permission('compras','can_view')
           OR auth_has_module_permission('facturas_compra','can_view'))
     AND NOT EXISTS (
           SELECT 1 FROM public.purchase_receipts pr
            WHERE coalesce(pr.estado,'') <> 'anulada'
              AND ( (d.sello_recibido IS NOT NULL AND pr.sello_recibido = d.sello_recibido)
                 OR upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0'))
                    IN (left(upper(d.codigo_generacion::text), 20),
                        left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                        upper(d.codigo_generacion::text)) ))
   ORDER BY d.fecha_emision DESC, d.id DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_documentos_sin_cargar(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_documentos_sin_cargar(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_documentos_sin_cargar(integer) IS
    'Documentos de compra recibidos que todavía no tienen una compra registrada. Mismo cruce que el libro de compras, a propósito: con criterios distintos una pantalla diría que falta lo que la otra da por hecho.';

-- ── 2. Confirmar un producto ────────────────────────────────────────────────
-- Lo que hace que el trabajo baje solo: la confirmación de una persona se
-- guarda como `(NIT del proveedor, su código) → nuestro producto`, y ese
-- proveedor no vuelve a preguntar por ese producto nunca más.
CREATE OR REPLACE FUNCTION public.confirmar_alias_producto(
    p_emisor_nit  text,
    p_codigo_prov text,
    p_product_id  integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_emp uuid;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','facturas_compra']) THEN
    RAISE EXCEPTION 'No tenés permiso para confirmar productos de compra.';
  END IF;
  IF nullif(btrim(coalesce(p_emisor_nit,'')),'') IS NULL
     OR nullif(btrim(coalesce(p_codigo_prov,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Falta el proveedor o su código de producto.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Ese producto no existe.';
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';

  INSERT INTO public.compra_producto_alias
         (emisor_nit, codigo_proveedor, product_id, origen, confirmado_por, veces_usado)
  VALUES (btrim(p_emisor_nit), btrim(p_codigo_prov), p_product_id, 'confirmado', v_emp, 1)
  ON CONFLICT (emisor_nit, codigo_proveedor) DO UPDATE
     SET product_id     = EXCLUDED.product_id,
         origen         = 'confirmado',
         confirmado_por = EXCLUDED.confirmado_por,
         veces_usado    = public.compra_producto_alias.veces_usado + 1,
         updated_at     = now();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_alias_producto(text, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_alias_producto(text, text, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.confirmar_alias_producto(text, text, integer) IS
    'Guarda la confirmación de una persona en el diccionario de compras. Es la pieza que hace que el trabajo baje solo: ese proveedor no vuelve a preguntar por ese producto.';
