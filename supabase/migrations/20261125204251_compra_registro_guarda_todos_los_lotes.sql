-- El registro de compras guarda TODOS los lotes de un renglón (2026-11-25).
--
-- Desde v2.1599.0 un renglón de la factura puede entrar en varios lotes
-- (`revision.renglones[].lotes`), pero `compra_registro_anotar_carga` leía sólo
-- `linea` —la línea entera, con el lote del primero— y perdía el resto. La
-- compra 6729 (carga 595) quedó con 240 u. del lote 2602219 cuando eran 96 de
-- ése y 144 del 2605034. El sistema sí los recibió bien.
--
-- Una fila por renglón se mantiene (llegaron, notas y por-llegar son por
-- renglón): el desglose va en `lotes` [{lote, vence, unidades}], null cuando el
-- renglón es de un solo lote.
SET lock_timeout = '5s';

ALTER TABLE public.compra_registro ADD COLUMN IF NOT EXISTS lotes jsonb;
COMMENT ON COLUMN public.compra_registro.lotes IS
  'Desglose cuando el renglón entró en más de un lote: [{lote, vence, unidades}]. Null = un solo lote (lote/vence de la fila).';

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
    descuento_nota, regalo_nota, lotes)
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
         nullif(r->>'rebaja_nota', '')::numeric, nullif(r->>'regalo_nota', '')::numeric,
         CASE WHEN (CASE WHEN jsonb_typeof(r->'lotes') = 'array' THEN jsonb_array_length(r->'lotes') ELSE 0 END) > 1 THEN r->'lotes' END
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

-- «Cuadra con el sistema»: un renglón en varios lotes llega en la copia como
-- una fila por lote, así que se compara la suma del producto en esa compra.
CREATE OR REPLACE FUNCTION public.get_compra_registro_json(p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
                                    AND (abs(i.cantidad - g.unidades) < 0.001 OR abs(i.cantidad - g.cantidad) < 0.001)
                                    AND abs(i.total_linea - round(g.cantidad * g.costo, 2)) <= 0.02) THEN 'cuadra'
                    WHEN g.lotes IS NOT NULL AND EXISTS (
                           SELECT 1 FROM public.purchase_receipt_items i
                            WHERE i.receipt_id = pr.id AND i.erp_product_id = g.erp_product_id
                           HAVING abs(sum(i.cantidad) - g.unidades) < 0.001
                              AND abs(sum(i.total_linea) - round(g.cantidad * g.costo, 2)) <= 0.02) THEN 'cuadra'
                    ELSE 'difiere' END AS en_sistema
          FROM public.compra_registro g
          LEFT JOIN public.employees e ON e.id = g.cargado_por
          LEFT JOIN LATERAL (SELECT pr.id FROM public.purchase_receipts pr
                              WHERE pr.erp_purchase_id = g.erp_compra_id AND pr.branch_id = 30 LIMIT 1) pr ON true
         WHERE g.fecha_documento BETWEEN p_desde AND p_hasta
      ) t
  );
END $function$;

-- La fila que ya se escribió sin el desglose (carga 595, compra 6729). El
-- registro es inmutable por trigger: se suspende sólo para esta corrección,
-- que completa `lotes` donde estaba vacío con lo que dice la propia carga.
ALTER TABLE public.compra_registro DISABLE TRIGGER compra_registro_inmutable;
UPDATE public.compra_registro g
   SET lotes = r->'lotes'
  FROM public.compra_carga c
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.revision->'renglones') = 'array'
                                               THEN c.revision->'renglones' ELSE '[]'::jsonb END) r
 WHERE c.id = g.carga_id AND c.estado = 'verificada'
   AND (r->>'renglon')::int = g.renglon
   AND (CASE WHEN jsonb_typeof(r->'lotes') = 'array' THEN jsonb_array_length(r->'lotes') ELSE 0 END) > 1
   AND g.lotes IS NULL;
ALTER TABLE public.compra_registro ENABLE TRIGGER compra_registro_inmutable;
