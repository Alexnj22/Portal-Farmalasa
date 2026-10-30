SET lock_timeout = '5s';

-- La cola «Por cargar en Bodega» sólo reconoce una factura como cargada si el
-- número o el sello coinciden. Medido el 2026-10-29 sobre las 97 con más de
-- 15 días: 17 parecían cargadas a mano con OTRO número (6 en Bodega, 11 en
-- una sala) y ~80 eran gastos que nunca entran a Bodega (luz, agua, teléfono,
-- banco, seguros). Estas dos tablas guardan lo que una persona decidió:
--   · un documento concreto: «ya está cargado (es esta compra)» o «no va a
--     Bodega»;
--   · un proveedor entero: «lo suyo no va a Bodega» (CAESS, ANDA…).
-- Se escriben sólo por las funciones de abajo, que exigen permiso de edición.

CREATE TABLE IF NOT EXISTS public.compra_documento_resuelto (
  id                  bigserial PRIMARY KEY,
  document_id         bigint NOT NULL UNIQUE REFERENCES public.purchase_dte_documents(id) ON DELETE CASCADE,
  motivo              text   NOT NULL CHECK (motivo IN ('cargada_a_mano', 'no_va_a_bodega')),
  purchase_receipt_id integer REFERENCES public.purchase_receipts(id) ON DELETE SET NULL,
  creado_por          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (motivo <> 'cargada_a_mano' OR purchase_receipt_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS compra_documento_resuelto_receipt_idx
  ON public.compra_documento_resuelto (purchase_receipt_id) WHERE purchase_receipt_id IS NOT NULL;
ALTER TABLE public.compra_documento_resuelto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compra_documento_resuelto_select ON public.compra_documento_resuelto;
CREATE POLICY compra_documento_resuelto_select ON public.compra_documento_resuelto
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('compras', 'can_view'))
      OR (SELECT public.auth_has_module_permission('facturas_compra', 'can_view')));

CREATE TABLE IF NOT EXISTS public.compra_proveedor_no_va_a_bodega (
  nit         text PRIMARY KEY,
  nombre      text,
  creado_por  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.compra_proveedor_no_va_a_bodega ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compra_proveedor_no_va_a_bodega_select ON public.compra_proveedor_no_va_a_bodega;
CREATE POLICY compra_proveedor_no_va_a_bodega_select ON public.compra_proveedor_no_va_a_bodega
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('compras', 'can_view'))
      OR (SELECT public.auth_has_module_permission('facturas_compra', 'can_view')));

-- ── Decidir / deshacer ─────────────────────────────────────────────────────
-- p_motivo: 'cargada_a_mano' (con p_receipt_id), 'no_va_a_bodega', o
-- 'proveedor_no_va' (marca al emisor entero). Devuelve json con lo hecho.
CREATE OR REPLACE FUNCTION public.compra_resolver_documento(
  p_document_id bigint, p_motivo text, p_receipt_id integer DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_doc public.purchase_dte_documents%ROWTYPE;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras', 'facturas_compra']) THEN
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
END $$;

CREATE OR REPLACE FUNCTION public.compra_deshacer_resolucion(p_document_id bigint, p_nit text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras', 'facturas_compra']) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.compra_documento_resuelto WHERE document_id = p_document_id;
  IF p_nit IS NOT NULL THEN
    DELETE FROM public.compra_proveedor_no_va_a_bodega WHERE nit = p_nit;
  END IF;
  RETURN json_build_object('ok', true);
END $$;

-- ── Pistas para la cola ────────────────────────────────────────────────────
-- Por documento: la compra que PARECE ser la misma cargada a mano (mismo
-- total ±$0.05, mismo proveedor —por NIT o por nombre parecido—, fecha entre
-- 5 días antes y 60 después de la emisión), y si el proveedor está
-- clasificado como gasto. Uno a uno: una compra se ofrece a UN solo
-- documento (el de fecha más cercana), porque hay proveedores que facturan
-- dos veces el mismo monto el mismo día. Es una SUGERENCIA: no saca nada de
-- la cola hasta que alguien la confirma.
CREATE OR REPLACE FUNCTION public.get_pistas_documentos_sin_cargar(p_ids bigint[])
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  WITH docs AS (
    SELECT d.id, d.fecha_emision, d.monto_total, d.emisor_nit, upper(d.emisor_nombre) AS nom
      FROM public.purchase_dte_documents d
     WHERE d.id = ANY (p_ids)
       AND (SELECT public.auth_has_module_permission('compras', 'can_view')
             OR public.auth_has_module_permission('facturas_compra', 'can_view'))
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
                      ORDER BY m.id LIMIT 1))), '[]'::json)
    FROM docs d
    LEFT JOIN sugerida s ON s.document_id = d.id
    LEFT JOIN public.branches b ON b.id = s.branch_id;
$$;

REVOKE EXECUTE ON FUNCTION public.compra_resolver_documento(bigint, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.compra_deshacer_resolucion(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_pistas_documentos_sin_cargar(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_resolver_documento(bigint, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compra_deshacer_resolucion(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pistas_documentos_sin_cargar(bigint[]) TO authenticated, service_role;

-- ── La cola deja fuera lo que alguien ya resolvió ──────────────────────────
-- Misma definición viva (2026-10-30) más los dos NOT EXISTS del final.
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
  )
  SELECT d.id, d.fecha_emision, d.emisor_nombre, d.emisor_nit,
         d.codigo_generacion::text, d.numero_control, d.monto_total,
         coalesce(array_length(string_to_array(d.items_text, ' | '), 1), 0)::integer,
         d.pdf_path IS NOT NULL,
         (SELECT m.nombre FROM public.proveedores_maestro m
           WHERE m.nit = d.emisor_nit ORDER BY m.id LIMIT 1),
         (current_date - d.fecha_emision)::integer
    FROM public.purchase_dte_documents d
   WHERE NOT d.invalidado
     AND d.tipo_dte IN ('01','03')
     AND d.json_path IS NOT NULL
     AND d.fecha_emision >= current_date - coalesce(p_dias, 30)
     AND (SELECT auth_has_module_permission('compras','can_view')
           OR auth_has_module_permission('facturas_compra','can_view'))
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
     -- Lo que una persona ya resolvió (2026-10-30): este documento, o todo lo
     -- de este proveedor.
     AND NOT EXISTS (SELECT 1 FROM public.compra_documento_resuelto x WHERE x.document_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM public.compra_proveedor_no_va_a_bodega x WHERE x.nit = d.emisor_nit)
   ORDER BY d.fecha_emision DESC, d.id DESC;
$function$;
