-- Al finalizar, el lote vacío de un producto contado cuenta como 0.
--
-- Pedido del usuario (2026-11-28), después de la misma regla en el recuento:
-- «que sirva no sólo para reconteo sino para todo el conteo al hacer nuevos».
--
-- Antes un producto con 5 lotes donde se contaron 2 quedaba «a medio
-- contar»: en un conteo que ajusta frenaba el finalizar («cuenta los que
-- faltan, 0 si no hay»), y en uno que no ajusta los 3 vacíos seguían la suerte
-- de los pendientes (fuera del cálculo, o «no ubicados» con evento CIERRE, que
-- el ajuste no mueve).
--
-- Ahora, al finalizar, en todo producto (por área) con al menos un lote
-- contado, sus lotes sin cantidad pasan a 0 con la existencia leída en ese
-- momento (`conteo_sistema_del_item`) y una entrada CAPTURA en la bitácora: son
-- conteo de verdad, entran al resultado y al ajuste. No se hace al guardar
-- cada lote porque el lote quedaría confirmado (y bloqueado) mientras todavía
-- se está contando el estante. Lo que no se tocó en absoluto sigue siendo
-- «pendiente» y lo decide el diálogo de finalizar, como hasta ahora.
--
-- `conteo_caja_problemas_de` deja de frenar por A_MEDIO_CONTAR mientras el
-- conteo está abierto (al finalizar se llena solo). Las dos funciones se tocan
-- desde su definición VIVA; si un texto no aparece, la migración se cae.

SET lock_timeout = '5s';

-- ── 1. Cuántos quedan, separado: vacíos de un producto contado y sin tocar ─
CREATE OR REPLACE FUNCTION public.get_conteo_pendientes_al_finalizar(p_conteo_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
  WITH c AS (
    SELECT i.id, i.fisico_cantidad,
           bool_or(i.fisico_cantidad IS NOT NULL) OVER (PARTITION BY i.erp_product_id, i.is_vencidos) AS producto_contado
    FROM public.conteo_inventario_items i
    WHERE i.conteo_id = p_conteo_id
  )
  SELECT json_build_object(
    'vacios_de_contados', count(*) FILTER (WHERE fisico_cantidad IS NULL AND producto_contado),
    'sin_contar',         count(*) FILTER (WHERE fisico_cantidad IS NULL AND NOT producto_contado))
  FROM c;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_pendientes_al_finalizar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_pendientes_al_finalizar(uuid) TO authenticated, service_role;

DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- ── 2. Finalizar: primero los vacíos de productos contados ──────────────
  v_def := pg_get_functiondef('public.finalizar_conteo_inventario(uuid,boolean)'::regprocedure);
  v_new := replace(v_def,
    E'  -- Se mide ANTES de cerrar pendientes como cero:',
    E'  -- El lote vacío de un producto contado cuenta como 0 (2026-11-28): es\n'
    || E'  -- conteo, no pendiente. Con la existencia de este momento.\n'
    || E'  WITH vacios AS (\n'
    || E'    SELECT i.id, public.conteo_sistema_del_item(i.id) AS sis\n'
    || E'    FROM public.conteo_inventario_items i\n'
    || E'    WHERE i.conteo_id = p_conteo_id AND i.fisico_cantidad IS NULL\n'
    || E'      AND EXISTS (SELECT 1 FROM public.conteo_inventario_items o\n'
    || E'                  WHERE o.conteo_id = p_conteo_id AND o.erp_product_id = i.erp_product_id\n'
    || E'                    AND o.is_vencidos = i.is_vencidos AND o.fisico_cantidad IS NOT NULL)\n'
    || E'  ), puestos AS (\n'
    || E'    UPDATE public.conteo_inventario_items t\n'
    || E'    SET fisico_cantidad = 0,\n'
    || E'        sistema_cantidad = v.sis,\n'
    || E'        diferencia = -v.sis,\n'
    || E'        estado_item = CASE WHEN v.sis > 0 THEN ''SIN_UBICAR'' ELSE ''CONTADO'' END,\n'
    || E'        contado_por = public.auth_employee_id(),\n'
    || E'        contado_at = now()\n'
    || E'    FROM vacios v WHERE t.id = v.id\n'
    || E'    RETURNING t.id, v.sis\n'
    || E'  )\n'
    || E'  INSERT INTO public.conteo_inventario_item_history\n'
    || E'    (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)\n'
    || E'  SELECT p.id, 0, p.sis, -p.sis, CASE WHEN p.sis > 0 THEN ''SIN_UBICAR'' ELSE ''CONTADO'' END,\n'
    || E'         ''Vacío al finalizar: el producto se contó, este lote cuenta como 0'', public.auth_employee_id(), ''CAPTURA''\n'
    || E'  FROM puestos p;\n\n'
    || E'  -- Se mide ANTES de cerrar pendientes como cero:');
  IF v_new = v_def THEN RAISE EXCEPTION 'finalizar_conteo_inventario: no se encontró el punto de entrada'; END IF;
  EXECUTE v_new;

  -- ── 3. A medio contar no frena mientras el conteo está abierto ──────────
  v_def := pg_get_functiondef('public.conteo_caja_problemas_de(uuid)'::regprocedure);
  v_new := replace(v_def,
    E'  FROM plan pl WHERE pl.a_medio_contar\n',
    E'  FROM plan pl WHERE pl.a_medio_contar\n'
    || E'    -- Abierto, el finalizar lo llena con 0 (2026-11-28): no hay nada que resolver.\n'
    || E'    AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c\n'
    || E'                    WHERE c.id = p_conteo_id AND c.status IN (''BORRADOR'',''EN_PROGRESO''))\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'conteo_caja_problemas_de: no se encontró A_MEDIO_CONTAR'; END IF;
  EXECUTE v_new;
END
$mig$;
