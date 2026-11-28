-- El recuento es del PRODUCTO: lo que se deja vacío cuenta como 0. Y el filtro
-- «Recontados».
--
-- Bodega, reconteo (2026-11-28): «imagina que tiene 5 renglones un producto
-- por lotes / vence distinto, hago reconteo y sólo le pongo a 2, los otros 3
-- no los pongo porque en el reconteo no hay … ¿habrá 5 en vez de 2? … debería
-- tomarlo como 0 si lo dejo vacío».
--
-- Antes, un renglón que no se recontaba se quedaba con el PRIMER conteo, así
-- que el ajuste mezclaba dos conteos del mismo estante: 2 del recuento + 3 del
-- primero. Ahora, el primer renglón que se recuenta de un producto (por área:
-- bodega o vencidos son dos estantes) deja en 0 a sus otros renglones ya
-- contados, con la existencia leída en ese mismo momento y su entrada
-- «RECUENTO» en la bitácora. Lo que después se recuente encima los pisa
-- (vuelven a pasar por `recontar_conteo_item`). Un renglón sin cantidad (fuera
-- del cálculo al finalizar) no se toca: darle un número lo metería al ajuste.
--
-- La lectura de la existencia de un renglón sale a `conteo_sistema_del_item`
-- para que el renglón recontado y los que quedan en 0 midan igual.
--
-- `recontar_conteo_item` se reescribe desde su definición VIVA (2026-11-27,
-- 20261127204838). Las tres de la lista se tocan por reemplazo de texto: si un
-- texto no aparece, la migración se cae.

SET lock_timeout = '5s';

