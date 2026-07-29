SET lock_timeout = '5s';

-- ─── C6 — Controles que aguanten una auditoría ──────────────────────────────

-- (1) Segregación de funciones. aprobar_conteo_inventario verificaba
-- can_approve pero NO que el aprobador fuera distinto de quien finalizó: los
-- roles 13 y 33 tienen can_edit + can_approve, así que una sola persona podía
-- crear, contar, finalizar y firmar su propio conteo. Firmar el trabajo propio
-- es exactamente lo que un conteo físico existe para evitar.
CREATE OR REPLACE FUNCTION public.aprobar_conteo_inventario(p_conteo_id uuid, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_actor uuid := public.auth_employee_id();
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id AND status = 'FINALIZADO';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO_O_NO_FINALIZADO';
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF v_actor IS NOT NULL AND v_actor = v_conteo.finalizado_por THEN
    RAISE EXCEPTION 'APROBADOR_ES_QUIEN_FINALIZO';
  END IF;

  UPDATE public.conteos_inventario
  SET status = 'CERRADO', aprobado_por = v_actor, aprobado_at = now(), nota_aprobacion = p_nota
  WHERE id = p_conteo_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;


-- (2) El cambio de lote deja rastro. editar_lote_conteo_item no escribía ni
-- historial ni audit_logs: se podía cambiar la identidad de una línea contada
-- sin dejar constancia. (C1 le quitó además el filo: el "sistema" ahora se
-- relee por source_sync_key, así que corregir la etiqueta ya no cambia contra
-- qué fila del ERP se compara — es lo que el propio modal dice que hace.)
CREATE OR REPLACE FUNCTION public.editar_lote_conteo_item(p_item_id uuid, p_lote text, p_fecha_vencimiento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_lote text;
  v_fecha date;
BEGIN
  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  UPDATE public.conteo_inventario_items
  SET lote = NULLIF(TRIM(p_lote), ''),
      fecha_vencimiento = p_fecha_vencimiento
  WHERE id = p_item_id
  RETURNING lote, fecha_vencimiento INTO v_lote, v_fecha;

  IF (v_item.lote, v_item.fecha_vencimiento) IS DISTINCT FROM (v_lote, v_fecha) THEN
    INSERT INTO public.conteo_inventario_item_history (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por)
    VALUES (p_item_id, v_item.fisico_cantidad, v_item.sistema_cantidad, v_item.diferencia, v_item.estado_item,
            format('Etiqueta corregida: lote %s → %s · vence %s → %s',
                   COALESCE(v_item.lote,'—'), COALESCE(v_lote,'—'),
                   COALESCE(v_item.fecha_vencimiento::text,'—'), COALESCE(v_fecha::text,'—')),
            public.auth_employee_id());
  END IF;

  RETURN jsonb_build_object('lote', v_lote, 'fecha_vencimiento', v_fecha);
END;
$function$;


-- (3) El historial ya se muestra en la UI, pero le faltaba el orden explícito
-- y no exponía la nota de corrección con su tipo. Se mantiene la firma.
CREATE OR REPLACE FUNCTION public.get_conteo_item_history(p_item_id uuid)
 RETURNS TABLE(id uuid, fisico_cantidad integer, sistema_cantidad integer, diferencia integer, estado_item text, nota text, contado_por_nombre text, contado_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT h.id, h.fisico_cantidad, h.sistema_cantidad, h.diferencia, h.estado_item, h.nota,
         NULLIF(TRIM(COALESCE(e.first_names,'') || ' ' || COALESCE(e.last_names,'')), '') AS contado_por_nombre,
         h.contado_at
  FROM public.conteo_inventario_item_history h
  LEFT JOIN public.employees e ON e.id = h.contado_por
  WHERE h.item_id = p_item_id
  ORDER BY h.contado_at DESC;
$function$;
