SET lock_timeout = '5s';

-- ── Registro de compras (2026-10-30) ───────────────────────────────────────
-- Una fila por renglón de cada compra que el portal cargó y el sistema
-- CONFIRMÓ (compra_carga.estado = 'verificada'). Se escribe sola, con lo que
-- de verdad viajó; nadie la edita ni la borra. La carga entera (sobre y
-- revisión) sigue en compra_carga: carga_id es el ancla para auditar.
CREATE TABLE public.compra_registro (
  id                       bigserial PRIMARY KEY,
  created_at               timestamptz NOT NULL DEFAULT now(),
  carga_id                 bigint NOT NULL REFERENCES public.compra_carga(id),
  renglon                  integer NOT NULL,
  erp_compra_id            integer,
  document_id              bigint,
  manual_id                bigint,
  fecha_documento          date,
  tipo_documento           text,
  numero_documento         text,
  numero_control           text,
  proveedor_nit            text,
  proveedor_nombre         text,
  uso                      text,
  tipo                     text NOT NULL CHECK (tipo IN ('producto', 'regalo', 'erroneo', 'consumo')),
  erp_product_id           integer,
  producto                 text,
  codigo_proveedor         text,
  descripcion_proveedor    text,
  id_presentacion          text,
  presentacion             text,
  unidades_por_presentacion numeric,
  cantidad                 numeric,
  unidades                 numeric,
  precio_lista             numeric,
  descuento_renglon        numeric,
  descuento_pie_pct        numeric,
  costo                    numeric,
  costo_unidad             numeric,
  costo_anterior           numeric,
  vineta                   numeric,
  vineta_anterior          numeric,
  lote                     text,
  vence                    date,
  vence_pendiente          boolean,
  reparto                  jsonb,
  cargado_por              uuid,
  cargado_at               timestamptz,
  UNIQUE (carga_id, renglon)
);
CREATE INDEX compra_registro_fecha ON public.compra_registro (fecha_documento DESC);
CREATE INDEX compra_registro_producto ON public.compra_registro (erp_product_id);
CREATE INDEX compra_registro_proveedor ON public.compra_registro (proveedor_nit);

ALTER TABLE public.compra_registro ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_registro_select ON public.compra_registro FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))
      OR (SELECT public.auth_has_module_permission('compras', 'can_view')));
-- Sin policy de escritura: sólo la escribe el trigger.

-- Inmutable: ni el servidor la corrige a mano sin dejar rastro en una migración.
CREATE OR REPLACE FUNCTION public.compra_registro_inmutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  RAISE EXCEPTION 'El registro de compras no se modifica ni se borra (fila %).', OLD.id;
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_registro_inmutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER compra_registro_inmutable BEFORE UPDATE OR DELETE ON public.compra_registro
  FOR EACH ROW EXECUTE FUNCTION public.compra_registro_inmutable();

-- Lo anota cuando la carga pasa a verificada (sea al enviar o al comprobarla después).
CREATE OR REPLACE FUNCTION public.compra_registro_anotar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_fecha date; v_tipo text; v_num text; v_ctrl text; v_nit text; v_nom text;
  v_emp uuid;
