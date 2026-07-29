-- Conteo de Inventario — un guardado sin cambios no debe releer el inventario
--
-- `guardar_conteo_item` releía `inventory` por sync_key en TODA llamada, incluso
-- cuando la cantidad física no cambiaba. Consecuencia: abrir una línea ya
-- confirmada (el lápiz nuevo), salir sin tocar nada, y la existencia del sistema
-- se movía a la de ese instante. Si entre el conteo y ese click hubo una venta,
-- la línea pasaba de cuadrada a "faltante" sin que nadie contara nada — el
-- número que cambió es el del sistema, no el del anaquel.
--
-- El físico es una MEDICIÓN tomada en un momento. Releer la existencia solo se
-- justifica cuando se registra una medición nueva: ahí sí, la diferencia debe
-- medirse contra el sistema del instante del recuento (que es lo que ya hacía).
-- Sin medición nueva, la línea no se toca: ni sistema, ni diferencia, ni
-- contado_por/contado_at, ni fila de historial.
--
-- El guard va DESPUÉS de los chequeos de permiso/alcance a propósito: quien no
-- puede editar tiene que seguir recibiendo SIN_PERMISO, no un no-op silencioso.
--
-- Nota: la vista ya tenía un `lastSaved` que evitaba el guardado redundante en
-- el blur, pero eso es client-side — bastaba un reintento, otra pestaña o un
-- doble submit para pisar el dato. El invariante va en la RPC.

SET lock_timeout = '5s';

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

  -- Nada cambió: la línea queda EXACTAMENTE como estaba. Devolver lo guardado
  -- —no lo que diga inventory ahora— es lo que evita que un click de más
  -- convierta una línea cuadrada en un faltante inventado.
  IF v_item.fisico_cantidad IS NOT DISTINCT FROM p_fisico_cantidad
     AND v_item.nota IS NOT DISTINCT FROM p_nota
     AND v_item.estado_item IS NOT DISTINCT FROM p_estado_item THEN
    RETURN jsonb_build_object(
      'sistema_cantidad', v_item.sistema_cantidad,
      'diferencia', v_item.diferencia,
      'evento', 'SIN_CAMBIO'
    );
  END IF;

  IF v_item.es_agregado_manual OR v_item.source_sync_key IS NULL THEN
    -- Producto/lote que no estaba en el snapshot original: no hay fila real
    -- de inventory que releer, se queda en el sistema=0 con el que se creó.
    v_live_sistema := v_item.sistema_cantidad;
  ELSE
    -- sync_key es UNIQUE: esto lee UNA fila, la misma que originó la línea.
    -- Si el ERP ya no la tiene (lote agotado), 0 es la respuesta correcta.
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
