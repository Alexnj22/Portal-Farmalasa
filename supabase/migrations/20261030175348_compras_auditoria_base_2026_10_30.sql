SET lock_timeout = '5s';

-- Auditoría del módulo Cargar compra (2026-10-30), parte de la base.

-- 1. La cola de 180 días ya pasa de 1000 documentos (medido: ~1,015) y una
-- función SETOF se corta ahí en silencio — perdiendo justo las más viejas.
-- Envoltura json (patrón C). La fecha, en hora de El Salvador.
CREATE OR REPLACE FUNCTION public.get_documentos_sin_cargar(p_dias integer DEFAULT 30)
 RETURNS TABLE(document_id bigint, fecha_emision date, emisor_nombre text, emisor_nit text, codigo_generacion text, numero_control text, monto_total numeric, renglones integer, tiene_pdf boolean, proveedor_ficha text, dias_desde integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH recibos AS MATERIALIZED (
    -- La normalización del número se paga UNA vez por recibo, no una vez por
    -- par documento×recibo. Es la mitad del arreglo.
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
     -- Las cuatro ramas del OR original, una por NOT EXISTS. Cada una es una
     -- igualdad simple, o sea hasheable.
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
     -- Lo que una persona ya resolvió (2026-10-30): este documento, o todo lo
     -- de este proveedor.
     AND NOT EXISTS (SELECT 1 FROM public.compra_documento_resuelto x WHERE x.document_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM public.compra_proveedor_no_va_a_bodega x WHERE x.nit = d.emisor_nit)
   ORDER BY d.fecha_emision DESC, d.id DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_documentos_sin_cargar_json(p_dias integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN (SELECT coalesce(json_agg(to_json(t)), '[]'::json) FROM public.get_documentos_sin_cargar(p_dias) t);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_documentos_sin_cargar_json(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_documentos_sin_cargar_json(integer) TO authenticated, service_role;

-- 2. Quien usa la cola (Jefe/a de Compras: tiene `cargar_compra`, no `compras`)
-- recibía FORBIDDEN al sacar un documento de la cola.
CREATE OR REPLACE FUNCTION public.compra_resolver_documento(p_document_id bigint, p_motivo text, p_receipt_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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

  IF p_motivo NOT IN ('cargada_a_mano', 'no_va_a_bodega') THEN
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

CREATE OR REPLACE FUNCTION public.compra_deshacer_resolucion(p_document_id bigint, p_nit text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras', 'facturas_compra', 'cargar_compra']) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.compra_documento_resuelto WHERE document_id = p_document_id;
  IF p_nit IS NOT NULL THEN
    DELETE FROM public.compra_proveedor_no_va_a_bodega WHERE nit = p_nit;
  END IF;
  RETURN json_build_object('ok', true);
END $function$;

-- Las lecturas de la cola, con el módulo de quien la usa.
ALTER POLICY compra_documento_resuelto_select ON public.compra_documento_resuelto
  USING ((SELECT auth_has_module_permission('compras','can_view')) OR (SELECT auth_has_module_permission('facturas_compra','can_view'))
      OR (SELECT auth_has_module_permission('cargar_compra','can_view')));
ALTER POLICY compra_proveedor_no_va_a_bodega_select ON public.compra_proveedor_no_va_a_bodega
  USING ((SELECT auth_has_module_permission('compras','can_view')) OR (SELECT auth_has_module_permission('facturas_compra','can_view'))
      OR (SELECT auth_has_module_permission('cargar_compra','can_view')));
ALTER POLICY compra_producto_alias_select ON public.compra_producto_alias
  USING ((SELECT auth_has_module_permission('compras','can_view')) OR (SELECT auth_has_module_permission('facturas_compra','can_view'))
      OR (SELECT auth_has_module_permission('cargar_compra','can_view')));

-- 18. El diccionario se escribe sólo por `confirmar_alias_producto` (tope de
-- factor y firma). Las policies de escritura directa lo salteaban.
DROP POLICY IF EXISTS compra_producto_alias_update ON public.compra_producto_alias;
DROP POLICY IF EXISTS compra_producto_alias_write ON public.compra_producto_alias;

-- 3, 4, 11, 12. Pedido de fechas: un pedido vivo por factura Y sala; contesta
-- quien puede EDITAR traslados de esa sala (o de toda la red); el pedido exige
-- renglones bien formados y la respuesta, meses reales; el aviso va sólo a
-- quien puede contestar.
DROP INDEX IF EXISTS public.compra_pedido_vence_uno_vivo;
CREATE UNIQUE INDEX compra_pedido_vence_uno_vivo ON public.compra_pedido_vence (document_id, branch_id) WHERE estado = 'pendiente';

CREATE OR REPLACE FUNCTION public.compra_pedir_vence(p_document_id bigint, p_branch_id integer, p_renglones jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; v_doc record; v_quien uuid := auth_employee_id(); v_gente uuid[];
BEGIN
  IF NOT (SELECT auth_has_module_permission('cargar_compra','can_edit')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF jsonb_typeof(p_renglones) <> 'array' OR jsonb_array_length(p_renglones) = 0 THEN RAISE EXCEPTION 'No hay productos que pedir.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_renglones) r
              WHERE jsonb_typeof(r->'renglon') <> 'number' OR coalesce(btrim(r->>'descripcion'),'') = '')
     OR (SELECT count(DISTINCT r->>'renglon') FROM jsonb_array_elements(p_renglones) r) <> jsonb_array_length(p_renglones) THEN
    RAISE EXCEPTION 'Los productos del pedido vienen incompletos.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_sucursal_map WHERE branch_id = p_branch_id AND NOT es_bodega) THEN RAISE EXCEPTION 'Esa sala no existe.'; END IF;
  SELECT emisor_nombre, fecha_emision INTO v_doc FROM purchase_dte_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa factura no existe.'; END IF;
  INSERT INTO compra_pedido_vence (document_id, branch_id, emisor_nombre, fecha_emision, renglones, pedido_por)
  VALUES (p_document_id, p_branch_id, v_doc.emisor_nombre, v_doc.fecha_emision::date, p_renglones, v_quien)
  RETURNING id INTO v_id;
  SELECT array_agg(e.id) INTO v_gente
    FROM employees e JOIN role_permissions rp ON rp.role_id = e.role_id AND rp.module_key = 'traslados' AND rp.can_edit
   WHERE e.status = 'ACTIVO' AND e.branch_id = p_branch_id AND (e.tipo_ficha IS NULL OR e.tipo_ficha = 'empleado');
  IF v_gente IS NOT NULL THEN
    PERFORM notify_employees(v_gente, 'COMPRA_PEDIDO_VENCE',
      'Bodega te pide fechas de vencimiento',
      format('De la factura de %s: %s producto(s). Ponlas en Traslados → En camino.',
             coalesce(v_doc.emisor_nombre, 'un proveedor'), jsonb_array_length(p_renglones)),
      '/traslados?tab=recibir', jsonb_build_object('origen','cargar-compra','pedido', v_id), true, p_branch_id);
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ya hay un pedido de fechas abierto para esta factura en esa sala.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.compra_responder_vence(p_id bigint, p_respuestas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record; r jsonb; v_val text; v_mes date; v_limpias jsonb := '{}'::jsonb;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  SELECT * INTO v FROM compra_pedido_vence WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese pedido no existe.'; END IF;
  IF NOT ((SELECT auth_has_module_permission('traslados','can_edit'))
          AND ((SELECT auth_module_scope('traslados')) = 'ALL' OR v.branch_id = (SELECT auth_employee_branch_id())))
     AND NOT (SELECT auth_has_module_permission('cargar_compra','can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF v.estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese pedido ya se contestó.'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(v.renglones) LOOP
    v_val := p_respuestas ->> (r ->> 'renglon');
    IF v_val IS NULL OR v_val !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
      RAISE EXCEPTION 'Falta la fecha de «%».', r ->> 'descripcion';
    END IF;
    v_mes := to_date(v_val || '-01', 'YYYY-MM-DD');
    IF v_mes < date_trunc('month', v_hoy)::date THEN
      RAISE EXCEPTION '«%»: esa fecha ya pasó.', r ->> 'descripcion';
    END IF;
    IF v_mes > v_hoy + interval '10 years' THEN
      RAISE EXCEPTION '«%»: revisa el año de la fecha.', r ->> 'descripcion';
    END IF;
    v_limpias := v_limpias || jsonb_build_object(r ->> 'renglon', v_val);
  END LOOP;
  UPDATE compra_pedido_vence
     SET estado = 'respondido', respuestas = v_limpias, respondido_por = auth_employee_id(),
         respondido_at = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM notify_employees(ARRAY[v.pedido_por], 'COMPRA_PEDIDO_VENCE',
    'La sala contestó las fechas de vencimiento',
    format('Factura de %s: ya puedes cargarla.', coalesce(v.emisor_nombre, 'un proveedor')),
    '/cargar-compra', jsonb_build_object('origen','cargar-compra','pedido', p_id), true, v.branch_id);
END;
$function$;

-- 5, 14. Adjuntar/quitar una nota electrónica: no suelta una nota en papel
-- que ya está (o va) en el libro, y no acepta una nota invalidada.
CREATE OR REPLACE FUNCTION public.compra_erroneo_adjuntar_nota(p_id bigint, p_nota bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_e public.compra_renglon_erroneo; v_n public.purchase_dte_documents;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','cargar_compra']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_e FROM public.compra_renglon_erroneo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglón no existe.'; END IF;
  IF v_e.estado IN ('salio','saliendo') THEN RAISE EXCEPTION 'Ese producto ya salió o está saliendo.'; END IF;
  IF v_e.nota_papel_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.compra_nota_credito_papel
        WHERE id = v_e.nota_papel_id AND estado IN ('registrada','enviando','sin_verificar')) THEN
    RAISE EXCEPTION 'La nota en papel de este producto ya está en el libro de compras: no se puede cambiar.';
  END IF;
  IF p_nota IS NOT NULL THEN
    SELECT * INTO v_n FROM public.purchase_dte_documents WHERE id = p_nota;
    IF NOT FOUND OR v_n.tipo_dte <> '05' THEN RAISE EXCEPTION 'Eso no es una nota de crédito.'; END IF;
    IF coalesce(v_n.invalidado, false) THEN RAISE EXCEPTION 'Esa nota de crédito está anulada.'; END IF;
    IF v_n.emisor_nit IS DISTINCT FROM v_e.emisor_nit THEN RAISE EXCEPTION 'La nota es de otro proveedor.'; END IF;
  END IF;
  UPDATE public.compra_renglon_erroneo
     SET nota_credito_document_id = p_nota,
         nota_papel_id = NULL,
         estado = CASE WHEN p_nota IS NOT NULL THEN 'con_nota'
                       WHEN erp_traslado_id IS NOT NULL THEN 'en_vencidos' ELSE 'por_mover' END,
         updated_at = now()
   WHERE id = p_id;
END;
$function$;

-- 6. La nota en papel se reconoce por proveedor + serie + número, y una que ya
-- existe se reutiliza SÓLO si lo escrito coincide; nunca se reescribe una que
-- ya cubre a otro producto.
DROP INDEX IF EXISTS public.compra_nota_credito_papel_unica;
CREATE UNIQUE INDEX compra_nota_credito_papel_unica ON public.compra_nota_credito_papel (erp_supplier_id, serie, numero);
ALTER TABLE public.compra_nota_credito_papel ADD CONSTRAINT compra_nota_credito_papel_cuadra
  CHECK (abs(subtotal + iva - total) <= 0.02);

CREATE OR REPLACE FUNCTION public.compra_erroneo_adjuntar_nota_papel(p_id bigint, p_nota jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_e public.compra_renglon_erroneo;
  v_erp integer; v_nombre text;
  v_numero text := upper(regexp_replace(coalesce(p_nota->>'numero',''), '\s', '', 'g'));
  v_serie  text := upper(btrim(coalesce(p_nota->>'serie','')));
  v_fecha  date;
  v_sub numeric; v_iva numeric; v_tot numeric;
  v_id bigint; v_previa public.compra_nota_credito_papel;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','cargar_compra']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_e FROM public.compra_renglon_erroneo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglón no existe.'; END IF;
  IF v_e.estado IN ('salio','saliendo') THEN RAISE EXCEPTION 'Ese producto ya salió o está saliendo.'; END IF;
  IF v_e.nota_papel_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.compra_nota_credito_papel
        WHERE id = v_e.nota_papel_id AND estado IN ('registrada','enviando','sin_verificar')) THEN
    RAISE EXCEPTION 'La nota en papel de este producto ya está en el libro de compras: no se puede cambiar.';
  END IF;
  IF v_numero = '' OR v_numero !~ '^[A-Z0-9/-]+$' THEN RAISE EXCEPTION 'Falta el número de la nota (letras, números y guiones).'; END IF;
  IF v_serie = '' THEN RAISE EXCEPTION 'Falta la serie de la nota.'; END IF;
  BEGIN v_fecha := (p_nota->>'fecha')::date; EXCEPTION WHEN others THEN v_fecha := NULL; END;
  IF v_fecha IS NULL OR v_fecha > (now() AT TIME ZONE 'America/El_Salvador')::date THEN RAISE EXCEPTION 'Falta la fecha de la nota.'; END IF;
  BEGIN
    v_sub := round((p_nota->>'subtotal')::numeric, 2);
    v_iva := round((p_nota->>'iva')::numeric, 2);
    v_tot := round((p_nota->>'total')::numeric, 2);
  EXCEPTION WHEN others THEN v_sub := NULL; END;
  IF coalesce(v_sub,0) <= 0 OR coalesce(v_iva,0) <= 0 OR coalesce(v_tot,0) <= 0 THEN RAISE EXCEPTION 'Faltan los montos de la nota (subtotal, IVA y total).'; END IF;
  IF abs(v_sub + v_iva - v_tot) > 0.02 THEN RAISE EXCEPTION 'Subtotal más IVA no da el total de la nota.'; END IF;

  SELECT s.erp_supplier_id, pm.nombre INTO v_erp, v_nombre
    FROM public.proveedores_maestro pm JOIN public.suppliers s ON s.id = pm.supplier_id
   WHERE pm.nit = v_e.emisor_nit;
  IF v_erp IS NULL THEN RAISE EXCEPTION 'El proveedor no está en el catálogo de proveedores.'; END IF;

  SELECT * INTO v_previa FROM public.compra_nota_credito_papel
   WHERE erp_supplier_id = v_erp AND serie = v_serie AND numero = v_numero FOR UPDATE;
  IF FOUND THEN
    IF v_previa.fecha = v_fecha AND v_previa.total = v_tot AND v_previa.subtotal = v_sub AND v_previa.iva = v_iva THEN
      v_id := v_previa.id;   -- la misma nota, que cubre a otro producto
    ELSIF v_previa.estado IN ('registrada','enviando','sin_verificar')
       OR EXISTS (SELECT 1 FROM public.compra_renglon_erroneo x WHERE x.nota_papel_id = v_previa.id AND x.id <> p_id) THEN
      RAISE EXCEPTION 'Ya hay una nota % % de este proveedor con otra fecha o montos (% · %). Revisa lo escrito.',
        v_serie, v_numero, to_char(v_previa.fecha, 'DD/MM/YYYY'), v_previa.total;
    ELSE
      UPDATE public.compra_nota_credito_papel
         SET fecha = v_fecha, subtotal = v_sub, iva = v_iva, total = v_tot,
             estado = 'pendiente', error = NULL, updated_at = now()
       WHERE id = v_previa.id RETURNING id INTO v_id;
    END IF;
  ELSE
    INSERT INTO public.compra_nota_credito_papel
      (proveedor_nit, proveedor_nombre, erp_supplier_id, numero, serie, fecha, subtotal, iva, total, creada_por)
    VALUES (v_e.emisor_nit, coalesce(v_nombre, v_e.emisor_nombre, ''), v_erp, v_numero, v_serie, v_fecha, v_sub, v_iva, v_tot,
            public.auth_employee_id())
    RETURNING id INTO v_id;
  END IF;

  UPDATE public.compra_renglon_erroneo
     SET nota_papel_id = v_id, nota_credito_document_id = NULL, estado = 'con_nota', updated_at = now()
   WHERE id = p_id;
  RETURN v_id;
END;
$function$;

-- 8, 9. Integridad de los renglones erróneos (la tabla tiene 0 filas).
ALTER TABLE public.compra_renglon_erroneo
  ADD CONSTRAINT compra_renglon_erroneo_document_fk FOREIGN KEY (document_id) REFERENCES public.purchase_dte_documents(id),
  ADD CONSTRAINT compra_renglon_erroneo_nota_fk FOREIGN KEY (nota_credito_document_id) REFERENCES public.purchase_dte_documents(id),
  ADD CONSTRAINT compra_renglon_erroneo_con_nota_tiene_nota
    CHECK (estado <> 'con_nota' OR nota_credito_document_id IS NOT NULL OR nota_papel_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS compra_renglon_erroneo_nota_credito_idx
  ON public.compra_renglon_erroneo (nota_credito_document_id) WHERE nota_credito_document_id IS NOT NULL;
ALTER TABLE public.compra_reparto ADD CONSTRAINT compra_reparto_sucursal_conocida CHECK (erp_sucursal_id > 0) NOT VALID;

-- 10. La sala ve qué le llega, no cuánto costó: el costo se quita de las
-- líneas al listar.
CREATE OR REPLACE FUNCTION public.get_compra_repartos()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.recibido, t.creado DESC), '[]'::json) FROM (
    SELECT r.id, r.compra_carga_id, r.branch_id, b.name AS sala, r.erp_compra_id, r.emisor_nombre,
           (SELECT coalesce(jsonb_agg(l - 'compra' - 'venta'), '[]'::jsonb) FROM jsonb_array_elements(r.lineas) l) AS lineas,
           r.estado, r.erp_traslado_id, r.nota, r.enviado_at, r.recibido_at, r.vences,
           r.enviado_por, ee.name AS enviado_nombre, r.recibido_por, er.name AS recibido_nombre,
           r.estado = 'recibido' AS recibido, r.created_at AS creado
      FROM public.compra_reparto r
      JOIN public.branches b ON b.id = r.branch_id
      LEFT JOIN public.employees ee ON ee.id = r.enviado_por
      LEFT JOIN public.employees er ON er.id = r.recibido_por
     WHERE r.estado <> 'recibido' OR r.recibido_at > now() - interval '30 days'
  ) t;
$function$;

-- 17. Como las tablas hermanas: `anon` no tiene nada que hacer acá.
REVOKE ALL ON public.compra_carga, public.compra_reparto, public.compra_pedido_vence,
  public.compra_documento_resuelto, public.compra_producto_alias, public.compra_proveedor_no_va_a_bodega,
  public.compra_renglon_erroneo, public.compra_nota_credito_libro, public.compra_documento_manual
  FROM anon;
