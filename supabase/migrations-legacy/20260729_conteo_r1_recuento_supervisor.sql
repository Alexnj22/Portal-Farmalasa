SET lock_timeout = '5s';

-- ─── R1 — Recuento de variaciones por supervisor ────────────────────────────
-- La causa más común de una diferencia grande no es robo ni merma: es un error
-- de conteo (se saltó una caja, contó blísters en vez de unidades, leyó mal el
-- lote). Ajustar el ERP con eso mete el error en el sistema y encima "explica"
-- una merma que nunca ocurrió.
--
-- El recuento va sobre el conteo YA FINALIZADO y antes de aprobarlo, lo hace
-- alguien con can_approve (el nivel de supervisor del módulo, asignable por rol
-- desde la pantalla de permisos), y NO puede hacerlo quien contó esa línea: un
-- recuento hecho por la misma persona no es un recuento.

ALTER TABLE public.conteo_inventario_items
  ADD COLUMN IF NOT EXISTS fisico_primer_conteo integer,
  ADD COLUMN IF NOT EXISTS recontado_por uuid,
  ADD COLUMN IF NOT EXISTS recontado_at timestamptz;

ALTER TABLE public.conteos_inventario
  ADD COLUMN IF NOT EXISTS total_recontados integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conteo_items_recontado_por_fkey') THEN
    ALTER TABLE public.conteo_inventario_items
      ADD CONSTRAINT conteo_items_recontado_por_fkey
      FOREIGN KEY (recontado_por) REFERENCES public.employees(id);
  END IF;
END $$;


-- ─── Totales: una sola definición ───────────────────────────────────────────
-- finalizar los calculaba inline. Un recuento cambia cantidades DESPUÉS de
-- finalizar, así que si no se recalculan, la cabecera del conteo queda mintiendo
-- respecto de sus propias líneas. Extraído para que no haya dos versiones.
-- No toca total_pendientes ni pendientes_como_cero: esos son la decisión tomada
-- al cerrar, no un agregado que se recalcule.
CREATE OR REPLACE FUNCTION public.recalcular_totales_conteo(p_conteo_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  UPDATE public.conteos_inventario c
  SET total_items = t.n,
      total_contados = t.contados,
      total_diferencias = t.difs,
      total_recontados = t.recontados,
      valor_faltante = t.falt,
      valor_sobrante = t.sobra
  FROM (
    SELECT count(*) n,
           count(*) FILTER (WHERE estado_item != 'PENDIENTE') contados,
           count(*) FILTER (WHERE diferencia IS NOT NULL AND diferencia != 0) difs,
           count(*) FILTER (WHERE recontado_at IS NOT NULL) recontados,
           COALESCE(SUM(GREATEST(-diferencia,0) * COALESCE(costo_unitario,0)),0) falt,
           COALESCE(SUM(GREATEST(diferencia,0) * COALESCE(costo_unitario,0)),0) sobra
    FROM public.conteo_inventario_items WHERE conteo_id = p_conteo_id
  ) t
  WHERE c.id = p_conteo_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.recalcular_totales_conteo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_totales_conteo(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.recontar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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

  INSERT INTO public.conteo_inventario_item_history (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por)
  VALUES (p_item_id, p_fisico_cantidad, v_live_sistema, v_diferencia, 'CONTADO',
          COALESCE(NULLIF(TRIM(p_nota), ''), 'Recuento de supervisor'), v_actor);

  PERFORM public.recalcular_totales_conteo(v_item.conteo_id);

  RETURN jsonb_build_object(
    'sistema_cantidad', v_live_sistema,
    'diferencia', v_diferencia,
    'fisico_primer_conteo', COALESCE(v_item.fisico_primer_conteo, v_item.fisico_cantidad)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.recontar_conteo_item(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recontar_conteo_item(uuid, integer, text) TO authenticated, service_role;


-- ─── finalizar ahora delega el agregado en el helper ────────────────────────
CREATE OR REPLACE FUNCTION public.finalizar_conteo_inventario(p_conteo_id uuid, p_pendientes_como_cero boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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

REVOKE EXECUTE ON FUNCTION public.finalizar_conteo_inventario(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_conteo_inventario(uuid, boolean) TO authenticated, service_role;
