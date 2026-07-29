-- Conteo de Inventario — el historial dice QUÉ pasó, no solo cuándo
--
-- `conteo_inventario_item_history` guardaba las cuatro clases de evento en filas
-- indistinguibles: la captura inicial, una corrección de cantidad, el recuento
-- del supervisor y el cierre como no-ubicado se veían igual en el modal (mismo
-- nombre, misma fecha, mismos números). El único indicio era el texto de `nota`,
-- que además el usuario puede pisar. Sin discriminador, "¿quién puso esta
-- cantidad y quién la cambió después?" no se contesta desde la tabla.
--
-- La tabla está vacía al aplicar esto (0 filas: el módulo no ha corrido en prod),
-- así que no hay backfill que hacer y la columna entra NOT NULL de una.
--
-- CAPTURA  = fisico_cantidad pasó de NULL a un valor: quien agregó la cantidad.
-- EDICION  = ya tenía valor y se cambió: quien la editó.
-- BORRADO  = se vació la cantidad (vuelve a PENDIENTE).
-- RECUENTO = recuento de supervisor (recontar_conteo_item).
-- LOTE     = corrección de etiqueta lote/vencimiento, la cantidad no cambió.
-- CIERRE   = se dio por no ubicado al finalizar (pendientes_como_cero).

SET lock_timeout = '5s';

ALTER TABLE public.conteo_inventario_item_history
    ADD COLUMN IF NOT EXISTS evento text NOT NULL DEFAULT 'EDICION';

ALTER TABLE public.conteo_inventario_item_history
    DROP CONSTRAINT IF EXISTS conteo_item_history_evento_check;
ALTER TABLE public.conteo_inventario_item_history
    ADD CONSTRAINT conteo_item_history_evento_check
    CHECK (evento IN ('CAPTURA', 'EDICION', 'BORRADO', 'RECUENTO', 'LOTE', 'CIERRE'));

