-- Min/Max — workflow de solicitudes de ajuste (operación → aprobación supervisor)
-- Reusa la infraestructura de permisos existente (role_permissions: can_edit/can_approve)
-- y el helper auth_has_module_permission(module, action) que ya usan otras tablas.

CREATE TABLE IF NOT EXISTS public.minmax_change_requests (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  erp_product_id    integer NOT NULL,
  erp_sucursal_id   integer NOT NULL,
  product_name      text,
  current_min       integer,           -- snapshot al momento de solicitar
  current_max       integer,
  current_sales_6m  integer,            -- ventas últimos 6 meses de esa sucursal (contexto)
  requested_min     integer NOT NULL,
  requested_max     integer NOT NULL,
  reason            text,
  status            text NOT NULL DEFAULT 'pending',
  requested_by      text NOT NULL,     -- email
  requested_by_id   uuid,              -- employees.id
  requested_by_name text,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  decided_by        text,
  decided_at        timestamptz,
  decision_note     text,
  CONSTRAINT mmcr_status_chk     CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT mmcr_max_gt_min_chk CHECK (requested_max > requested_min)
);

CREATE INDEX IF NOT EXISTS mmcr_status_idx    ON public.minmax_change_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS mmcr_prod_idx      ON public.minmax_change_requests (erp_product_id, erp_sucursal_id);
CREATE INDEX IF NOT EXISTS mmcr_requester_idx ON public.minmax_change_requests (requested_by_id);

-- ── RLS (espejo de approval_requests) ────────────────────────────────────────
ALTER TABLE public.minmax_change_requests ENABLE ROW LEVEL SECURITY;

-- INSERT: gateado por el permiso del WIDGET (dash_minmax_req can_view), no por el
-- módulo — así operación puede proponer sin tener acceso al módulo Min/Max. Solo a nombre propio.
CREATE POLICY mmcr_insert ON public.minmax_change_requests
  FOR INSERT WITH CHECK (
    auth_has_module_permission('dash_minmax_req', 'can_view')
    AND requested_by_id = (SELECT auth.uid())
  );

-- SELECT: el solicitante ve las suyas; los aprobadores ven todas.
CREATE POLICY mmcr_select ON public.minmax_change_requests
  FOR SELECT USING (
    requested_by_id = (SELECT auth.uid())
    OR auth_has_module_permission('minmax', 'can_approve')
  );

-- UPDATE: solo aprobadores (aprobar/rechazar).
CREATE POLICY mmcr_update ON public.minmax_change_requests
  FOR UPDATE USING (auth_has_module_permission('minmax', 'can_approve'));

-- ── RPC: aprobar ─────────────────────────────────────────────────────────────
-- SECURITY INVOKER (default): la RLS de UPDATE exige can_approve. Si el caller no
-- lo tiene, el UPDATE afecta 0 filas → NOT FOUND → aborta SIN escribir el override.
CREATE OR REPLACE FUNCTION public.approve_minmax_request(
  p_request_id bigint,
  p_decided_by text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE r public.minmax_change_requests%ROWTYPE;
BEGIN
  UPDATE public.minmax_change_requests
  SET status='approved', decided_by=p_decided_by, decided_at=now(), decision_note=p_note
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_NO_PERMISSION';
  END IF;

  -- Aplicar como override manual (prioridad sobre el cálculo automático).
  INSERT INTO public.product_stock_params (erp_product_id, erp_sucursal_id, manual_min, manual_max, updated_at)
  VALUES (r.erp_product_id, r.erp_sucursal_id, r.requested_min, r.requested_max, now())
  ON CONFLICT (erp_product_id, erp_sucursal_id)
  DO UPDATE SET manual_min = EXCLUDED.manual_min, manual_max = EXCLUDED.manual_max, updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'erp_product_id', r.erp_product_id,
    'erp_sucursal_id', r.erp_sucursal_id,
    'requested_by_id', r.requested_by_id,
    'product_name', r.product_name,
    'requested_min', r.requested_min,
    'requested_max', r.requested_max
  );
END;
$function$;

-- ── RPC: rechazar ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_minmax_request(
  p_request_id bigint,
  p_decided_by text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE r public.minmax_change_requests%ROWTYPE;
BEGIN
  UPDATE public.minmax_change_requests
  SET status='rejected', decided_by=p_decided_by, decided_at=now(), decision_note=p_note
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_NO_PERMISSION';
  END IF;

  RETURN jsonb_build_object('ok', true, 'requested_by_id', r.requested_by_id, 'product_name', r.product_name);
END;
$function$;