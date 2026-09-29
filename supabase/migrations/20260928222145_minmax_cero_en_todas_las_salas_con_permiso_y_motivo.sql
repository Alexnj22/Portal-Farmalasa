SET lock_timeout = '5s';

-- ══ «0 en todas las salas»: una capacidad propia y el porqué obligatorio ══
-- Pedido del usuario (2026-09-28). La jefa de Compras y Logística tiene MIN·MAX
-- con alcance de SU sala, y retirar un producto de todas las salas exigía
-- alcance total: le rebotaba con BRANCH_SCOPE_DENIED. El usuario NO quiere
-- darle alcance total (editaría el MIN·MAX de cada sala), sólo esta función.
-- Por eso es una capacidad aparte, `minmax_cero_en_todas`, que se asigna desde
-- Permisos como cualquier otra.
--
-- Y ahora pregunta por qué. Hasta hoy la fila quedaba marcada «sin motivo, a
-- propósito, para no inferir ya_no_rota». El motivo se sigue sin inferir: lo
-- ESCRIBE quien lo retira (`otro` + nota), y «ya no rota» —que borra historial
-- de demanda— sigue reservado a alcance total, igual que en
-- `marcar_ajuste_manual_minmax`.
--
-- La firma cambia: se BORRA la vieja para que no quede con sus permisos.

DROP FUNCTION IF EXISTS public.zero_out_product_all_branches(integer, text);

CREATE FUNCTION public.zero_out_product_all_branches(
  p_erp_product_id integer,
  p_motivo text DEFAULT NULL,
  p_nota   text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now       TIMESTAMPTZ := NOW();
  v_count     INTEGER;
  v_publisher TEXT := (SELECT auth.email());
  v_total     BOOLEAN := (SELECT public.auth_can_edit_scope_all(ARRAY['minmax']));
  v_motivo    TEXT := coalesce(nullif(btrim(p_motivo), ''), 'otro');
  v_nota      TEXT := nullif(btrim(p_nota), '');
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF NOT v_total
     AND NOT (SELECT public.auth_has_module_permission('minmax_cero_en_todas', 'can_view')) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: poner un producto en 0 en todas las salas requiere ese permiso';
  END IF;

  IF v_motivo NOT IN ('otro', 'ya_no_rota') THEN
    RAISE EXCEPTION 'MOTIVO_INVALIDO: el motivo tiene que ser «otro» o «ya_no_rota»';
  END IF;
  IF v_motivo = 'ya_no_rota' AND NOT v_total THEN
    RAISE EXCEPTION 'MOTIVO_DENEGADO: «ya no rota» sólo lo puede poner quien decide sobre todas las salas';
  END IF;
  IF v_nota IS NULL THEN
    RAISE EXCEPTION 'FALTA_MOTIVO: escribe por qué se pone en 0 en todas las salas';
  END IF;

  INSERT INTO product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    draft_min, draft_max, draft_status,
    manual_min, manual_max,
    manual_motivo, manual_nota, manual_cliente_unidades, manual_cliente_dias,
    manual_at, manual_por,
    published_at, published_by, updated_at
  )
  SELECT
    p_erp_product_id,
    m.erp_sucursal_id,
    0, 0,
    NULL, NULL, 'none',
    NULL, NULL,
    v_motivo, v_nota, NULL, NULL,
    v_now, v_publisher,
    v_now, v_publisher, v_now
  FROM erp_sucursal_map m
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = 0,
    max_units    = 0,
    draft_min    = NULL,
    draft_max    = NULL,
    draft_status = 'none',
    manual_min   = NULL,
    manual_max   = NULL,
    manual_motivo = v_motivo,
    manual_nota   = v_nota,
    manual_cliente_unidades = NULL,
    manual_cliente_dias     = NULL,
    manual_at    = v_now,
    manual_por   = v_publisher,
    published_at = v_now,
    published_by = v_publisher,
    updated_at   = v_now
  WHERE product_stock_params.is_hidden IS NOT TRUE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_count, 'at', v_now);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.zero_out_product_all_branches(integer, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.zero_out_product_all_branches(integer, text, text) TO authenticated, service_role;

-- La capacidad, encendida sólo para el cargo que la pidió. Quien tiene alcance
-- total no la necesita.
INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT r.id, 'minmax_cero_en_todas', true, false, false, 'ALL', now()
FROM roles r WHERE r.id = 12  -- Jefe/a de Compras y Logistica
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();
