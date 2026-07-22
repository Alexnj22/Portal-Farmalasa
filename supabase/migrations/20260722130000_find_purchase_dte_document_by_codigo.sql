-- Fase 3.2: búsqueda exacta por codigo_generacion (UUID detectado en el PDF
-- vía pdfjs-dist) — apoya "Detectar código" en Revisión (emparejar directo,
-- sin crear la fila 'confirmado sin JSON') y en Documentos (fusionar con
-- merge_purchase_dte_documents). Solo lectura, INVOKER (misma RLS SELECT
-- que get_purchase_dte_documents), sin paginar — un solo match esperado
-- (codigo_generacion es UNIQUE).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.find_purchase_dte_document_by_codigo(p_codigo text)
RETURNS json
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT to_json(t) FROM (
    SELECT d.id, d.codigo_generacion, d.tipo_dte, d.fecha_emision, d.monto_total,
           d.json_path, d.pdf_path,
           coalesce(p.nombre, s.nombre, d.emisor_nombre) AS proveedor_nombre
    FROM public.purchase_dte_documents d
    LEFT JOIN public.suppliers s ON s.id = d.supplier_id
    LEFT JOIN public.proveedores_maestro p ON p.id = d.proveedor_id
    WHERE upper(d.codigo_generacion) = upper(p_codigo)
    LIMIT 1
  ) t;
$$;

REVOKE ALL ON FUNCTION public.find_purchase_dte_document_by_codigo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_purchase_dte_document_by_codigo(text) TO authenticated, service_role;
