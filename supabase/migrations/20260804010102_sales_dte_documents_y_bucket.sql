-- El DTE de una venta, guardado: el JSON y el PDF tal como los emite Hacienda.
--
-- POR QUÉ. Hasta ahora el portal tenía los DATOS de la venta pero no el
-- DOCUMENTO. En compras sí está (llega por correo y se archiva), y para ventas
-- resultó que el origen los publica por `codigo_generacion` sin pedir login:
--   downloads/dteqr_json.php?codigoGeneracion=<UUID>   → el DTE completo
--   downloads/dteqr_pdf.php?codigoGeneracion=<UUID>    → su representación
-- El JSON trae `resumen.ivaRete1`, que es la retención — o sea que el propio
-- documento legal es el tercer testigo del dato.
--
-- Se guarda y no se pide al vuelo por dos motivos: conservación (Art. 147 CT
-- pide conservar el DTE) y porque ese endpoint YA estuvo caído — el proveedor
-- lo reparó el 2026-08-01. Depender de él en el momento en que alguien abre un
-- documento es depender de que siga en pie.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.sales_dte_documents (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id        bigint NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
    codigo_generacion uuid   NOT NULL UNIQUE,
    json_path         text,
    pdf_path          text,
    json_bytes        integer,
    pdf_bytes         integer,
    descargado_at     timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_dte_documents_invoice
    ON public.sales_dte_documents(invoice_id);

ALTER TABLE public.sales_dte_documents ENABLE ROW LEVEL SECURITY;

-- Solo lectura desde el cliente, y con el mismo permiso que abre el libro donde
-- se muestran. Quien escribe es la edge function con service_role, que no pasa
-- por RLS: no hace falta —ni conviene— una policy de INSERT/UPDATE.
DROP POLICY IF EXISTS sales_dte_documents_select ON public.sales_dte_documents;
CREATE POLICY sales_dte_documents_select ON public.sales_dte_documents
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('libros_iva', 'can_view')));

COMMENT ON TABLE public.sales_dte_documents IS
    'JSON y PDF del DTE de una venta, bajados de downloads/dteqr_{json,pdf}.php por codigo_generacion.';

-- Bucket privado, con el mismo techo y los mismos tipos que `purchase-dte`.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sales-dte', 'sales-dte', false, 10485760, ARRAY['application/json','application/pdf'])
ON CONFLICT (id) DO UPDATE
   SET public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS sales_dte_storage_select ON storage.objects;
CREATE POLICY sales_dte_storage_select ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'sales-dte'
           AND (SELECT auth_has_module_permission('libros_iva', 'can_view')));
