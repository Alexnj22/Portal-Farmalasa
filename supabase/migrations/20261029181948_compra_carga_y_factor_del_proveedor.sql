-- Cargar compras en Bodega desde el portal — pasos 1 a 3 del plan
-- (docs/PLAN-CARGAR-COMPRAS-EN-BODEGA-2026-10-29.md).
SET lock_timeout = '5s';

-- 1. El diccionario aprende también CUÁNTAS unidades del producto trae cada
--    unidad que factura el proveedor. «CONO CAPUCHINO CJA 10 U» a $6.65 es una
--    caja de 10 de un producto que el sistema lleva por unidad: sin esto la
--    compra entra 10 veces corta y a 10 veces el costo, sin error.
ALTER TABLE public.compra_producto_alias
  ADD COLUMN IF NOT EXISTS factor_proveedor numeric NOT NULL DEFAULT 1;
ALTER TABLE public.compra_producto_alias
  DROP CONSTRAINT IF EXISTS compra_producto_alias_factor_positivo;
ALTER TABLE public.compra_producto_alias
  ADD CONSTRAINT compra_producto_alias_factor_positivo CHECK (factor_proveedor > 0);

-- Se cambia la firma: la vieja se BORRA para que no quede viva con sus
-- permisos (CLAUDE.md regla 4).
DROP FUNCTION IF EXISTS public.confirmar_alias_producto(text, text, integer);
CREATE FUNCTION public.confirmar_alias_producto(
  p_emisor_nit text, p_codigo_prov text, p_product_id integer, p_factor numeric DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','facturas_compra','cargar_compra']) THEN
    RAISE EXCEPTION 'No tenés permiso para confirmar productos de compra.';
  END IF;
  IF nullif(btrim(coalesce(p_emisor_nit,'')),'') IS NULL
     OR nullif(btrim(coalesce(p_codigo_prov,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Falta el proveedor o su código de producto.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Ese producto no existe.';
  END IF;
  IF p_factor IS NULL OR p_factor <= 0 OR p_factor > 1000 THEN
    RAISE EXCEPTION 'Las unidades por cada una del proveedor tienen que estar entre 1 y 1000.';
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';

  INSERT INTO public.compra_producto_alias
         (emisor_nit, codigo_proveedor, product_id, factor_proveedor, origen, confirmado_por, veces_usado)
  VALUES (btrim(p_emisor_nit), btrim(p_codigo_prov), p_product_id, p_factor, 'confirmado', v_emp, 1)
  ON CONFLICT (emisor_nit, codigo_proveedor) DO UPDATE
     SET product_id       = EXCLUDED.product_id,
         factor_proveedor = EXCLUDED.factor_proveedor,
         origen           = 'confirmado',
         confirmado_por   = EXCLUDED.confirmado_por,
         veces_usado      = public.compra_producto_alias.veces_usado + 1,
         updated_at       = now();
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.confirmar_alias_producto(text, text, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_alias_producto(text, text, integer, numeric) TO authenticated, service_role;

-- 2 y 3. Cada intento de carga queda escrito ANTES de tocar el sistema de la
--    caja. Patrón de `pedido_traslado_erp`: si el proceso se corta, la fila
--    dice en qué paso quedó. `sobre` es el formulario EXACTO que se manda (o
--    se mandaría, en simulacro).
CREATE TABLE IF NOT EXISTS public.compra_carga (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id   bigint NOT NULL REFERENCES public.purchase_dte_documents(id),
  estado        text   NOT NULL CHECK (estado IN ('simulada','enviando','verificada','sin_verificar','fallida')),
  uso           text   NOT NULL CHECK (uso IN ('venta','consumo')),
  sobre         jsonb,
  revision      jsonb  NOT NULL DEFAULT '{}'::jsonb,   -- lo que se comprobó y lo que frenó
  error         text,
  erp_compra_id integer,
  creado_por    uuid REFERENCES public.employees(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compra_carga_document_id_idx ON public.compra_carga (document_id);
-- Un documento se carga UNA vez: a lo sumo una fila viva fuera del simulacro.
CREATE UNIQUE INDEX IF NOT EXISTS compra_carga_una_real
  ON public.compra_carga (document_id) WHERE estado IN ('enviando','verificada','sin_verificar');

ALTER TABLE public.compra_carga ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compra_carga_select ON public.compra_carga;
CREATE POLICY compra_carga_select ON public.compra_carga FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view')));
-- Sin policies de escritura: escribe sólo la edge function con la llave del servidor.
