SET lock_timeout = '5s';
-- Cada producto que el portal da de alta en el sistema desde la carga de una
-- compra. La fila se toma ANTES de mandar (nombre único): dos clics o un
-- reintento no crean el mismo producto dos veces, y una respuesta ilegible
-- deja la fila tomada para que nadie lo vuelva a mandar a ciegas.
CREATE TABLE public.producto_alta_portal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre text NOT NULL,
  barcode text,
  modelo_id integer NOT NULL,
  costo numeric(12,4) NOT NULL,
  precio numeric(12,4) NOT NULL,
  estado text NOT NULL DEFAULT 'enviando' CHECK (estado IN ('enviando','creado','sin_verificar','fallido')),
  erp_product_id integer,
  error text,
  creado_por uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX producto_alta_portal_nombre_vivo ON public.producto_alta_portal (upper(nombre)) WHERE estado <> 'fallido';
CREATE UNIQUE INDEX producto_alta_portal_barcode_vivo ON public.producto_alta_portal (barcode) WHERE estado <> 'fallido' AND barcode IS NOT NULL;
ALTER TABLE public.producto_alta_portal ENABLE ROW LEVEL SECURITY;
CREATE POLICY producto_alta_portal_select ON public.producto_alta_portal FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('cargar_compra','can_view')));
REVOKE ALL ON public.producto_alta_portal FROM anon;
