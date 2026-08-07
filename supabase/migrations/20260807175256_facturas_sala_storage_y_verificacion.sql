-- Facturas de mi Sala — el archivo, el panel de contabilidad y el cierre del circuito.

SET lock_timeout = '5s';

-- ── El archivo ──────────────────────────────────────────────────────────────
-- El bucket `purchase-dte` pide el módulo de Facturas de Compra, que es de
-- contabilidad: el personal de sala no lo tiene y por lo tanto no podía bajar
-- NI SU PROPIA factura, que es el punto entero del widget.
--
-- La salida NO es abrirle el bucket. Ahí adentro están también las facturas de
-- los laboratorios —COFARSAL solo suma $157,215 en el bimestre— y el widget no
-- tiene por qué dar acceso a eso.
--
-- Se le da acceso al ARCHIVO DEL DOCUMENTO QUE YA TOMÓ, y a ninguno más. Tiene
-- un efecto de diseño buscado: primero se toma la factura, después se baja. La
-- sala decide con lo que ya muestra la lista (fecha, proveedor, monto y el
-- renglón completo: "4 GARRAFA DE AGUA", "RECARGA TIGO $25.00 Cant.: 16").
--
-- `split_part` y no `LIKE '%/purchase-dte/' || name`: en un LIKE el nombre del
-- objeto sería un PATRÓN, y un `_` adentro casaría con cualquier carácter.
CREATE POLICY purchase_dte_storage_select_sala ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'purchase-dte'
        AND (SELECT public.auth_has_module_permission('dash_facturas_sala', 'can_view'))
        AND EXISTS (
            SELECT 1
              FROM public.purchase_dte_claims c
              JOIN public.purchase_dte_documents d ON d.id = c.document_id
             WHERE c.released_at IS NULL
               AND c.branch_id = (SELECT public.auth_employee_branch_id())::bigint
               AND (   split_part(d.pdf_path,  '/purchase-dte/', 2) = storage.objects.name
                    OR split_part(d.json_path, '/purchase-dte/', 2) = storage.objects.name)
        )
    );

-- ── El panel de contabilidad ────────────────────────────────────────────────
-- Alguien va a tomar la que no era. Sin una pantalla que muestre quién tomó qué,
-- un error es permanente y la sala tiene que llamar por teléfono.
CREATE OR REPLACE FUNCTION public.get_facturas_sala_panel(p_dias integer DEFAULT 90)
RETURNS TABLE (
    claim_id        bigint,
    document_id     bigint,
    fecha_emision   date,
    etiqueta        text,
    emisor_nombre   text,
    monto_total     numeric,
    items_text      text,
    sala            text,
    tomada_por      text,
    tomada_at       timestamptz,
    origen          text,
    registrada      boolean,
    dias_sin_cargar integer,
    liberada_at     timestamptz,
    liberada_motivo text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.auth_has_module_permission('facturas_compra', 'can_view') THEN
    RAISE EXCEPTION 'No tenés permiso para ver este panel.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.document_id, d.fecha_emision, r.etiqueta, d.emisor_nombre,
         d.monto_total, d.items_text, b.name, c.claimed_by_name, c.claimed_at,
         c.origen, (c.receipt_id IS NOT NULL),
         CASE WHEN c.receipt_id IS NULL AND c.released_at IS NULL
              THEN (current_date - c.claimed_at::date) END,
         c.released_at, c.released_motivo
    FROM public.purchase_dte_claims c
    JOIN public.purchase_dte_documents d ON d.id = c.document_id
    LEFT JOIN public.purchase_claim_rules r ON r.id = c.rule_id
    LEFT JOIN public.branches b ON b.id = c.branch_id
   WHERE c.claimed_at >= now() - make_interval(days => p_dias)
   ORDER BY c.claimed_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_facturas_sala_panel(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_facturas_sala_panel(integer) TO authenticated, service_role;

-- ── El cierre del circuito ──────────────────────────────────────────────────
-- Tomar la factura no es el objetivo: registrar la compra lo es. Esta función
-- busca, para cada reclamo vivo sin verificar, la compra que le corresponde.
--
-- Y NO adivina. El cruce se hace por sucursal + monto exacto + ventana de días,
-- porque el número de documento no sirve (viene cortado a 20 caracteres y cada
-- sala lo escribe distinto). Con montos que se repiten —$184.68 aparece en 9 de
-- 21 documentos de recargas— un cruce con dos candidatos NO es una verificación:
-- se exige que haya EXACTAMENTE UNO y que no esté ya atado a otro reclamo. Lo
-- ambiguo queda sin verificar y se ve como tal, que es la verdad.
CREATE OR REPLACE FUNCTION public.verificar_facturas_reclamadas(p_ventana_dias integer DEFAULT 12)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ligadas integer := 0;
BEGIN
  WITH candidatos AS (
      SELECT c.id AS claim_id,
             (SELECT array_agg(pr.id)
                FROM public.purchase_receipts pr
               WHERE pr.erp_sucursal_id = m.erp_sucursal_id
                 AND pr.total = d.monto_total
                 AND pr.fecha BETWEEN d.fecha_emision AND d.fecha_emision + p_ventana_dias
                 AND NOT EXISTS (SELECT 1 FROM public.purchase_dte_claims o
                                  WHERE o.receipt_id = pr.id AND o.id <> c.id)
             ) AS ids
        FROM public.purchase_dte_claims c
        JOIN public.purchase_dte_documents d ON d.id = c.document_id
        JOIN public.erp_sucursal_map m       ON m.branch_id = c.branch_id
       WHERE c.released_at IS NULL AND c.receipt_id IS NULL
  ), unicos AS (
      SELECT claim_id, ids[1] AS receipt_id
        FROM candidatos
       WHERE ids IS NOT NULL AND array_length(ids, 1) = 1
  )
  UPDATE public.purchase_dte_claims c
     SET receipt_id = u.receipt_id, verificado_at = now()
    FROM unicos u
   WHERE c.id = u.claim_id;

  GET DIAGNOSTICS v_ligadas = ROW_COUNT;
  RETURN v_ligadas;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verificar_facturas_reclamadas(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.verificar_facturas_reclamadas(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.verificar_facturas_reclamadas(integer) IS
    'Liga cada reclamo con su compra registrada, SOLO cuando el candidato es único. Los montos se repiten, así que una coincidencia ambigua se deja sin verificar en vez de inventarla.';
