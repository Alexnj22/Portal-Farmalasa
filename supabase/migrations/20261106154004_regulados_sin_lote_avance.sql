-- Cuántos productos con lote obligatorio siguen con existencia «sin lote»
-- (GENERICO) en el estante, por sucursal — y, dentro de un conteo que ajusta,
-- cuántos de ésos ya se contaron (2026-11-06).
--
-- Es el avance de la limpieza que hace el conteo que ajusta: cada regulado
-- contado y aprobado deja su existencia en el lote impreso y sale de esta
-- cuenta. Medido el día que nació: entre 766 (La Popular) y 1,160 (Bodega)
-- productos, el 49 a 58% de los regulados de cada sucursal.
--
-- Se cuenta en PRODUCTOS, no en unidades: la existencia del espejo está en la
-- presentación de cada renglón (cajas, blísteres, unidades) y sumarla mezcla
-- cajas de 100 con pastillas sueltas. El área de vencidos no entra: lo vencido
-- se trata aparte.
--
-- DEFINER porque lee `inventory` de varias sucursales; el alcance lo decide el
-- permiso del módulo, igual que el resto del conteo.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_regulados_sin_lote(p_branch_id bigint DEFAULT NULL, p_conteo_id uuid DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_todas boolean;
  v_propia bigint;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_en_conteo json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('conteo_inventario', 'can_view')) THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  v_todas := (SELECT public.auth_module_scope('conteo_inventario')) = 'ALL';
  v_propia := (SELECT public.auth_employee_branch_id());
  IF NOT v_todas AND p_branch_id IS NOT NULL AND p_branch_id IS DISTINCT FROM v_propia THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  IF p_conteo_id IS NOT NULL THEN
    SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;
    IF NOT v_todas AND v_conteo.branch_id IS DISTINCT FROM v_propia THEN
      RAISE EXCEPTION 'FUERA_DE_ALCANCE';
    END IF;
    -- Un regulado del conteo con renglón «sin lote» que el sistema traía con
    -- existencia; «contado» si todos esos renglones se midieron (cerrar como
    -- cero al finalizar no es medir).
    SELECT json_build_object('sin_lote', count(*), 'contados', count(*) FILTER (WHERE x.medido))
    INTO v_en_conteo
    FROM (
      SELECT i.erp_product_id,
             bool_and(i.fisico_cantidad IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM public.conteo_inventario_item_history h
                                      WHERE h.item_id = i.id AND h.evento = 'CIERRE')) AS medido
      FROM public.conteo_inventario_items i
      JOIN public.products p ON p.id = i.erp_product_id AND p.regulado
      WHERE i.conteo_id = p_conteo_id AND NOT i.is_vencidos
        AND public.conteo_lote_es_generico(i.lote) AND COALESCE(i.sistema_inicial, 0) > 0
      GROUP BY i.erp_product_id
    ) x;
  END IF;

  RETURN json_build_object(
    'sucursales', COALESCE((
      SELECT json_agg(json_build_object('branch_id', s.branch_id, 'sucursal', b.name,
                                        'regulados', s.regulados, 'sin_lote', s.sin_lote)
                      ORDER BY b.name)
      FROM (
        SELECT m.branch_id,
               count(DISTINCT i.erp_product_id) AS regulados,
               -- El predicado de `conteo_lote_es_generico` escrito acá: con `SET
               -- search_path` esa función no se inlinea y costaba una llamada por
               -- renglón (17,548): 123 ms, contra 44 así.
               count(DISTINCT i.erp_product_id) FILTER (
                 WHERE COALESCE(btrim(i.lote), '') = '' OR upper(btrim(i.lote)) IN ('GENERICO','GENÉRICO')) AS sin_lote
        FROM public.inventory i
        JOIN public.products p ON p.id = i.erp_product_id AND p.regulado
        JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id
        WHERE i.cantidad > 0 AND NOT i.is_vencidos
          AND (v_todas OR m.branch_id = v_propia)
          AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)
        GROUP BY m.branch_id
      ) s
      JOIN public.branches b ON b.id = s.branch_id), '[]'::json),
    'conteo', v_en_conteo);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_regulados_sin_lote(bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_regulados_sin_lote(bigint, uuid) TO authenticated, service_role;
