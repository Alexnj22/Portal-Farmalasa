SET lock_timeout = '5s';

-- Una factura que el proveedor anuló con una nota de crédito por el total no
-- se carga. RONASA lo hace seguido (226C02B8, $206.77, NC del 19-oct).
ALTER TABLE public.compra_documento_resuelto DROP CONSTRAINT IF EXISTS compra_documento_resuelto_motivo_check;
ALTER TABLE public.compra_documento_resuelto
  ADD CONSTRAINT compra_documento_resuelto_motivo_check
  CHECK (motivo = ANY (ARRAY['cargada_a_mano', 'no_va_a_bodega', 'anulada_nc']));

CREATE OR REPLACE FUNCTION public.compra_resolver_documento(p_document_id bigint, p_motivo text, p_receipt_id integer DEFAULT NULL::integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_doc public.purchase_dte_documents%ROWTYPE;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras', 'facturas_compra', 'cargar_compra']) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_doc FROM public.purchase_dte_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento % no existe', p_document_id; END IF;

  IF p_motivo = 'proveedor_no_va' THEN
    IF v_doc.emisor_nit IS NULL THEN RAISE EXCEPTION 'El documento no trae NIT del emisor'; END IF;
    INSERT INTO public.compra_proveedor_no_va_a_bodega (nit, nombre, creado_por)
    VALUES (v_doc.emisor_nit, v_doc.emisor_nombre, public.auth_employee_id())
    ON CONFLICT (nit) DO NOTHING;
    RETURN json_build_object('ok', true, 'proveedor', v_doc.emisor_nombre);
  END IF;

  IF p_motivo NOT IN ('cargada_a_mano', 'no_va_a_bodega', 'anulada_nc') THEN
    RAISE EXCEPTION 'Motivo desconocido: %', p_motivo;
  END IF;
  IF p_motivo = 'cargada_a_mano' AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts WHERE id = p_receipt_id) THEN
    RAISE EXCEPTION 'La compra % no existe', p_receipt_id;
  END IF;

  INSERT INTO public.compra_documento_resuelto (document_id, motivo, purchase_receipt_id, creado_por)
  VALUES (p_document_id, p_motivo, CASE WHEN p_motivo = 'cargada_a_mano' THEN p_receipt_id END,
          public.auth_employee_id())
  ON CONFLICT (document_id) DO UPDATE
     SET motivo = EXCLUDED.motivo, purchase_receipt_id = EXCLUDED.purchase_receipt_id,
         creado_por = EXCLUDED.creado_por, created_at = now();
  RETURN json_build_object('ok', true);
END $function$;

-- Deshacer también vale para «está anulada».
CREATE OR REPLACE FUNCTION public.compra_devolver_documento(p_document_id bigint, p_proveedor boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_doc public.purchase_dte_documents%ROWTYPE;
  n int := 0;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras', 'facturas_compra', 'cargar_compra']) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_doc FROM public.purchase_dte_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento % no existe', p_document_id; END IF;
  IF p_proveedor THEN
    DELETE FROM public.compra_proveedor_no_va_a_bodega WHERE nit = v_doc.emisor_nit;
  ELSE
    DELETE FROM public.compra_documento_resuelto
     WHERE document_id = p_document_id AND motivo IN ('no_va_a_bodega', 'anulada_nc');
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('ok', n > 0);
END $$;

CREATE OR REPLACE FUNCTION public.get_documentos_sin_cargar(p_dias integer DEFAULT 30)
 RETURNS TABLE(document_id bigint, fecha_emision date, emisor_nombre text, emisor_nit text, codigo_generacion text, numero_control text, monto_total numeric, renglones integer, tiene_pdf boolean, proveedor_ficha text, dias_desde integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
  WITH recibos AS MATERIALIZED (
    SELECT pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0')) AS num
      FROM public.purchase_receipts pr
     WHERE coalesce(pr.estado,'') <> 'anulada'
  ), prefijos AS MATERIALIZED (
    SELECT DISTINCT left(num, 12) AS p FROM recibos WHERE length(num) >= 12 AND num LIKE '%-%'
  ), hoy AS MATERIALIZED (
    SELECT (now() AT TIME ZONE 'America/El_Salvador')::date AS d
  )
  SELECT d.id, d.fecha_emision, d.emisor_nombre, d.emisor_nit,
         d.codigo_generacion::text, d.numero_control, d.monto_total,
         coalesce(array_length(string_to_array(d.items_text, ' | '), 1), 0)::integer,
         d.pdf_path IS NOT NULL,
         (SELECT m.nombre FROM public.proveedores_maestro m
           WHERE m.nit = d.emisor_nit ORDER BY m.id LIMIT 1),
         ((SELECT h.d FROM hoy h) - d.fecha_emision)::integer
    FROM public.purchase_dte_documents d
   WHERE NOT d.invalidado
     AND d.tipo_dte IN ('01','03')
     AND d.json_path IS NOT NULL
     AND d.fecha_emision >= (SELECT h.d FROM hoy h) - coalesce(p_dias, 30)
     AND (SELECT auth_has_module_permission('compras','can_view')
           OR auth_has_module_permission('facturas_compra','can_view')
           OR auth_has_module_permission('cargar_compra','can_view'))
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE d.sello_recibido IS NOT NULL AND r.sello_recibido = d.sello_recibido)
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE r.num = left(upper(d.codigo_generacion::text), 20))
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE r.num = left(replace(upper(d.codigo_generacion::text), '-', ''), 20))
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE r.num = upper(d.codigo_generacion::text))
     AND NOT EXISTS (SELECT 1 FROM prefijos x
                      WHERE x.p = left(upper(d.codigo_generacion::text), 12))
     AND NOT EXISTS (SELECT 1 FROM public.compra_documento_resuelto x WHERE x.document_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM public.compra_proveedor_no_va_a_bodega x WHERE x.nit = d.emisor_nit)
     -- Anulada por el proveedor (2026-10-30): sus notas de crédito LIGADAS a
     -- esta factura suman el total. Una parcial (devolución) no la saca.
     AND coalesce((SELECT sum(n.monto_total) FROM public.purchase_dte_documents n
                    WHERE n.documento_relacionado_id = d.id AND n.tipo_dte = '05' AND NOT n.invalidado), 0)
         < d.monto_total - 0.02
   ORDER BY d.fecha_emision DESC, d.id DESC;
