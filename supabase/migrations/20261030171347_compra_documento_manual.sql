SET lock_timeout = '5s';

-- Facturas en PAPEL (La Constancia y otros que no mandan DTE): la persona las
-- escribe a mano y siguen el mismo camino que un DTE — revisión, envío a
-- Bodega, verificación. Usuario, 2026-10-29: «que se pueda llenar a mano si no
-- hay QR/foto». Se escribe sólo por `cargar-compra-erp` (service role), que
-- exige cargar_compra can_edit.
CREATE TABLE public.compra_documento_manual (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proveedor_nit    text NOT NULL,
  proveedor_nombre text NOT NULL,
  erp_supplier_id  integer NOT NULL,
  tipo_doc         text NOT NULL CHECK (tipo_doc IN ('COF','CCF','FSE')),
  numero           text NOT NULL CHECK (length(btrim(numero)) > 0),
  serie            text,
  fecha_emision    date NOT NULL,
  -- [{ codigo, descripcion, cantidad, precio, descuento, exento }] tal como
  -- vienen en el papel (en factura el precio lleva IVA; en crédito fiscal, no).
  renglones        jsonb NOT NULL CHECK (jsonb_typeof(renglones) = 'array' AND jsonb_array_length(renglones) > 0),
  total            numeric(12,2) NOT NULL CHECK (total > 0),
  percepcion       numeric(12,2) NOT NULL DEFAULT 0,
  estado           text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','cargada','descartada')),
  creado_por       uuid REFERENCES public.employees(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- Un mismo papel no se escribe dos veces (lo que no se descartó).
CREATE UNIQUE INDEX compra_documento_manual_unico
  ON public.compra_documento_manual (erp_supplier_id, tipo_doc, upper(btrim(numero)))
  WHERE estado <> 'descartada';
CREATE INDEX compra_documento_manual_estado_idx ON public.compra_documento_manual (estado, created_at DESC);

ALTER TABLE public.compra_documento_manual ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_documento_manual_select ON public.compra_documento_manual
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('cargar_compra', 'can_view')));
REVOKE ALL ON public.compra_documento_manual FROM anon;

-- La carga apunta a un DTE o a un papel: exactamente uno de los dos.
ALTER TABLE public.compra_carga ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE public.compra_carga ADD COLUMN manual_id bigint REFERENCES public.compra_documento_manual(id);
ALTER TABLE public.compra_carga ADD CONSTRAINT compra_carga_un_documento
  CHECK ((document_id IS NULL) <> (manual_id IS NULL));
CREATE INDEX compra_carga_manual_id_idx ON public.compra_carga (manual_id) WHERE manual_id IS NOT NULL;
CREATE UNIQUE INDEX compra_carga_una_real_manual ON public.compra_carga (manual_id)
  WHERE manual_id IS NOT NULL AND estado IN ('enviando','verificada','sin_verificar');
