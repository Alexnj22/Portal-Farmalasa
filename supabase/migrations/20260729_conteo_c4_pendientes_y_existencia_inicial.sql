SET lock_timeout = '5s';

-- ─── C4 — Lo no contado es una decisión, no un silencio ─────────────────────
-- Dos problemas distintos con la misma raíz: el módulo no dejaba constancia de
-- lo que NO se hizo.
--
-- (a) guardar_conteo_item PISA sistema_cantidad con el valor en vivo. La
--     existencia que el libro tenía al abrir el conteo se destruía en el primer
--     guardado y nunca se archivó — después de finalizar era imposible
--     responder "¿qué decía el sistema cuando empezamos?", que es justo la
--     pregunta de un auditor. sistema_inicial la conserva.
--
-- (b) finalizar solo calculaba diferencia donde fisico_cantidad IS NOT NULL.
--     Las líneas nunca tocadas quedaban en NULL: fuera de total_diferencias,
--     fuera de valor_faltante y fuera de valor_sobrante. Un conteo donde se
--     contó el 5% se finalizaba y se veía "sin diferencias". Ahora hay que
--     decidir explícitamente qué son esos pendientes, y el número se persiste.

ALTER TABLE public.conteo_inventario_items
  ADD COLUMN IF NOT EXISTS sistema_inicial integer;

ALTER TABLE public.conteos_inventario
  ADD COLUMN IF NOT EXISTS total_pendientes integer,
  ADD COLUMN IF NOT EXISTS pendientes_como_cero boolean;

-- Backfill: para las líneas nunca guardadas, sistema_cantidad SIGUE siendo el
-- valor del snapshot. Para las ya guardadas, el primer registro del historial
-- append-only es lo más cercano a la existencia inicial que quedó.
UPDATE public.conteo_inventario_items ci
SET sistema_inicial = COALESCE(
      (SELECT h.sistema_cantidad
       FROM public.conteo_inventario_item_history h
       WHERE h.item_id = ci.id
       ORDER BY h.contado_at
       LIMIT 1),
      ci.sistema_cantidad)
WHERE ci.sistema_inicial IS NULL;


