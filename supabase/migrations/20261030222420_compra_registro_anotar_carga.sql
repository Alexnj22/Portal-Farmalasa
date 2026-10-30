SET lock_timeout = '5s';

-- La anotación pasa a una función por carga: así el trigger y la siembra de
-- la única carga ya confirmada usan EXACTAMENTE el mismo armado.
CREATE OR REPLACE FUNCTION public.compra_registro_anotar_carga(p_carga_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
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
    lote, vence, vence_pendiente, reparto, cargado_por, cargado_at)
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
         nullif(l->>'numero_lote', ''),
         CASE WHEN l->>'vence' ~ '^\d{4}-\d{2}-\d{2}$' THEN (l->>'vence')::date END,
         coalesce((r->>'vence_pendiente')::boolean, false),
         (SELECT jsonb_object_agg(x->>'branch_id', (x->>'paquetes')::numeric * (x->>'unidad')::numeric)
            FROM jsonb_array_elements(coalesce(c.revision->'reparto', '[]')) x
           WHERE (x->>'renglon')::int = (r->>'renglon')::int),
         v_emp, c.updated_at
    FROM jsonb_array_elements(coalesce(c.revision->'renglones', '[]')) r
    CROSS JOIN LATERAL (SELECT r->'linea' AS l) z
   WHERE jsonb_typeof(r->'linea') = 'object'
  ON CONFLICT (carga_id, renglon) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_registro_anotar_carga(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compra_registro_anotar_carga(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.compra_registro_anotar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NEW.estado = 'verificada' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'verificada') THEN
    PERFORM public.compra_registro_anotar_carga(NEW.id);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_registro_anotar() FROM PUBLIC, anon, authenticated;

-- La única carga del portal ya confirmada (Imberton, 29-oct).
SELECT public.compra_registro_anotar_carga(id) FROM public.compra_carga WHERE estado = 'verificada';
