SET lock_timeout = '5s';

-- Nota de crédito en PAPEL (2026-10-30). Un producto que vino por error en una
-- factura en papel tiene su nota también en papel: se escribe acá y el portal
-- la registra en el libro de compras como documento impreso. Usuario: «sí» a
-- que el portal la registre (en vez de Bodega a mano).
-- Una nota puede cubrir varios renglones erróneos: por eso es su propia fila.
CREATE TABLE public.compra_nota_credito_papel (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proveedor_nit    text NOT NULL,
  proveedor_nombre text NOT NULL,
  erp_supplier_id  integer NOT NULL,
  numero           text NOT NULL CHECK (numero ~ '^[A-Z0-9/-]+$'),
  serie            text NOT NULL CHECK (length(btrim(serie)) > 0),
  fecha            date NOT NULL,
  subtotal         numeric(12,2) NOT NULL CHECK (subtotal > 0),
  iva              numeric(12,2) NOT NULL CHECK (iva > 0),
  total            numeric(12,2) NOT NULL CHECK (total > 0),
  -- registro en el libro: pendiente → enviando → registrada | sin_verificar | fallida
  estado           text NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente','enviando','registrada','sin_verificar','fallida')),
  error            text,
  datos            jsonb,
  creada_por       uuid REFERENCES public.employees(id),
  registrada_por   uuid REFERENCES public.employees(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX compra_nota_credito_papel_unica
  ON public.compra_nota_credito_papel (erp_supplier_id, numero);
ALTER TABLE public.compra_nota_credito_papel ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_nota_credito_papel_select ON public.compra_nota_credito_papel
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('cargar_compra', 'can_view'))
      OR (SELECT auth_has_module_permission('compras', 'can_view')));
REVOKE ALL ON public.compra_nota_credito_papel FROM anon;

-- El renglón erróneo puede venir de un DTE o de un papel, y su nota puede ser
-- electrónica o en papel.
ALTER TABLE public.compra_renglon_erroneo ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE public.compra_renglon_erroneo
  ADD COLUMN manual_id bigint REFERENCES public.compra_documento_manual(id),
  ADD COLUMN nota_papel_id bigint REFERENCES public.compra_nota_credito_papel(id);
ALTER TABLE public.compra_renglon_erroneo ADD CONSTRAINT compra_renglon_erroneo_un_documento
  CHECK ((document_id IS NULL) <> (manual_id IS NULL));
ALTER TABLE public.compra_renglon_erroneo ADD CONSTRAINT compra_renglon_erroneo_una_nota
  CHECK (nota_credito_document_id IS NULL OR nota_papel_id IS NULL);
CREATE INDEX compra_renglon_erroneo_manual_id_idx ON public.compra_renglon_erroneo (manual_id) WHERE manual_id IS NOT NULL;
CREATE INDEX compra_renglon_erroneo_nota_papel_idx ON public.compra_renglon_erroneo (nota_papel_id) WHERE nota_papel_id IS NOT NULL;

-- Adjuntar una nota ELECTRÓNICA ahora también suelta la de papel (y quitar,
-- las dos). El resto, igual que la versión viva.
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
  IF p_nota IS NOT NULL THEN
    SELECT * INTO v_n FROM public.purchase_dte_documents WHERE id = p_nota;
    IF NOT FOUND OR v_n.tipo_dte <> '05' THEN RAISE EXCEPTION 'Eso no es una nota de crédito.'; END IF;
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

