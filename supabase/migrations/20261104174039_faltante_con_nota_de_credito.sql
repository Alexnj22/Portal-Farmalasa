SET lock_timeout = '5s';

-- ── Faltante con nota de crédito (2026-11-04) ──────────────────────────────
-- «Llegaron menos» deja la factura entrar COMPLETA: Bodega queda con unidades
-- que nunca llegaron. Cuando el proveedor manda la nota de crédito por lo que
-- faltó, el portal hace lo mismo que con un producto erróneo: registra la nota
-- en el libro de compras y descarga esas unidades de Bodega (estante). Antes
-- `nota_credito` era sólo un rótulo puesto a mano: ni libro ni existencia.
ALTER TABLE public.compra_por_llegar
  ADD COLUMN nota_credito_document_id bigint REFERENCES public.purchase_dte_documents(id),
  ADD COLUMN nota_papel_id bigint REFERENCES public.compra_nota_credito_papel(id),
  ADD COLUMN salida jsonb,
  ADD COLUMN updated_at timestamptz;
CREATE INDEX compra_por_llegar_nota ON public.compra_por_llegar (nota_credito_document_id);
CREATE INDEX compra_por_llegar_nota_papel ON public.compra_por_llegar (nota_papel_id);
ALTER TABLE public.compra_por_llegar DROP CONSTRAINT compra_por_llegar_estado_check;
-- `nota_credito` es el cierre: la nota está en el libro y las unidades salieron.
ALTER TABLE public.compra_por_llegar ADD CONSTRAINT compra_por_llegar_estado_check
  CHECK (estado IN ('por_llegar', 'llego', 'reclamar', 'con_nota', 'saliendo', 'sin_verificar', 'nota_credito'));
DROP INDEX public.compra_por_llegar_estado;
CREATE INDEX compra_por_llegar_estado ON public.compra_por_llegar (estado)
  WHERE estado IN ('por_llegar', 'reclamar', 'con_nota', 'saliendo', 'sin_verificar');

