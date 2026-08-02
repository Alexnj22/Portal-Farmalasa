SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- La nota de credito apunta a LA COMPRA que corrige, no solo a otro correo.
--
-- Hasta hoy `documento_relacionado_id` apuntaba de una NC/ND a otro registro de
-- `purchase_dte_documents`, o sea a otro DTE que hubiera llegado POR CORREO. Si
-- el CCF original no llego por correo —o llego a otra casilla, o el proveedor
-- solo mando la nota— no habia a que apuntar y la referencia se tiraba. De 139
-- notas, 85 quedaban sin ninguna relacion guardada.
--
-- Pero el CCF que la nota corrige casi siempre SI esta en el portal: esta en
-- `purchase_receipts`, que viene del ERP. Ese es el vinculo que faltaba y el que
-- la contadora necesita para saber que compra ajustar.
--
-- Medido antes de construir (2026-08-02), sobre las 54 que tenian el DTE
-- original guardado: **38 matchean con exactamente UNA compra y cero son
-- ambiguas**, y las 38 coinciden ademas por NIT del emisor. Verificado uno por
-- uno con RONASA 2026-06-04 ($955.98): el proveedor tiene 196 compras, cinco de
-- esa semana, y ninguna es ese codigo de generacion.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.purchase_dte_documents
  ADD COLUMN IF NOT EXISTS corrige_purchase_receipt_id integer
    REFERENCES public.purchase_receipts(id) ON DELETE SET NULL;

-- La referencia CRUDA que trae el JSON de la nota. Se guarda aunque no resuelva
-- a nada: hoy, cuando el original no aparecia, el dato se descartaba y habia que
-- volver a leer el JSON de Storage para reintentar. Guardado, el vinculo se
-- puede recalcular con un UPDATE el dia que la compra aparezca.
ALTER TABLE public.purchase_dte_documents
  ADD COLUMN IF NOT EXISTS doc_relacionado_ref text;

CREATE INDEX IF NOT EXISTS idx_pdd_corrige_purchase_receipt
  ON public.purchase_dte_documents(corrige_purchase_receipt_id)
  WHERE corrige_purchase_receipt_id IS NOT NULL;

COMMENT ON COLUMN public.purchase_dte_documents.corrige_purchase_receipt_id IS
  'La COMPRA del ERP que esta nota de credito/debito corrige. Distinto de documento_relacionado_id, que apunta a otro DTE recibido por correo y queda NULL cuando el CCF original nunca llego a la casilla.';
COMMENT ON COLUMN public.purchase_dte_documents.doc_relacionado_ref IS
  'El numeroDocumento crudo del bloque documentoRelacionado del DTE (codigo de generacion o numero de control, segun tipoGeneracion). Se guarda aunque no resuelva: sin el, reintentar el vinculo obliga a releer el JSON de Storage.';

-- ── El resolvedor ──────────────────────────────────────────────────────────
--
-- Liga SOLO cuando no hay duda: exactamente una compra con ese documento Y el
-- NIT del proveedor coincide con el emisor de la nota. Con una sola de las dos
-- condiciones alcanzaria hoy —cero ambiguas— pero el numero de documento del
-- ERP viene truncado a 20 caracteres y su propio sync ya advierte que "no
-- siempre es unico". Pedir las dos cosas cuesta nada y evita ligar la nota a la
-- compra de otro proveedor el dia que dos codigos compartan los primeros 20.
CREATE OR REPLACE FUNCTION public.ligar_notas_a_compras()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ligadas int := 0;
  v_ambiguas int := 0;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra','libros_iva'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  WITH candidata AS (
    SELECT d.id AS nota_id,
           coalesce(rel.codigo_generacion::text, d.doc_relacionado_ref) AS ref,
           d.emisor_nit
    FROM public.purchase_dte_documents d
    LEFT JOIN public.purchase_dte_documents rel ON rel.id = d.documento_relacionado_id
    WHERE d.tipo_dte IN ('05','06')
      AND coalesce(d.invalidado, false) = false
      AND d.corrige_purchase_receipt_id IS NULL
  ),
  match AS (
    SELECT c.nota_id,
           (SELECT array_agg(pr.id)
              FROM public.purchase_receipts pr
              JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
             WHERE pr.documento_numero = left(upper(c.ref), 20)
               AND pm.nit = c.emisor_nit) AS ids
    FROM candidata c
    WHERE c.ref IS NOT NULL
  ),
  aplicable AS (
    SELECT nota_id, ids[1] AS compra_id FROM match
     WHERE array_length(ids, 1) = 1
  ),
  escrito AS (
    UPDATE public.purchase_dte_documents d
       SET corrige_purchase_receipt_id = a.compra_id
      FROM aplicable a
     WHERE d.id = a.nota_id
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM escrito),
         (SELECT count(*) FROM match WHERE array_length(ids, 1) > 1)
    INTO v_ligadas, v_ambiguas;

  RETURN json_build_object('ligadas', v_ligadas, 'ambiguas_no_tocadas', v_ambiguas);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ligar_notas_a_compras() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ligar_notas_a_compras() TO authenticated, service_role;

-- ── El libro de notas dice a que compra corresponde cada una ────────────────
DROP FUNCTION IF EXISTS public.get_notas_credito_compras(date, date);

CREATE FUNCTION public.get_notas_credito_compras(p_desde date, p_hasta date)
 RETURNS TABLE(fecha date, tipo_dte text, numero_control text, codigo_generacion text,
               proveedor text, nrc text, nit text, monto numeric, iva numeric,
               documento_corregido text,
               compra_id integer, compra_documento text, compra_fecha date,
               compra_total numeric, compra_branch_id integer, vinculo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT d.fecha_emision,
           d.tipo_dte,
           d.numero_control,
           d.codigo_generacion,
           d.emisor_nombre,
           nullif(btrim(coalesce(d.emisor_nrc, '')), ''),
           nullif(btrim(coalesce(d.emisor_nit, '')), ''),
           coalesce(d.monto_total, 0),
           coalesce(d.total_iva, 0),
           coalesce(rel.numero_control, d.doc_relacionado_ref),
           pr.id, pr.documento_numero, pr.fecha, pr.total, pr.branch_id,
           CASE
             WHEN pr.id IS NOT NULL THEN 'ligada'
             WHEN coalesce(rel.codigo_generacion::text, d.doc_relacionado_ref) IS NULL
               THEN 'sin referencia'
             ELSE 'la compra no esta en el libro'
           END
    FROM public.purchase_dte_documents d
    LEFT JOIN public.purchase_dte_documents rel ON rel.id = d.documento_relacionado_id
    LEFT JOIN public.purchase_receipts pr ON pr.id = d.corrige_purchase_receipt_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND d.tipo_dte IN ('05', '06')
      AND coalesce(d.invalidado, false) = false
      AND d.fecha_emision BETWEEN p_desde AND p_hasta
    ORDER BY d.fecha_emision, d.emisor_nombre, d.numero_control;
$function$;

COMMENT ON FUNCTION public.get_notas_credito_compras(date, date) IS
  'H7 (PLAN-CONTABILIDAD-2026-08-02 A7): sin scope de sucursal A PROPOSITO. purchase_dte_documents no tiene columna de sucursal: los DTE llegan por correo a una casilla de la empresa (account_id es el buzon, no una sucursal). No hay nada por lo cual filtrar. El gate de permisos si esta, en initplan. `vinculo` dice si la nota se pudo ligar a la compra que corrige.';

REVOKE EXECUTE ON FUNCTION public.get_notas_credito_compras(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_notas_credito_compras(date, date) TO authenticated, service_role;
