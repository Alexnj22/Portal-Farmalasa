-- El diccionario que aprende: (proveedor, su código) → nuestro producto.
--
-- Medido antes de escribirlo (`docs/AUDITORIA-MATCH-DTE-PRODUCTOS-2026-08-16.md`):
--
--   · El nombre NO sirve solo. El proveedor escribe «SOL OFT» donde nosotros
--     «GOTAS» y `2%` donde nosotros `0.2%`; el parecido de nombre acierta 91.5%
--     entre 0.45 y 0.75, o sea una de cada doce líneas al inventario equivocado.
--   · El código del proveedor SÍ es una llave: 1,056 códigos anclados con el
--     código de barras y **cero ambiguos**, y el 87% de las líneas usan un
--     código que se repite. Se aprende una vez y sirve para siempre.
--   · El NIT va en la llave porque **el 31.3% de los productos se compran a más
--     de un proveedor** (1,180 de 3,774, hasta 5 proveedores distintos), y cada
--     uno lo numera y lo nombra a su manera.
--
-- LO QUE NO HACE: aprender de lo que adivinó el parecido de nombre. Se siembra
-- con lo que confirmó una persona y con lo que resolvió el código de barras;
-- si aprendiera de sus propias adivinanzas, un error se volvería permanente.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.compra_producto_alias (
    id                bigserial PRIMARY KEY,
    emisor_nit        text    NOT NULL,
    codigo_proveedor  text    NOT NULL,
    product_id        integer NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    -- De dónde salió: 'confirmado' (una persona lo dijo) o 'codigo_barras'
    -- (lo resolvió el EAN del documento). NUNCA 'parecido'.
    origen            text    NOT NULL DEFAULT 'confirmado'
                              CHECK (origen IN ('confirmado', 'codigo_barras')),
    confirmado_por    uuid    REFERENCES public.employees(id),
    veces_usado       integer NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- La llave del diccionario. Un código de un proveedor apunta a UN producto.
CREATE UNIQUE INDEX IF NOT EXISTS compra_producto_alias_llave
    ON public.compra_producto_alias (emisor_nit, codigo_proveedor);
CREATE INDEX IF NOT EXISTS compra_producto_alias_product_idx
    ON public.compra_producto_alias (product_id);

ALTER TABLE public.compra_producto_alias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compra_producto_alias_select ON public.compra_producto_alias;
CREATE POLICY compra_producto_alias_select ON public.compra_producto_alias
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('compras', 'can_view'))
        OR (SELECT public.auth_has_module_permission('facturas_compra', 'can_view')));

DROP POLICY IF EXISTS compra_producto_alias_write ON public.compra_producto_alias;
CREATE POLICY compra_producto_alias_write ON public.compra_producto_alias
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['compras', 'facturas_compra'])));

DROP POLICY IF EXISTS compra_producto_alias_update ON public.compra_producto_alias;
CREATE POLICY compra_producto_alias_update ON public.compra_producto_alias
    FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['compras', 'facturas_compra'])));

COMMENT ON TABLE public.compra_producto_alias IS
    'Diccionario aprendido para cargar compras desde el DTE: (NIT del proveedor, su código de producto) → nuestro producto. Se siembra con confirmaciones humanas y con lo que resuelve el código de barras; nunca con lo que adivinó el parecido de nombre.';

-- ── El emparejador ──────────────────────────────────────────────────────────
-- La cascada, en el orden que dio la medición y con su precisión al lado:
--   1. código de barras del documento  → 99.8%
--   2. diccionario aprendido           → llave exacta
--   3. parecido de nombre              → 99.1% sobre 0.75, y se cae rápido
--      debajo de eso, así que sale con su número para que la pantalla decida
--      si pregunta.
CREATE OR REPLACE FUNCTION public.emparejar_producto_dte(
    p_emisor_nit  text,
    p_codigo_prov text,
    p_texto       text
)
RETURNS TABLE (product_id integer, nombre text, origen text, similitud real)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id  integer;
  v_nom text;
BEGIN
  -- 1. Código de barras: cualquier corrida de 12 a 14 dígitos del texto que
  --    exista en el catálogo. Los 4,708 códigos de barras son únicos, así que
  --    no hay ambigüedad que resolver.
  SELECT p.id, p.nombre INTO v_id, v_nom
    FROM regexp_matches(coalesce(p_texto, ''), '(\d{12,14})', 'g') m
    JOIN public.products p ON p.codigo_barras = m[1]
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, v_nom, 'codigo_barras'::text, 1.0::real;
    RETURN;
  END IF;

  -- 2. El diccionario.
  IF p_codigo_prov IS NOT NULL AND p_emisor_nit IS NOT NULL THEN
    SELECT a.product_id, p.nombre INTO v_id, v_nom
      FROM public.compra_producto_alias a
      JOIN public.products p ON p.id = a.product_id
     WHERE a.emisor_nit = p_emisor_nit AND a.codigo_proveedor = p_codigo_prov;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, v_nom, 'aprendido'::text, 1.0::real;
      RETURN;
    END IF;
  END IF;

  -- 3. El parecido, con su número. Sin `LIMIT 1` a ciegas: si el mejor no
  --    llega al piso del índice de trigramas, no hay candidato y se dice.
  RETURN QUERY
    SELECT p.id, p.nombre, 'parecido'::text,
           similarity(p.nombre_norm, public.norm_search(p_texto))
      FROM public.products p
     WHERE p.nombre_norm % public.norm_search(p_texto)
     ORDER BY similarity(p.nombre_norm, public.norm_search(p_texto)) DESC, p.id
     LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emparejar_producto_dte(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.emparejar_producto_dte(text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.emparejar_producto_dte(text, text, text) IS
    'Producto de un renglón de DTE de compra: código de barras (99.8% medido) → diccionario aprendido → parecido de nombre con su similitud. El llamador decide si el parecido alcanza para no preguntar.';