BEGIN
  IF NEW.estado <> 'verificada' OR (TG_OP = 'UPDATE' AND OLD.estado = 'verificada') THEN
    RETURN NEW;
  END IF;

  IF NEW.manual_id IS NOT NULL THEN
    SELECT m.fecha_emision, m.tipo_doc, coalesce(nullif(m.serie, '') || '-', '') || m.numero, NULL, m.proveedor_nit, m.proveedor_nombre
      INTO v_fecha, v_tipo, v_num, v_ctrl, v_nit, v_nom
      FROM public.compra_documento_manual m WHERE m.id = NEW.manual_id;
  ELSE
    SELECT d.fecha_emision, CASE d.tipo_dte WHEN '03' THEN 'CCF' WHEN '01' THEN 'FAC' ELSE d.tipo_dte END,
           d.codigo_generacion::text, d.numero_control, d.emisor_nit, d.emisor_nombre
      INTO v_fecha, v_tipo, v_num, v_ctrl, v_nit, v_nom
      FROM public.purchase_dte_documents d WHERE d.id = NEW.document_id;
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = NEW.creado_por
      OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l WHERE l.auth_user_id = NEW.creado_por)
   ORDER BY (e.id = NEW.creado_por) DESC LIMIT 1;

  INSERT INTO public.compra_registro (
    carga_id, renglon, erp_compra_id, document_id, manual_id,
    fecha_documento, tipo_documento, numero_documento, numero_control, proveedor_nit, proveedor_nombre,
    uso, tipo, erp_product_id, producto, codigo_proveedor, descripcion_proveedor,
    id_presentacion, presentacion, unidades_por_presentacion, cantidad, unidades,
    precio_lista, descuento_renglon, descuento_pie_pct,
    costo, costo_unidad, costo_anterior, vineta, vineta_anterior,
    lote, vence, vence_pendiente, reparto, cargado_por, cargado_at)
  SELECT NEW.id, (r->>'renglon')::int, NEW.erp_compra_id, NEW.document_id, NEW.manual_id,
         v_fecha, v_tipo, v_num, v_ctrl, v_nit, v_nom,
         NEW.uso,
         CASE WHEN l->>'bandera' = 'SERVICIO' THEN 'consumo'
              WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(NEW.revision->'erroneos', '[]')) e
                            WHERE (e->>'renglon')::int = (r->>'renglon')::int) THEN 'erroneo'
              WHEN (r->>'regalo')::boolean THEN 'regalo'
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
            FROM jsonb_array_elements(coalesce(NEW.revision->'reparto', '[]')) x
           WHERE (x->>'renglon')::int = (r->>'renglon')::int),
         v_emp, NEW.updated_at
    FROM jsonb_array_elements(coalesce(NEW.revision->'renglones', '[]')) r
    CROSS JOIN LATERAL (SELECT r->'linea' AS l) z
   WHERE jsonb_typeof(r->'linea') = 'object'
  ON CONFLICT (carga_id, renglon) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_registro_anotar() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER compra_registro_anotar AFTER INSERT OR UPDATE OF estado ON public.compra_carga
  FOR EACH ROW EXECUTE FUNCTION public.compra_registro_anotar();

-- La lectura: un rango de fechas, con el cruce contra la copia de las compras
-- del sistema (cantidad y costo del mismo producto en esa misma compra).
CREATE OR REPLACE FUNCTION public.get_compra_registro_json(p_desde date, p_hasta date)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))
       OR (SELECT public.auth_has_module_permission('compras', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(json_agg(to_json(t) ORDER BY t.fecha_documento DESC, t.carga_id DESC, t.renglon), '[]'::json)
      FROM (
        SELECT g.*, e.name AS cargado_por_nombre,
               CASE WHEN g.tipo = 'consumo' OR g.erp_compra_id IS NULL THEN NULL
                    WHEN pr.id IS NULL THEN 'sin_copia'
                    WHEN EXISTS (SELECT 1 FROM public.purchase_receipt_items i
                                  WHERE i.receipt_id = pr.id AND i.erp_product_id = g.erp_product_id
                                    AND abs(i.cantidad - g.cantidad) < 0.001
                                    AND abs(i.precio_unitario - g.costo) < 0.0002) THEN 'cuadra'
                    ELSE 'difiere' END AS en_sistema
          FROM public.compra_registro g
          LEFT JOIN public.employees e ON e.id = g.cargado_por
          LEFT JOIN LATERAL (SELECT pr.id FROM public.purchase_receipts pr
                              WHERE pr.erp_purchase_id = g.erp_compra_id AND pr.branch_id = 30 LIMIT 1) pr ON true
         WHERE g.fecha_documento BETWEEN p_desde AND p_hasta
      ) t
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.get_compra_registro_json(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_compra_registro_json(date, date) TO authenticated, service_role;

-- La única compra que el portal ya cargó y el sistema confirmó (Imberton, 29-oct).
UPDATE public.compra_carga SET estado = estado WHERE estado = 'verificada';