-- ─── El snapshot archiva la existencia inicial ──────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_conteo_inventario(p_branch_id bigint, p_scope_type text, p_scope_filter jsonb DEFAULT NULL::jsonb, p_erp_product_ids integer[] DEFAULT NULL::integer[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo_id uuid;
  v_erp_sucursal_ids int[];
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND p_branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF p_scope_type NOT IN ('TOTAL','LABORATORIO','BAJO_RECETA','MANUAL') THEN
    RAISE EXCEPTION 'ALCANCE_INVALIDO';
  END IF;

  -- Dos conteos abiertos sobre la misma sucursal se pisan: ambos leen el mismo
  -- stock en vivo y producen diferencias que se contradicen (C7).
  IF EXISTS (SELECT 1 FROM public.conteos_inventario
             WHERE branch_id = p_branch_id AND status IN ('BORRADOR','EN_PROGRESO')) THEN
    RAISE EXCEPTION 'CONTEO_ABIERTO_EN_SUCURSAL';
  END IF;

  SELECT array_agg(erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map WHERE branch_id = p_branch_id;

  IF v_erp_sucursal_ids IS NULL THEN
    RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP';
  END IF;

  -- Siempre incluye TODO el inventario (vencido o no) — el conteo físico debe
  -- reflejar la realidad completa del anaquel/bodega; lo vencido/próximo a
  -- vencer se señala como aviso en la UI, no se excluye del snapshot.
  INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status)
  VALUES (p_branch_id, public.auth_employee_id(), p_scope_type, p_scope_filter, true, 'EN_PROGRESO')
  RETURNING id INTO v_conteo_id;

  INSERT INTO public.conteo_inventario_items (conteo_id, erp_product_id, source_inventory_id, source_sync_key, presentacion, detalle, lote, fecha_vencimiento, is_vencidos, sistema_cantidad, sistema_inicial, costo_unitario)
  SELECT v_conteo_id, i.erp_product_id, i.id, i.sync_key, i.presentacion, i.detalle, i.lote, i.fecha_vencimiento, i.is_vencidos, i.cantidad, i.cantidad,
         public.conteo_costo_unitario(i.erp_product_id, i.presentacion)
  FROM public.inventory i
  LEFT JOIN public.products p ON p.id = i.erp_product_id
  WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
    AND (
      p_scope_type = 'TOTAL'
      OR (p_scope_type = 'LABORATORIO' AND p.laboratorio_id = (p_scope_filter->>'laboratorio_id')::int)
      OR (p_scope_type = 'BAJO_RECETA' AND p.es_antibiotico = true)
      OR (p_scope_type = 'MANUAL' AND i.erp_product_id = ANY(p_erp_product_ids))
    );

  RETURN v_conteo_id;
END;
$function$;


-- ─── Finalizar exige decidir qué son los pendientes ─────────────────────────
-- El parámetro nuevo tiene DEFAULT, así que hay que soltar la firma vieja: si
-- no, PostgREST ve dos sobrecargas y no sabe cuál llamar.
DROP FUNCTION IF EXISTS public.finalizar_conteo_inventario(uuid);

CREATE OR REPLACE FUNCTION public.finalizar_conteo_inventario(p_conteo_id uuid, p_pendientes_como_cero boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_total_items int;
  v_total_contados int;
  v_total_dif int;
  v_total_pend int;
  v_valor_falt numeric;
  v_valor_sobra numeric;
BEGIN
  SELECT branch_id INTO v_branch_id FROM public.conteos_inventario WHERE id = p_conteo_id AND status IN ('BORRADOR','EN_PROGRESO');
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO_O_YA_FINALIZADO';
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  SELECT count(*) INTO v_total_pend
  FROM public.conteo_inventario_items
  WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NULL;

  IF p_pendientes_como_cero THEN
    -- Conteo exhaustivo del área: lo que no apareció en el anaquel es cero
    -- físico, y su faltante es real. Queda como SIN_UBICAR — no como CONTADO —
    -- para que el reporte distinga lo que alguien contó de lo que se dio por
    -- ausente al cerrar. Se registra en el historial append-only como cualquier
    -- otra escritura de conteo.
    INSERT INTO public.conteo_inventario_item_history (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por)
    SELECT id, 0, sistema_cantidad, 0 - sistema_cantidad, 'SIN_UBICAR',
           'Cerrado como no ubicado al finalizar el conteo', public.auth_employee_id()
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NULL;

    UPDATE public.conteo_inventario_items
    SET fisico_cantidad = 0,
        diferencia = 0 - sistema_cantidad,
        estado_item = 'SIN_UBICAR',
        contado_por = COALESCE(contado_por, public.auth_employee_id()),
        contado_at = COALESCE(contado_at, now())
    WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NULL;
  END IF;

  UPDATE public.conteo_inventario_items
  SET diferencia = fisico_cantidad - sistema_cantidad
  WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NOT NULL;

  SELECT
    count(*),
    count(*) FILTER (WHERE estado_item != 'PENDIENTE'),
    count(*) FILTER (WHERE diferencia IS NOT NULL AND diferencia != 0),
    COALESCE(SUM(GREATEST(-diferencia,0) * COALESCE(costo_unitario,0)),0),
    COALESCE(SUM(GREATEST(diferencia,0) * COALESCE(costo_unitario,0)),0)
  INTO v_total_items, v_total_contados, v_total_dif, v_valor_falt, v_valor_sobra
  FROM public.conteo_inventario_items WHERE conteo_id = p_conteo_id;

  UPDATE public.conteos_inventario
  SET status = 'FINALIZADO',
      finalizado_por = public.auth_employee_id(),
      finalizado_at = now(),
      total_items = v_total_items,
      total_contados = v_total_contados,
      total_diferencias = v_total_dif,
      total_pendientes = v_total_pend,
      pendientes_como_cero = p_pendientes_como_cero,
      valor_faltante = v_valor_falt,
      valor_sobrante = v_valor_sobra
  WHERE id = p_conteo_id;

  RETURN jsonb_build_object(
    'total_items', v_total_items, 'total_contados', v_total_contados,
    'total_diferencias', v_total_dif, 'total_pendientes', v_total_pend,
    'pendientes_como_cero', p_pendientes_como_cero,
    'valor_faltante', v_valor_falt, 'valor_sobrante', v_valor_sobra
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finalizar_conteo_inventario(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_conteo_inventario(uuid, boolean) TO authenticated, service_role;
