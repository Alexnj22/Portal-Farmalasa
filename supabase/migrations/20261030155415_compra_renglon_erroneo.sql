SET lock_timeout = '5s';
-- Lo que un proveedor mandó por error (usuario, 2026-10-30). Entra con la
-- compra —la factura lo cobra— y se pasa a Bodega de vencidos; cuando llega
-- la nota de crédito se adjunta y el producto sale. Si no lo tenemos en el
-- catálogo entra como el genérico «PRODUCTO ERRONEO DE PROVEEDOR» (5307), y
-- ESTA fila es la que guarda qué era de verdad.
CREATE TABLE public.compra_renglon_erroneo (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_carga_id bigint NOT NULL REFERENCES public.compra_carga(id),
  document_id bigint NOT NULL,
  renglon integer NOT NULL,
  emisor_nit text,
  emisor_nombre text,
  descripcion text NOT NULL,
  codigo_proveedor text,
  product_id integer NOT NULL,          -- con qué entró a Bodega
  es_generico boolean NOT NULL,
  unidades numeric(12,4) NOT NULL,
  costo_unitario numeric(12,4) NOT NULL,
  erp_compra_id integer,
  estado text NOT NULL DEFAULT 'por_mover'
    CHECK (estado IN ('por_mover','en_vencidos','con_nota','salio')),
  erp_traslado_id text,
  nota text,
  nota_credito_document_id bigint,
  marcado_por uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (compra_carga_id, renglon)
);
CREATE INDEX compra_renglon_erroneo_estado ON public.compra_renglon_erroneo (estado);
CREATE INDEX compra_renglon_erroneo_document ON public.compra_renglon_erroneo (document_id);
ALTER TABLE public.compra_renglon_erroneo ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_renglon_erroneo_select ON public.compra_renglon_erroneo FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('compras','can_view'))
      OR (SELECT auth_has_module_permission('cargar_compra','can_view')));
REVOKE ALL ON public.compra_renglon_erroneo FROM anon;