-- ── guardar_conteo_item: distingue captura de edición ────────────────────────
CREATE OR REPLACE FUNCTION public.guardar_conteo_item(
    p_item_id uuid,
    p_fisico_cantidad integer,
    p_nota text DEFAULT NULL::text,
    p_estado_item text DEFAULT 'CONTADO'::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_live_sistema int4;
  v_diferencia int4;
  v_evento text;
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
  IF p_estado_item NOT IN ('PENDIENTE','CONTADO','SIN_UBICAR') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO';
  END IF;

  IF v_item.es_agregado_manual OR v_item.source_sync_key IS NULL THEN
    -- Producto/lote que no estaba en el snapshot original: no hay fila real
    -- de inventory que releer, se queda en el sistema=0 con el que se creó.
    v_live_sistema := v_item.sistema_cantidad;
  ELSE
    -- sync_key es UNIQUE: esto lee UNA fila, la misma que originó la línea.
    -- Si el ERP ya no la tiene (lote agotado), 0 es la respuesta correcta.
    -- Esto es también lo que hace que "editar una línea ya confirmada"
    -- refresque la existencia: el sistema se relee en el instante del guardado,
    -- no se arrastra el del snapshot.
    SELECT COALESCE((SELECT cantidad FROM public.inventory WHERE sync_key = v_item.source_sync_key), 0)
    INTO v_live_sistema;
  END IF;

  v_diferencia := CASE WHEN p_fisico_cantidad IS NULL THEN NULL ELSE p_fisico_cantidad - v_live_sistema END;

  -- Quién PUSO la cantidad vs quién la CAMBIÓ: la transición desde NULL es la
  -- captura, y es el dato que la vista muestra con foto y hora en la línea.
  v_evento := CASE
    WHEN v_item.fisico_cantidad IS NULL AND p_fisico_cantidad IS NOT NULL THEN 'CAPTURA'
    WHEN v_item.fisico_cantidad IS NOT NULL AND p_fisico_cantidad IS NULL THEN 'BORRADO'
    ELSE 'EDICION'
  END;

  UPDATE public.conteo_inventario_items
  SET fisico_cantidad = p_fisico_cantidad,
      sistema_cantidad = v_live_sistema,
      diferencia = v_diferencia,
      estado_item = p_estado_item,
      nota = p_nota,
      contado_por = public.auth_employee_id(),
      contado_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.conteo_inventario_item_history
    (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
  VALUES (p_item_id, p_fisico_cantidad, v_live_sistema, v_diferencia, p_estado_item, p_nota,
          public.auth_employee_id(), v_evento);

  RETURN jsonb_build_object('sistema_cantidad', v_live_sistema, 'diferencia', v_diferencia, 'evento', v_evento);
END;
$function$;

-- ── recontar_conteo_item: evento RECUENTO ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.recontar_conteo_item(
    p_item_id uuid,
    p_fisico_cantidad integer,
    p_nota text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_actor uuid := public.auth_employee_id();
  v_live_sistema int4;
  v_diferencia int4;
BEGIN
  IF p_fisico_cantidad IS NULL OR p_fisico_cantidad < 0 THEN
    RAISE EXCEPTION 'CANTIDAD_INVALIDA';
  END IF;

  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;

  -- Solo entre finalizar y aprobar: antes es el conteo normal, después está
  -- firmado y el ajuste ya salió al ERP.
  IF v_conteo.status != 'FINALIZADO' THEN
    RAISE EXCEPTION 'CONTEO_NO_ESTA_EN_REVISION';
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO_RECUENTO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF v_actor IS NOT NULL AND v_actor = v_item.contado_por THEN
    RAISE EXCEPTION 'RECUENTO_MISMO_CONTADOR';
  END IF;

  -- El sistema se relee igual que en el conteo: la diferencia del recuento se
  -- mide contra la existencia vigente en el instante del recuento, no contra la
  -- que había cuando se contó la primera vez.
  IF v_item.es_agregado_manual OR v_item.source_sync_key IS NULL THEN
    v_live_sistema := v_item.sistema_cantidad;
  ELSE
    SELECT COALESCE((SELECT cantidad FROM public.inventory WHERE sync_key = v_item.source_sync_key), 0)
    INTO v_live_sistema;
  END IF;

  v_diferencia := p_fisico_cantidad - v_live_sistema;

  UPDATE public.conteo_inventario_items
  SET fisico_primer_conteo = COALESCE(fisico_primer_conteo, fisico_cantidad),
      fisico_cantidad = p_fisico_cantidad,
      sistema_cantidad = v_live_sistema,
      diferencia = v_diferencia,
      estado_item = CASE WHEN p_fisico_cantidad = 0 AND v_live_sistema > 0 THEN 'SIN_UBICAR' ELSE 'CONTADO' END,
      nota = COALESCE(NULLIF(TRIM(p_nota), ''), nota),
      recontado_por = v_actor,
      recontado_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.conteo_inventario_item_history
    (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
  VALUES (p_item_id, p_fisico_cantidad, v_live_sistema, v_diferencia, 'CONTADO',
          COALESCE(NULLIF(TRIM(p_nota), ''), 'Recuento de supervisor'), v_actor, 'RECUENTO');

  PERFORM public.recalcular_totales_conteo(v_item.conteo_id);

  RETURN jsonb_build_object(
    'sistema_cantidad', v_live_sistema,
    'diferencia', v_diferencia,
    'fisico_primer_conteo', COALESCE(v_item.fisico_primer_conteo, v_item.fisico_cantidad)
  );
END;
$function$;

-- ── editar_lote_conteo_item: evento LOTE ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.editar_lote_conteo_item(
    p_item_id uuid,
    p_lote text,
    p_fecha_vencimiento date DEFAULT NULL::date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
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
    INSERT INTO public.conteo_inventario_item_history
      (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
    VALUES (p_item_id, v_item.fisico_cantidad, v_item.sistema_cantidad, v_item.diferencia, v_item.estado_item,
            format('Etiqueta corregida: lote %s → %s · vence %s → %s',
                   COALESCE(v_item.lote,'—'), COALESCE(v_lote,'—'),
                   COALESCE(v_item.fecha_vencimiento::text,'—'), COALESCE(v_fecha::text,'—')),
            public.auth_employee_id(), 'LOTE');
  END IF;

  RETURN jsonb_build_object('lote', v_lote, 'fecha_vencimiento', v_fecha);
END;
$function$;

-- ── finalizar_conteo_inventario: evento CIERRE ──────────────────────────────
CREATE OR REPLACE FUNCTION public.finalizar_conteo_inventario(
    p_conteo_id uuid,
    p_pendientes_como_cero boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_total_pend int;
  v_res public.conteos_inventario%ROWTYPE;
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
    -- ausente al cerrar.
    INSERT INTO public.conteo_inventario_item_history
      (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
    SELECT id, 0, sistema_cantidad, 0 - sistema_cantidad, 'SIN_UBICAR',
           'Cerrado como no ubicado al finalizar el conteo', public.auth_employee_id(), 'CIERRE'
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

  UPDATE public.conteos_inventario
  SET status = 'FINALIZADO',
      finalizado_por = public.auth_employee_id(),
      finalizado_at = now(),
      total_pendientes = v_total_pend,
      pendientes_como_cero = p_pendientes_como_cero
  WHERE id = p_conteo_id;

  PERFORM public.recalcular_totales_conteo(p_conteo_id);

  SELECT * INTO v_res FROM public.conteos_inventario WHERE id = p_conteo_id;

  RETURN jsonb_build_object(
    'total_items', v_res.total_items, 'total_contados', v_res.total_contados,
    'total_diferencias', v_res.total_diferencias, 'total_pendientes', v_res.total_pendientes,
    'pendientes_como_cero', v_res.pendientes_como_cero,
    'valor_faltante', v_res.valor_faltante, 'valor_sobrante', v_res.valor_sobrante
  );
END;
$function$;
