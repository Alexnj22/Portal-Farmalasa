SET lock_timeout = '5s';
-- Cada nota de crédito de compra que el portal registra en el libro de
-- compras del sistema (usuario, 2026-10-30: «el portal»). Hasta hoy nadie las
-- registraba: el libro de Bodega de septiembre no trae ninguna. La fila se
-- toma ANTES de mandar: una nota no se registra dos veces, y una respuesta
-- que no se pudo comprobar deja la fila tomada para revisarla a mano.
CREATE TABLE public.compra_nota_credito_libro (
  document_id bigint PRIMARY KEY REFERENCES public.purchase_dte_documents(id),
  erp_sucursal_id integer NOT NULL,
  estado text NOT NULL DEFAULT 'enviando' CHECK (estado IN ('enviando','registrada','sin_verificar','fallida')),
  datos jsonb,
  error text,
  registrada_por uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.compra_nota_credito_libro ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_nota_credito_libro_select ON public.compra_nota_credito_libro FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('compras','can_view'))
      OR (SELECT auth_has_module_permission('cargar_compra','can_view')));
REVOKE ALL ON public.compra_nota_credito_libro FROM anon;

-- `saliendo`: la salida tomada (candado contra doble clic).
ALTER TABLE public.compra_renglon_erroneo DROP CONSTRAINT compra_renglon_erroneo_estado_check;
ALTER TABLE public.compra_renglon_erroneo ADD CONSTRAINT compra_renglon_erroneo_estado_check
  CHECK (estado IN ('por_mover','en_vencidos','con_nota','saliendo','salio'));
ALTER TABLE public.compra_renglon_erroneo ADD COLUMN salida jsonb;
