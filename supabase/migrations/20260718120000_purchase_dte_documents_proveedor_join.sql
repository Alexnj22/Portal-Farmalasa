-- Fase 4.4: get_purchase_dte_documents expone proveedor_id/nombre del maestro
-- (join adicional, CREATE OR REPLACE — misma firma/policy, INVOKER).
SET lock_timeout = '5s';

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
      d.proveedor_id, p.nombre AS proveedor_nombre
    FROM public.purchase_dte_documents d
    LEFT JOIN public.suppliers s ON s.id = d.supplier_id
    LEFT JOIN public.proveedores_maestro p ON p.id = d.proveedor_id
    WHERE coalesce(d.fecha_emision, d.created_at::date) BETWEEN p_desde AND p_hasta
    ORDER BY coalesce(d.fecha_emision, d.created_at::date) DESC, d.created_at DESC
  ) t;
$$;
