SET lock_timeout = '5s';

-- Regalías por proveedor y producto (2026-11-25). Vijosa factura todas las
-- unidades al precio lleno y manda las de regalo (26+4, 100+20…) en una nota
-- de crédito aparte. Con el nivel anotado, «Cargar compra» reparte esa nota en
-- el costo de cada producto como lo hace Bodega a mano
-- (`repartirNotaDeDescuento` en _shared/compraSobre.ts).
-- La clave es el código del PROVEEDOR (el de la factura): se conoce antes de
-- elegir el producto del catálogo.
CREATE TABLE IF NOT EXISTS public.compra_regalia (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proveedor_nit text NOT NULL,
  codigo_proveedor text NOT NULL CHECK (codigo_proveedor = upper(btrim(codigo_proveedor)) AND codigo_proveedor <> ''),
  descripcion text,
  compra integer NOT NULL CHECK (compra > 0),
  regalo integer NOT NULL CHECK (regalo > 0),
  actualizado_por uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proveedor_nit, codigo_proveedor)
);
ALTER TABLE public.compra_regalia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compra_regalia_select ON public.compra_regalia;
CREATE POLICY compra_regalia_select ON public.compra_regalia FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('compras', 'can_view'))
      OR (SELECT public.auth_has_module_permission('facturas_compra', 'can_view'))
      OR (SELECT public.auth_has_module_permission('cargar_compra', 'can_view')));
REVOKE ALL ON public.compra_regalia FROM anon;
GRANT SELECT ON public.compra_regalia TO authenticated;

