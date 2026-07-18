-- Facturas de Compra — match CCF↔Nota de Crédito/Débito (a pedido del usuario
-- 2026-07-18). El DTE de una NC/ND trae documentoRelacionado[0].numeroDocumento
-- = codigoGeneracion (tipoGeneracion=2) o numeroControl (tipoGeneracion=1) del
-- documento que corrige. Columna self-referencing + expuesta en
-- get_purchase_dte_documents (notas_credito[] para el badge en el CCF).
SET lock_timeout = '5s';

ALTER TABLE public.purchase_dte_documents
  ADD COLUMN documento_relacionado_id bigint REFERENCES public.purchase_dte_documents(id);
CREATE INDEX idx_purchase_dte_docs_relacionado ON public.purchase_dte_documents (documento_relacionado_id);

CREATE OR REPLACE FUNCTION public.get_purchase_dte_documents(
    p_desde date DEFAULT (CURRENT_DATE - 60),
    p_hasta date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT
      d.id, d.codigo_generacion, d.tipo_dte, d.numero_control,
      d.emisor_nit, d.emisor_nrc, d.emisor_nombre,
      d.fecha_emision, d.monto_total, d.total_iva,
      d.json_path, d.pdf_path, d.account_id, d.from_email,
      d.source_message_id, d.received_at, d.created_at,
      d.supplier_id, s.nombre AS supplier_nombre,
      d.proveedor_id, p.nombre AS proveedor_nombre,
      d.documento_relacionado_id,
      dr.codigo_generacion AS documento_relacionado_codigo,
      (
        SELECT coalesce(json_agg(json_build_object(
          'id', nc.id, 'codigo_generacion', nc.codigo_generacion,
          'tipo_dte', nc.tipo_dte, 'numero_control', nc.numero_control,
          'monto_total', nc.monto_total, 'fecha_emision', nc.fecha_emision,
          'emisor_nombre', nc.emisor_nombre, 'json_path', nc.json_path, 'pdf_path', nc.pdf_path
        ) ORDER BY nc.fecha_emision), '[]'::json)
        FROM public.purchase_dte_documents nc
        WHERE nc.documento_relacionado_id = d.id
      ) AS notas_credito
    FROM public.purchase_dte_documents d
    LEFT JOIN public.suppliers s ON s.id = d.supplier_id
    LEFT JOIN public.proveedores_maestro p ON p.id = d.proveedor_id
    LEFT JOIN public.purchase_dte_documents dr ON dr.id = d.documento_relacionado_id
    WHERE coalesce(d.fecha_emision, d.created_at::date) BETWEEN p_desde AND p_hasta
    ORDER BY coalesce(d.fecha_emision, d.created_at::date) DESC, d.created_at DESC
  ) t;
$$;