$function$;

-- Pistas: + `nota_credito`. Ligada y parcial → aviso; sin ligar y por el
-- mismo total (RONASA escribe «CCF 22094» en vez del código) → «parece anulada».
CREATE OR REPLACE FUNCTION public.get_pistas_documentos_sin_cargar(p_ids bigint[])
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
  WITH docs AS (
    SELECT d.id, d.fecha_emision, d.monto_total, d.emisor_nit, upper(d.emisor_nombre) AS nom
      FROM public.purchase_dte_documents d
     WHERE d.id = ANY (p_ids)
       AND (SELECT public.auth_has_module_permission('compras', 'can_view')
             OR public.auth_has_module_permission('facturas_compra', 'can_view')
             OR public.auth_has_module_permission('cargar_compra', 'can_view'))
  ),
  pares AS (
    SELECT d.id AS document_id, pr.id AS receipt_id, pr.erp_sucursal_id, pr.branch_id,
           pr.documento_numero, pr.fecha, pr.total, pr.proveedor,
           abs(pr.fecha - d.fecha_emision) AS dist
      FROM docs d
      JOIN public.purchase_receipts pr
        ON abs(pr.total - d.monto_total) <= 0.05
       AND pr.fecha BETWEEN d.fecha_emision - 5 AND d.fecha_emision + 60
       AND coalesce(pr.estado, '') <> 'anulada'
     WHERE (EXISTS (SELECT 1 FROM public.proveedores_maestro m
                     WHERE m.supplier_id = pr.supplier_id AND m.nit = d.emisor_nit)
            OR similarity(upper(pr.proveedor), d.nom) > 0.3)
       AND NOT EXISTS (SELECT 1 FROM public.compra_documento_resuelto x
                        WHERE x.purchase_receipt_id = pr.id)
  ),
  rank AS (
    SELECT p.*,
           row_number() OVER (PARTITION BY receipt_id  ORDER BY dist, document_id) AS r_compra,
           row_number() OVER (PARTITION BY document_id ORDER BY dist, receipt_id)  AS r_doc
      FROM pares p
  ),
  sugerida AS (SELECT * FROM rank WHERE r_compra = 1 AND r_doc = 1)
  SELECT coalesce(json_agg(json_build_object(
           'document_id', d.id,
           'compra', CASE WHEN s.receipt_id IS NULL THEN NULL ELSE json_build_object(
              'id', s.receipt_id, 'erp_id', s.erp_sucursal_id, 'sucursal', b.name,
              'numero', s.documento_numero, 'fecha', s.fecha, 'total', s.total) END,
           'gasto', (SELECT c.nombre FROM public.proveedores_maestro m
                       JOIN public.proveedores_categorias c ON c.id = m.categoria_id
                      WHERE m.nit = d.emisor_nit AND c.clase LIKE 'gasto%'
                      ORDER BY m.id LIMIT 1),
           'nota_credito', coalesce(
              (SELECT json_build_object('id', n.id, 'fecha', n.fecha_emision, 'total', n.monto_total, 'ligada', true)
                 FROM public.purchase_dte_documents n
                WHERE n.documento_relacionado_id = d.id AND n.tipo_dte = '05' AND NOT n.invalidado
                ORDER BY n.fecha_emision DESC LIMIT 1),
              (SELECT json_build_object('id', n.id, 'fecha', n.fecha_emision, 'total', n.monto_total, 'ligada', false)
                 FROM public.purchase_dte_documents n
                WHERE n.emisor_nit = d.emisor_nit AND n.tipo_dte = '05' AND NOT n.invalidado
                  AND n.documento_relacionado_id IS NULL
                  AND abs(n.monto_total - d.monto_total) <= 0.02
                  AND n.fecha_emision BETWEEN d.fecha_emision AND d.fecha_emision + 20
                ORDER BY n.fecha_emision - d.fecha_emision, n.id LIMIT 1)))), '[]'::json)
    FROM docs d
    LEFT JOIN sugerida s ON s.document_id = d.id
    LEFT JOIN public.branches b ON b.id = s.branch_id;
$function$;