-- ── 1. La existencia contra la que se compara un renglón ─────────────────
CREATE OR REPLACE FUNCTION public.conteo_sistema_del_item(p_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_sistema int4;
BEGIN
  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;

  -- Mismo criterio que `guardar_conteo_item`.
  IF v_conteo.fuente_sistema = 'HOJA' THEN
    v_sistema := COALESCE(v_item.sistema_inicial, v_item.sistema_cantidad);
  ELSIF v_item.es_agregado_manual THEN
    v_sistema := v_item.sistema_cantidad;
  ELSIF v_item.source_sync_key IS NOT NULL THEN
    SELECT COALESCE((SELECT cantidad FROM public.inventory WHERE sync_key = v_item.source_sync_key), 0)
    INTO v_sistema;
  ELSE
    SELECT COALESCE(sum(i.cantidad), 0)::int INTO v_sistema
    FROM public.inventory i
    JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id
    WHERE m.branch_id = v_conteo.branch_id
      AND i.erp_product_id = v_item.erp_product_id
      AND i.is_vencidos = v_item.is_vencidos
      AND v_item.grupo_key IN (
            public.conteo_grupo_key(i.erp_product_id, i.presentacion),
            'P:' || upper(btrim(COALESCE(i.presentacion, ''))))
      AND (v_conteo.modo = 'SIMPLE'
           OR (i.lote IS NOT DISTINCT FROM (CASE WHEN v_item.etiqueta_corregida THEN v_item.lote_sistema ELSE v_item.lote END)
               AND i.fecha_vencimiento IS NOT DISTINCT FROM (CASE WHEN v_item.etiqueta_corregida THEN v_item.vence_sistema ELSE v_item.fecha_vencimiento END)));
  END IF;
  RETURN COALESCE(v_sistema, 0);
END;
$function$;

-- Sólo la llaman las funciones del conteo (DEFINER); nadie de afuera.
REVOKE EXECUTE ON FUNCTION public.conteo_sistema_del_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conteo_sistema_del_item(uuid) TO service_role;

-- ── 2. El recuento ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recontar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_actor uuid := public.auth_employee_id();
  v_live_sistema int4;
  v_diferencia int4;
  v_primero boolean;
  v_otro record;
  v_sis int4;
  v_en_cero jsonb := '[]'::jsonb;
BEGIN
  IF p_fisico_cantidad IS NULL OR p_fisico_cantidad < 0 THEN
    RAISE EXCEPTION 'CANTIDAD_INVALIDA';
  END IF;

  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  -- FOR UPDATE: dos recuentos del mismo producto a la vez no pueden creerse
  -- los dos «el primero» y dejarse en 0 el uno al otro.
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id FOR UPDATE;

  IF v_conteo.status != 'FINALIZADO' THEN
    RAISE EXCEPTION 'CONTEO_NO_ESTA_EN_REVISION';
  END IF;
  IF NOT (public.auth_has_module_permission('conteo_inventario', 'can_approve')
          OR public.auth_has_module_permission('conteo_inventario_recontar', 'can_view')) THEN
    RAISE EXCEPTION 'SIN_PERMISO_RECUENTO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF v_actor IS NOT NULL AND v_actor = v_item.contado_por
     AND NOT public.auth_has_module_permission('conteo_inventario_recontar', 'can_view') THEN
    RAISE EXCEPTION 'RECUENTO_MISMO_CONTADOR';
  END IF;

  -- ¿Es el primer renglón que se recuenta de este producto en este estante?
  v_primero := NOT EXISTS (
    SELECT 1 FROM public.conteo_inventario_items o
    WHERE o.conteo_id = v_item.conteo_id
      AND o.erp_product_id = v_item.erp_product_id
      AND o.is_vencidos = v_item.is_vencidos
      AND o.recontado_at IS NOT NULL);

  -- El recuento no puede comparar contra otra cosa que el primer conteo, o la
  -- revisión mediría dos cosas.
  v_live_sistema := public.conteo_sistema_del_item(p_item_id);
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

  -- El recuento es del producto (2026-11-28): sus otros renglones contados
  -- arrancan en 0 y se pisan con lo que se recuente.
  IF v_primero THEN
    FOR v_otro IN
      SELECT o.id, o.fisico_cantidad FROM public.conteo_inventario_items o
      WHERE o.conteo_id = v_item.conteo_id
        AND o.erp_product_id = v_item.erp_product_id
        AND o.is_vencidos = v_item.is_vencidos
        AND o.id <> p_item_id
        AND o.fisico_cantidad IS NOT NULL
      ORDER BY o.id
    LOOP
      v_sis := public.conteo_sistema_del_item(v_otro.id);

      UPDATE public.conteo_inventario_items
      SET fisico_primer_conteo = COALESCE(fisico_primer_conteo, fisico_cantidad),
          fisico_cantidad = 0,
          sistema_cantidad = v_sis,
          diferencia = -v_sis,
          estado_item = CASE WHEN v_sis > 0 THEN 'SIN_UBICAR' ELSE 'CONTADO' END,
          recontado_por = v_actor,
          recontado_at = now()
      WHERE id = v_otro.id;

      INSERT INTO public.conteo_inventario_item_history
        (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
      VALUES (v_otro.id, 0, v_sis, -v_sis, CASE WHEN v_sis > 0 THEN 'SIN_UBICAR' ELSE 'CONTADO' END,
              'Vacío en el recuento: cuenta como 0', v_actor, 'RECUENTO');

      v_en_cero := v_en_cero || jsonb_build_object(
        'id', v_otro.id, 'sistema_cantidad', v_sis, 'diferencia', -v_sis,
        'estado_item', CASE WHEN v_sis > 0 THEN 'SIN_UBICAR' ELSE 'CONTADO' END,
        'fisico_primer_conteo', v_otro.fisico_cantidad);
    END LOOP;
  END IF;

  PERFORM public.recalcular_totales_conteo(v_item.conteo_id);

  RETURN jsonb_build_object(
    'sistema_cantidad', v_live_sistema,
    'diferencia', v_diferencia,
    'fisico_primer_conteo', COALESCE(v_item.fisico_primer_conteo, v_item.fisico_cantidad),
    'en_cero', v_en_cero
  );
END;
$function$;

-- ── 3. El filtro «Recontados»: productos con algún renglón recontado ─────
DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- La página.
  v_def := pg_get_functiondef('public.get_conteo_products_page'::regproc);
  v_new := replace(v_def,
    E'      count(*) FILTER (WHERE w.estado_item = ''SIN_UBICAR'')::int AS sin_ubicar_count,\n',
    E'      count(*) FILTER (WHERE w.estado_item = ''SIN_UBICAR'')::int AS sin_ubicar_count,\n'
    || E'      count(*) FILTER (WHERE w.recontado_at IS NOT NULL)::int AS recontados_count,\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_page: no se encontró sin_ubicar_count'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'         OR (v_filtro = ''SIN_UBICAR'' AND o.sin_ubicar_count > 0))',
    E'         OR (v_filtro = ''SIN_UBICAR'' AND o.sin_ubicar_count > 0)\n'
    || E'         -- Recontados (2026-11-28): el producto tiene algún renglón recontado.\n'
    || E'         OR (v_filtro = ''RECONTADOS'' AND o.recontados_count > 0))');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_page: no se encontró el filtro'; END IF;
  EXECUTE v_new;

  -- El contador: lo mismo, o la paginación diría otro número.
  v_def := pg_get_functiondef('public.get_conteo_products_count'::regproc);
  v_new := replace(v_def,
    E'    SELECT ci.erp_product_id, ci.estado_item, ci.diferencia, ci.lote, ci.presentacion,\n',
    E'    SELECT ci.erp_product_id, ci.estado_item, ci.diferencia, ci.lote, ci.presentacion, ci.recontado_at,\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_count: no se encontró la base'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'           count(*) FILTER (WHERE b.estado_item = ''SIN_UBICAR'') AS sin_ubicar_count,\n',
    E'           count(*) FILTER (WHERE b.estado_item = ''SIN_UBICAR'') AS sin_ubicar_count,\n'
    || E'           count(*) FILTER (WHERE b.recontado_at IS NOT NULL) AS recontados_count,\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_count: no se encontró per_product'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'         OR (cfg.filtro = ''SIN_UBICAR'' AND per_product.sin_ubicar_count > 0));',
    E'         OR (cfg.filtro = ''SIN_UBICAR'' AND per_product.sin_ubicar_count > 0)\n'
    || E'         OR (cfg.filtro = ''RECONTADOS'' AND per_product.recontados_count > 0));');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_count: no se encontró el filtro'; END IF;
  EXECUTE v_new;

  -- Los renglones: de un producto recontado se ven TODOS sus lotes (el
  -- recuento es del producto, y los que quedaron en 0 también son recuento).
  v_def := pg_get_functiondef('public.get_conteo_items_search(uuid,text,text,integer,integer,integer,integer[],text)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, E'WHERE (v_filtro = ''TODOS'' OR v_filtro IS NULL', ''))) / length(E'WHERE (v_filtro = ''TODOS'' OR v_filtro IS NULL') <> 1 THEN
    RAISE EXCEPTION 'get_conteo_items_search: el filtro no aparece una sola vez';
  END IF;
  v_new := replace(v_def,
    E'WHERE (v_filtro = ''TODOS'' OR v_filtro IS NULL',
    E'WHERE (v_filtro = ''TODOS'' OR v_filtro IS NULL OR v_filtro = ''RECONTADOS''');
  EXECUTE v_new;
END
$mig$;