-- La nota en PAPEL se escribe una vez, la use quien la use: un erróneo, un
-- faltante, o los dos (una sola nota del proveedor cubre ambas cosas). Antes
-- esta lógica vivía dentro de `compra_erroneo_adjuntar_nota_papel`.
-- `p_tabla`/`p_id` es quien la está pidiendo: no cuenta como «otro uso».
CREATE OR REPLACE FUNCTION public.compra_nota_papel_guardar(
  p_nit text, p_nombre text, p_nota jsonb, p_tabla text, p_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_erp integer; v_nombre text;
  v_numero text := upper(regexp_replace(coalesce(p_nota->>'numero',''), '\s', '', 'g'));
  v_serie  text := upper(btrim(coalesce(p_nota->>'serie','')));
  v_fecha  date;
  v_sub numeric; v_iva numeric; v_tot numeric;
  v_id bigint; v_previa public.compra_nota_credito_papel;
BEGIN
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
   WHERE pm.nit = p_nit;
  IF v_erp IS NULL THEN RAISE EXCEPTION 'El proveedor no está en el catálogo de proveedores.'; END IF;

  SELECT * INTO v_previa FROM public.compra_nota_credito_papel
   WHERE erp_supplier_id = v_erp AND serie = v_serie AND numero = v_numero FOR UPDATE;
  IF FOUND THEN
    IF v_previa.fecha = v_fecha AND v_previa.total = v_tot AND v_previa.subtotal = v_sub AND v_previa.iva = v_iva THEN
      v_id := v_previa.id;   -- la misma nota, que cubre a otro producto
    ELSIF v_previa.estado IN ('registrada','enviando','sin_verificar')
       OR EXISTS (SELECT 1 FROM public.compra_renglon_erroneo x
                   WHERE x.nota_papel_id = v_previa.id AND NOT (p_tabla = 'erroneo' AND x.id = p_id))
       OR EXISTS (SELECT 1 FROM public.compra_por_llegar x
                   WHERE x.nota_papel_id = v_previa.id AND NOT (p_tabla = 'faltante' AND x.id = p_id)) THEN
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
    VALUES (p_nit, coalesce(v_nombre, p_nombre, ''), v_erp, v_numero, v_serie, v_fecha, v_sub, v_iva, v_tot,
            public.auth_employee_id())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.compra_nota_papel_guardar(text, text, jsonb, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compra_nota_papel_guardar(text, text, jsonb, text, bigint) TO service_role;

-- El erróneo usa el mismo guardado (mismo cuerpo que tenía, ahora compartido).
CREATE OR REPLACE FUNCTION public.compra_erroneo_adjuntar_nota_papel(p_id bigint, p_nota jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_e public.compra_renglon_erroneo; v_id bigint;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','cargar_compra']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_e FROM public.compra_renglon_erroneo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglón no existe.'; END IF;
  IF v_e.estado IN ('salio','saliendo','sin_verificar') THEN RAISE EXCEPTION 'Ese producto ya salió, está saliendo o falta comprobar su salida.'; END IF;
  IF v_e.nota_papel_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.compra_nota_credito_papel
        WHERE id = v_e.nota_papel_id AND estado IN ('registrada','enviando','sin_verificar')) THEN
    RAISE EXCEPTION 'La nota en papel de este producto ya está en el libro de compras: no se puede cambiar.';
  END IF;
  v_id := public.compra_nota_papel_guardar(v_e.emisor_nit, v_e.emisor_nombre, p_nota, 'erroneo', p_id);
  UPDATE public.compra_renglon_erroneo
     SET nota_papel_id = v_id, nota_credito_document_id = NULL, estado = 'con_nota', updated_at = now()
   WHERE id = p_id;
  RETURN v_id;
END $$;

-- ── Adjuntar la nota a un faltante ─────────────────────────────────────────
-- Se puede mientras no haya empezado la salida. Quitar (p_nota NULL) lo
-- devuelve a «pedir nota».
CREATE OR REPLACE FUNCTION public.compra_por_llegar_adjuntar_nota(p_id bigint, p_nota bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_f public.compra_por_llegar; v_nit text; v_n public.purchase_dte_documents; v_emp uuid := public.auth_employee_id();
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['cargar_compra', 'compras']) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_f FROM public.compra_por_llegar WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el faltante %', p_id; END IF;
  IF v_f.estado NOT IN ('por_llegar', 'reclamar', 'con_nota') THEN
    RAISE EXCEPTION 'Ese faltante ya está cerrado, saliendo o falta comprobar su salida.';
  END IF;
  IF v_f.nota_papel_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.compra_nota_credito_papel
        WHERE id = v_f.nota_papel_id AND estado IN ('registrada','enviando','sin_verificar')) THEN
    RAISE EXCEPTION 'La nota en papel de este faltante ya está en el libro de compras: no se puede cambiar.';
  END IF;
  SELECT g.proveedor_nit INTO v_nit FROM public.compra_registro g WHERE g.id = v_f.registro_id;
  IF p_nota IS NOT NULL THEN
    SELECT * INTO v_n FROM public.purchase_dte_documents WHERE id = p_nota;
    IF NOT FOUND OR v_n.tipo_dte <> '05' THEN RAISE EXCEPTION 'Eso no es una nota de crédito.'; END IF;
    IF coalesce(v_n.invalidado, false) THEN RAISE EXCEPTION 'Esa nota de crédito está anulada.'; END IF;
    IF v_n.emisor_nit IS DISTINCT FROM v_nit THEN RAISE EXCEPTION 'La nota es de otro proveedor.'; END IF;
  END IF;
  UPDATE public.compra_por_llegar
     SET nota_credito_document_id = p_nota, nota_papel_id = NULL,
         estado = CASE WHEN p_nota IS NOT NULL THEN 'con_nota' ELSE 'reclamar' END,
         cambiado_por = v_emp, cambiado_at = now(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.compra_por_llegar_log (por_llegar_id, estado, nota, por)
  VALUES (p_id, CASE WHEN p_nota IS NOT NULL THEN 'con_nota' ELSE 'reclamar' END,
          CASE WHEN p_nota IS NOT NULL THEN 'nota ' || coalesce(v_n.numero_control, p_nota::text) ELSE 'nota quitada' END, v_emp);
END $$;
REVOKE ALL ON FUNCTION public.compra_por_llegar_adjuntar_nota(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_por_llegar_adjuntar_nota(bigint, bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compra_por_llegar_adjuntar_nota_papel(p_id bigint, p_nota jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_f public.compra_por_llegar; v_g public.compra_registro; v_id bigint; v_emp uuid := public.auth_employee_id();
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['cargar_compra', 'compras']) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_f FROM public.compra_por_llegar WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el faltante %', p_id; END IF;
  IF v_f.estado NOT IN ('por_llegar', 'reclamar', 'con_nota') THEN
    RAISE EXCEPTION 'Ese faltante ya está cerrado, saliendo o falta comprobar su salida.';
  END IF;
  IF v_f.nota_papel_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.compra_nota_credito_papel
        WHERE id = v_f.nota_papel_id AND estado IN ('registrada','enviando','sin_verificar')) THEN
    RAISE EXCEPTION 'La nota en papel de este faltante ya está en el libro de compras: no se puede cambiar.';
  END IF;
  SELECT * INTO v_g FROM public.compra_registro WHERE id = v_f.registro_id;
  v_id := public.compra_nota_papel_guardar(v_g.proveedor_nit, v_g.proveedor_nombre, p_nota, 'faltante', p_id);
  UPDATE public.compra_por_llegar
     SET nota_papel_id = v_id, nota_credito_document_id = NULL, estado = 'con_nota',
         cambiado_por = v_emp, cambiado_at = now(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.compra_por_llegar_log (por_llegar_id, estado, nota, por)
  VALUES (p_id, 'con_nota', 'nota en papel ' || (p_nota->>'numero'), v_emp);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.compra_por_llegar_adjuntar_nota_papel(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_por_llegar_adjuntar_nota_papel(bigint, jsonb) TO authenticated, service_role;

-- ── Marcar a mano: ya NO cierra con «nota de crédito» ───────────────────────
-- Ese cierre ahora lo hace la salida (libro + existencia). A mano quedan
-- «llegó», «pedir nota» y deshacer.
CREATE OR REPLACE FUNCTION public.compra_por_llegar_marcar(p_id bigint, p_estado text, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_emp uuid := public.auth_employee_id(); v_actual text;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['cargar_compra', 'compras']) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_estado NOT IN ('por_llegar', 'llego', 'reclamar') THEN
    RAISE EXCEPTION 'Estado desconocido: %', p_estado;
  END IF;
  SELECT estado INTO v_actual FROM public.compra_por_llegar WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el faltante %', p_id; END IF;
  IF v_actual IN ('con_nota') THEN
    RAISE EXCEPTION 'Ese faltante tiene una nota de crédito adjunta: quítala primero.';
  END IF;
  IF v_actual IN ('saliendo', 'sin_verificar', 'nota_credito') THEN
    RAISE EXCEPTION 'Ese faltante ya salió de Bodega con su nota de crédito, o está saliendo.';
  END IF;
  IF v_actual = 'llego' AND p_estado <> 'por_llegar' THEN
    RAISE EXCEPTION 'Ese faltante ya está cerrado.';
  END IF;
  UPDATE public.compra_por_llegar
     SET estado = p_estado, nota = nullif(btrim(p_nota), ''), cambiado_por = v_emp, cambiado_at = now(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.compra_por_llegar_log (por_llegar_id, estado, nota, por)
  VALUES (p_id, p_estado, nullif(btrim(p_nota), ''), v_emp);
  RETURN json_build_object('ok', true);
END $$;

-- ── La lista, con la nota y las candidatas ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_compra_por_llegar_json()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))
       OR (SELECT public.auth_has_module_permission('compras', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(json_agg(to_json(t) ORDER BY t.abierto DESC, t.fecha_documento, t.id), '[]'::json)
      FROM (
        SELECT f.id, f.estado, f.faltan, f.nota, f.cambiado_at, f.created_at,
               f.estado IN ('por_llegar', 'reclamar', 'con_nota', 'saliendo', 'sin_verificar') AS abierto,
               (current_date - g.fecha_documento) AS dias,
               g.fecha_documento, g.proveedor_nombre, g.proveedor_nit, g.tipo_documento, g.numero_documento,
               g.erp_product_id, g.producto, g.descripcion_proveedor, g.presentacion, g.lote, g.erp_compra_id,
               g.unidades, g.llegaron, g.costo_unidad, round(f.faltan * g.costo_unidad, 2) AS monto,
               f.cambiado_por, e.name AS cambiado_por_nombre,
               f.nota_credito_document_id, f.nota_papel_id, f.salida,
               coalesce(nc.numero_control, np.numero) AS nota_numero,
               coalesce(nc.fecha_emision, np.fecha) AS nota_fecha,
               coalesce(nc.monto_total, np.total) AS nota_total,
               CASE WHEN np.id IS NOT NULL THEN json_build_object(
                 'id', np.id, 'numero', np.numero, 'serie', np.serie, 'fecha', np.fecha,
                 'subtotal', np.subtotal, 'iva', np.iva, 'total', np.total, 'estado', np.estado, 'error', np.error)
               END AS nota_papel,
               CASE WHEN f.estado IN ('por_llegar', 'reclamar') THEN (
                 SELECT coalesce(json_agg(json_build_object(
                          'id', n.id, 'numero', n.numero_control, 'fecha', n.fecha_emision, 'total', n.monto_total,
                          'relacionada', n.documento_relacionado_id = g.document_id)
                        ORDER BY (n.documento_relacionado_id = g.document_id) DESC NULLS LAST, n.fecha_emision), '[]'::json)
                   FROM public.purchase_dte_documents n
                  WHERE n.tipo_dte = '05' AND NOT coalesce(n.invalidado, false)
                    AND n.emisor_nit = g.proveedor_nit AND n.fecha_emision >= g.fecha_documento)
               END AS notas_candidatas
          FROM public.compra_por_llegar f
          JOIN public.compra_registro g ON g.id = f.registro_id
          LEFT JOIN public.employees e ON e.id = f.cambiado_por
          LEFT JOIN public.purchase_dte_documents nc ON nc.id = f.nota_credito_document_id
          LEFT JOIN public.compra_nota_credito_papel np ON np.id = f.nota_papel_id
         WHERE f.estado IN ('por_llegar', 'reclamar', 'con_nota', 'saliendo', 'sin_verificar')
            OR f.cambiado_at > now() - interval '60 days'
      ) t
  );
END $$;
