-- El panel de facturas tomadas vive en COMPRAS, no en Facturas de Compra.
--
-- Decisión del usuario 2026-08-07: «agregalo en compras, no en contabilidad».
-- Tiene sentido — quien revisa que la compra haya quedado cargada trabaja en
-- Compras, no en el módulo de documentos del correo.
--
-- El permiso tiene que seguir a la pantalla. Si el RPC exigiera `facturas_compra`
-- y la pestaña viviera en `compras`, quien tiene Compras vería la pestaña y
-- recibiría un error al abrirla — un permiso que no cubre la pantalla que gatea
-- es peor que no tenerlo, porque parece que funciona.
--
-- Se aceptan los dos: `compras` es el hogar nuevo, `facturas_compra` se conserva
-- porque quien administra los documentos también necesita poder liberarlos.

SET lock_timeout = '5s';

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
  IF NOT (public.auth_has_module_permission('compras', 'can_view')
          OR public.auth_has_module_permission('facturas_compra', 'can_view')) THEN
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

-- Liberar una factura ajena: mismo criterio. Antes solo `facturas_compra`.
CREATE OR REPLACE FUNCTION public.soltar_factura_compra(
    p_claim_id bigint,
    p_motivo   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp        uuid;
  v_branch     bigint;
  v_registrada boolean;
  v_admin      boolean;
BEGIN
  SELECT e.id INTO v_emp
    FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVE';
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no está activo.';
  END IF;

  SELECT c.branch_id, c.receipt_id IS NOT NULL
    INTO v_branch, v_registrada
    FROM public.purchase_dte_claims c
   WHERE c.id = p_claim_id AND c.released_at IS NULL;

  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Esa factura ya no está tomada.';
  END IF;

  v_admin := public.auth_can_edit_any(ARRAY['compras', 'facturas_compra']);

  IF NOT v_admin THEN
    PERFORM public.facturas_sala_guarda(v_branch, 'can_edit');
    IF v_registrada THEN
      RAISE EXCEPTION 'Esta factura ya quedó registrada como compra: pedí que la liberen desde Compras.';
    END IF;
  END IF;

  UPDATE public.purchase_dte_claims
     SET released_at = now(), released_by = v_emp, released_motivo = p_motivo
   WHERE id = p_claim_id AND released_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_facturas_sala_panel(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_facturas_sala_panel(integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.soltar_factura_compra(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soltar_factura_compra(bigint, text) TO authenticated, service_role;