-- Guardar o quitar (compra o regalo nulos) un nivel. Sólo quien carga compras.
CREATE OR REPLACE FUNCTION public.compra_guardar_regalia(
  p_nit text, p_codigo text, p_compra integer, p_regalo integer, p_descripcion text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_cod text := upper(btrim(coalesce(p_codigo, '')));
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras', 'facturas_compra', 'cargar_compra']) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_nit), '') = '' OR v_cod = '' THEN RAISE EXCEPTION 'Falta el proveedor o el código del producto.'; END IF;
  IF p_compra IS NULL OR p_regalo IS NULL THEN
    DELETE FROM public.compra_regalia WHERE proveedor_nit = btrim(p_nit) AND codigo_proveedor = v_cod;
    RETURN json_build_object('ok', true, 'quitada', true);
  END IF;
  IF p_compra <= 0 OR p_regalo <= 0 THEN RAISE EXCEPTION 'La regalía se escribe como compra + regalo, los dos mayores que cero.'; END IF;
  INSERT INTO public.compra_regalia (proveedor_nit, codigo_proveedor, descripcion, compra, regalo, actualizado_por)
  VALUES (btrim(p_nit), v_cod, nullif(btrim(p_descripcion), ''), p_compra, p_regalo, public.auth_employee_id())
  ON CONFLICT (proveedor_nit, codigo_proveedor) DO UPDATE
    SET compra = EXCLUDED.compra, regalo = EXCLUDED.regalo,
        descripcion = coalesce(EXCLUDED.descripcion, compra_regalia.descripcion),
        actualizado_por = EXCLUDED.actualizado_por, updated_at = now();
  RETURN json_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_guardar_regalia(text, text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_guardar_regalia(text, text, integer, integer, text) TO authenticated, service_role;

-- El registro guarda cuánto de la nota de descuento llevó cada producto y
-- cuántas unidades de regalo se le contaron.
ALTER TABLE public.compra_registro ADD COLUMN IF NOT EXISTS descuento_nota numeric;
ALTER TABLE public.compra_registro ADD COLUMN IF NOT EXISTS regalo_nota numeric;

CREATE OR REPLACE FUNCTION public.compra_registro_anotar_carga(p_carga_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c public.compra_carga%ROWTYPE;
  v_fecha date; v_tipo text; v_num text; v_ctrl text; v_nit text; v_nom text;
  v_emp uuid; n integer;
BEGIN
  SELECT * INTO c FROM public.compra_carga WHERE id = p_carga_id;
  IF NOT FOUND OR c.estado <> 'verificada' THEN RETURN 0; END IF;

  IF c.manual_id IS NOT NULL THEN
    SELECT m.fecha_emision, m.tipo_doc, coalesce(nullif(m.serie, '') || '-', '') || m.numero, NULL, m.proveedor_nit, m.proveedor_nombre
      INTO v_fecha, v_tipo, v_num, v_ctrl, v_nit, v_nom
      FROM public.compra_documento_manual m WHERE m.id = c.manual_id;
  ELSE
    SELECT d.fecha_emision, CASE d.tipo_dte WHEN '03' THEN 'CCF' WHEN '01' THEN 'FAC' ELSE d.tipo_dte END,
           d.codigo_generacion::text, d.numero_control, d.emisor_nit, d.emisor_nombre
      INTO v_fecha, v_tipo, v_num, v_ctrl, v_nit, v_nom
      FROM public.purchase_dte_documents d WHERE d.id = c.document_id;
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = c.creado_por
      OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l WHERE l.auth_user_id = c.creado_por)
   ORDER BY (e.id = c.creado_por) DESC LIMIT 1;

  INSERT INTO public.compra_registro (
    carga_id, renglon, erp_compra_id, document_id, manual_id,
    fecha_documento, tipo_documento, numero_documento, numero_control, proveedor_nit, proveedor_nombre,
    uso, tipo, erp_product_id, producto, codigo_proveedor, descripcion_proveedor,
    id_presentacion, presentacion, unidades_por_presentacion, cantidad, unidades,
    precio_lista, descuento_renglon, descuento_pie_pct,
    costo, costo_unidad, costo_anterior, vineta, vineta_anterior,
    lote, vence, vence_pendiente, reparto, cargado_por, cargado_at, llegaron,
    descuento_nota, regalo_nota)
  SELECT c.id, (r->>'renglon')::int, c.erp_compra_id, c.document_id, c.manual_id,
         v_fecha, v_tipo, v_num, v_ctrl, v_nit, v_nom,
         c.uso,
         CASE WHEN l->>'bandera' = 'SERVICIO' THEN 'consumo'
              WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(c.revision->'erroneos', '[]')) e
                            WHERE (e->>'renglon')::int = (r->>'renglon')::int) THEN 'erroneo'
              WHEN coalesce((r->>'regalo')::boolean, false) THEN 'regalo'
              ELSE 'producto' END,
         CASE WHEN l->>'id_producto' ~ '^\d+$' THEN (l->>'id_producto')::int END,
         (SELECT p.nombre FROM public.products p
           WHERE l->>'id_producto' ~ '^\d+$' AND p.id = (l->>'id_producto')::int),
         r->>'codigo_proveedor', r->>'descripcion',
         l->>'id_presentacion', r->>'presentacion_nombre',
         nullif(l->>'unidad', '')::numeric, nullif(l->>'cant', '')::numeric,
         nullif(l->>'cant', '')::numeric * coalesce(nullif(l->>'unidad', '')::numeric, 1),
         (r->>'precio_lista')::numeric, (r->>'descuento_renglon')::numeric, (r->>'descuento_pie_pct')::numeric,
         nullif(l->>'compra', '')::numeric,
         round(nullif(l->>'compra', '')::numeric / coalesce(nullif(nullif(l->>'unidad', '')::numeric, 0), 1), 6),
         (r->>'costo_anterior')::numeric,
         CASE WHEN l->>'bandera' = 'PRODUCTO' THEN nullif(l->>'venta', '')::numeric END,
         (r->>'venta_anterior')::numeric,
         coalesce(nullif(l->>'numero_lote', ''), nullif(r->>'lote_leido', '')),
         CASE WHEN l->>'vence' ~ '^\d{4}-\d{2}-\d{2}$' THEN (l->>'vence')::date END,
         coalesce((r->>'vence_pendiente')::boolean, false),
         (SELECT jsonb_object_agg(x->>'branch_id', (x->>'paquetes')::numeric * (x->>'unidad')::numeric)
            FROM jsonb_array_elements(coalesce(c.revision->'reparto', '[]')) x
           WHERE (x->>'renglon')::int = (r->>'renglon')::int),
         v_emp, c.updated_at, nullif(r->>'llegaron', '')::numeric,
         nullif(r->>'rebaja_nota', '')::numeric, nullif(r->>'regalo_nota', '')::numeric
    FROM jsonb_array_elements(coalesce(c.revision->'renglones', '[]')) r
    CROSS JOIN LATERAL (SELECT r->'linea' AS l) z
   WHERE jsonb_typeof(r->'linea') = 'object'
  ON CONFLICT (carga_id, renglon) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.compra_por_llegar (registro_id, carga_id, faltan)
  SELECT g.id, g.carga_id, g.unidades - g.llegaron
    FROM public.compra_registro g
   WHERE g.carga_id = c.id AND g.llegaron IS NOT NULL AND g.unidades > g.llegaron
  ON CONFLICT (registro_id) DO NOTHING;
  RETURN n;
END $function$;
