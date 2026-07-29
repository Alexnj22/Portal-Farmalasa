SET lock_timeout = '5s';

-- ─── C5 — Que la única puerta sea la RPC ────────────────────────────────────
-- Las tres policies estaban bien construidas (wrapper (SELECT …), filtro por
-- scope). El problema era lo que permitían DE MÁS, y que la app no las usaba:
--
-- (a) conteos_update: cualquiera con can_edit podía, por PostgREST directo,
--     UPDATE conteos_inventario SET status='CERRADO', aprobado_por=…,
--     valor_faltante=0 — saltándose por completo el control de can_approve que
--     sí verifica aprobar_conteo_inventario.
-- (b) conteo_items_update: can_edit podía escribir fisico_cantidad,
--     sistema_cantidad, diferencia, costo_unitario, contado_por y contado_at
--     directo, SIN generar la fila de historial. El rastro append-only era
--     esquivable.
-- (c) conteo_items_insert: el alta manual era el único write del módulo que no
--     pasaba por RPC, y el cliente elegía sistema_cantidad, costo_unitario,
--     es_agregado_manual y estado_item. Un costo inventado infla el sobrante.
--
-- Todas las escrituras reales van por RPC SECURITY DEFINER (que ignora RLS),
-- así que (a) y (b) se eliminan sin reemplazo y (c) se convierte en RPC.

DROP POLICY IF EXISTS conteos_update ON public.conteos_inventario;
DROP POLICY IF EXISTS conteo_items_update ON public.conteo_inventario_items;
DROP POLICY IF EXISTS conteo_items_insert ON public.conteo_inventario_items;


-- ─── Alta manual: costo y autoría server-side ───────────────────────────────
CREATE OR REPLACE FUNCTION public.agregar_item_conteo(
  p_conteo_id uuid,
  p_erp_product_id integer,
  p_presentacion text,
  p_lote text,
  p_fecha_vencimiento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_pres text := NULLIF(TRIM(p_presentacion), '');
  v_lote text := NULLIF(TRIM(p_lote), '');
  v_id uuid;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  IF v_pres IS NULL OR v_lote IS NULL THEN
    RAISE EXCEPTION 'PRESENTACION_Y_LOTE_REQUERIDOS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_erp_product_id AND activo = true) THEN
    RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO';
  END IF;

  -- El duplicado se chequea por (producto, presentación, lote), no por producto
  -- suelto: agregar el mismo renglón dos veces lo contaría dos veces, pero un
  -- lote NUEVO de un producto que ya está en el snapshot es el caso normal en
  -- farmacia y antes no se podía registrar (C7).
  IF EXISTS (
    SELECT 1 FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id
      AND erp_product_id = p_erp_product_id
      AND COALESCE(presentacion,'') = COALESCE(v_pres,'')
      AND COALESCE(lote,'') = COALESCE(v_lote,'')
  ) THEN
    RAISE EXCEPTION 'LINEA_YA_EXISTE';
  END IF;

  -- sistema 0 e is_vencidos false son la definición de "apareció algo que el
  -- libro no tiene": todo lo que se cuente aquí es sobrante. El costo lo pone
  -- el servidor con el mismo criterio que el snapshot (C3).
  INSERT INTO public.conteo_inventario_items (
    conteo_id, erp_product_id, presentacion, lote, fecha_vencimiento, is_vencidos,
    sistema_cantidad, sistema_inicial, costo_unitario, estado_item, es_agregado_manual)
  VALUES (
    p_conteo_id, p_erp_product_id, v_pres, v_lote, p_fecha_vencimiento, false,
    0, 0, public.conteo_costo_unitario(p_erp_product_id, v_pres), 'PENDIENTE', true)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.agregar_item_conteo(uuid, integer, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agregar_item_conteo(uuid, integer, text, text, date) TO authenticated, service_role;