-- Adjuntar una nota en PAPEL. Si esa nota (proveedor + número) ya se escribió
-- para otro renglón, se reutiliza: una nota cubre varios productos y se
-- registra en el libro una sola vez. Una ya registrada no se reescribe.
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
  v_sub numeric := round((p_nota->>'subtotal')::numeric, 2);
  v_iva numeric := round((p_nota->>'iva')::numeric, 2);
  v_tot numeric := round((p_nota->>'total')::numeric, 2);
  v_id bigint; v_previa public.compra_nota_credito_papel;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','cargar_compra']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_e FROM public.compra_renglon_erroneo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglón no existe.'; END IF;
  IF v_e.estado IN ('salio','saliendo') THEN RAISE EXCEPTION 'Ese producto ya salió o está saliendo.'; END IF;
  IF v_numero = '' OR v_numero !~ '^[A-Z0-9/-]+$' THEN RAISE EXCEPTION 'Falta el número de la nota (letras, números y guiones).'; END IF;
  IF v_serie = '' THEN RAISE EXCEPTION 'Falta la serie de la nota.'; END IF;
  BEGIN v_fecha := (p_nota->>'fecha')::date; EXCEPTION WHEN others THEN v_fecha := NULL; END;
  IF v_fecha IS NULL OR v_fecha > (now() AT TIME ZONE 'America/El_Salvador')::date THEN RAISE EXCEPTION 'Falta la fecha de la nota.'; END IF;
  IF coalesce(v_sub,0) <= 0 OR coalesce(v_iva,0) <= 0 OR coalesce(v_tot,0) <= 0 THEN RAISE EXCEPTION 'Faltan los montos de la nota (subtotal, IVA y total).'; END IF;
  IF abs(v_sub + v_iva - v_tot) > 0.02 THEN RAISE EXCEPTION 'Subtotal más IVA no da el total de la nota.'; END IF;

  SELECT s.erp_supplier_id, pm.nombre INTO v_erp, v_nombre
    FROM public.proveedores_maestro pm JOIN public.suppliers s ON s.id = pm.supplier_id
   WHERE pm.nit = v_e.emisor_nit;
  IF v_erp IS NULL THEN RAISE EXCEPTION 'El proveedor no está en el catálogo de proveedores.'; END IF;

  SELECT * INTO v_previa FROM public.compra_nota_credito_papel WHERE erp_supplier_id = v_erp AND numero = v_numero;
  IF FOUND THEN
    IF v_previa.estado IN ('registrada','enviando','sin_verificar') THEN
      v_id := v_previa.id;   -- ya está (o está yendo) al libro: se usa tal cual
    ELSE
      UPDATE public.compra_nota_credito_papel
         SET serie = v_serie, fecha = v_fecha, subtotal = v_sub, iva = v_iva, total = v_tot,
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
REVOKE EXECUTE ON FUNCTION public.compra_erroneo_adjuntar_nota_papel(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_erroneo_adjuntar_nota_papel(bigint, jsonb) TO authenticated, service_role;

-- La lista: un renglón de factura en papel entra también (LEFT JOIN), con su
-- número; y la nota en papel viaja junto a la electrónica.
CREATE OR REPLACE FUNCTION public.get_compra_erroneos()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json) FROM (
    SELECT e.id, e.document_id, e.manual_id, e.emisor_nombre, e.descripcion, e.codigo_proveedor,
           e.product_id, e.es_generico, e.unidades, e.costo_unitario, e.erp_compra_id,
           e.estado, e.erp_traslado_id, e.nota, e.marcado_por, em.name AS marcado_nombre, e.created_at,
           e.nota_credito_document_id, e.nota_papel_id,
           coalesce(f.numero_control, m.numero) AS factura,
           coalesce(f.fecha_emision, m.fecha_emision) AS factura_fecha,
           (e.manual_id IS NOT NULL) AS factura_en_papel,
           coalesce(nc.numero_control, np.numero) AS nota_numero,
           coalesce(nc.fecha_emision, np.fecha) AS nota_fecha,
           coalesce(nc.monto_total, np.total) AS nota_total,
           CASE WHEN np.id IS NOT NULL THEN json_build_object(
             'id', np.id, 'numero', np.numero, 'serie', np.serie, 'fecha', np.fecha,
             'subtotal', np.subtotal, 'iva', np.iva, 'total', np.total, 'estado', np.estado, 'error', np.error)
           END AS nota_papel,
           (SELECT coalesce(json_agg(json_build_object(
                     'id', n.id, 'numero', n.numero_control, 'fecha', n.fecha_emision, 'total', n.monto_total,
                     'relacionada', n.documento_relacionado_id = e.document_id)
                   ORDER BY (n.documento_relacionado_id = e.document_id) DESC NULLS LAST, n.fecha_emision), '[]'::json)
              FROM public.purchase_dte_documents n
             WHERE n.tipo_dte = '05' AND NOT coalesce(n.invalidado, false)
               AND n.emisor_nit = e.emisor_nit AND n.fecha_emision >= coalesce(f.fecha_emision, m.fecha_emision)
           ) AS notas_candidatas
      FROM public.compra_renglon_erroneo e
      LEFT JOIN public.purchase_dte_documents f ON f.id = e.document_id
      LEFT JOIN public.compra_documento_manual m ON m.id = e.manual_id
      LEFT JOIN public.purchase_dte_documents nc ON nc.id = e.nota_credito_document_id
      LEFT JOIN public.compra_nota_credito_papel np ON np.id = e.nota_papel_id
      LEFT JOIN public.employees em ON em.id = e.marcado_por
     WHERE (SELECT auth_has_module_permission('compras','can_view'))
        OR (SELECT auth_has_module_permission('cargar_compra','can_view'))
  ) t;
$function$;
