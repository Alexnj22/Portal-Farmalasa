-- El stock vivo del modo SIMPLE faltaba en otras dos funciones.
--
-- Al agregar el conteo sencillo se corrigieron las tres rutas que se conocían
-- —guardar_conteo_item, get_conteo_items_search, get_conteo_products_page— pero
-- la lista salió de la memoria, no del catálogo. Un barrido por
-- `pg_get_functiondef ILIKE '%source_sync_key%'` devuelve SIETE funciones, y dos
-- seguían leyendo el stock vivo por esa clave, que en un conteo sencillo es NULL
-- por definición:
--
-- · `get_conteo_items_jsonb` — la que alimenta TODA la impresión y el CSV.
--   `COALESCE(<fila inexistente>, 0)` daba 0, así que la hoja de conteo salía
--   con la columna Sistema en cero en cada renglón sin contar. Reportado sobre
--   una hoja de La Popular de 2,166 líneas: las 2,166 decían 0. Tras el arreglo,
--   1,705 imprimen su existencia real y 461 están legítimamente en cero; el
--   total da 9,904 unidades, que es exactamente el stock vivo de la sucursal.
-- · `recontar_conteo_item` — caía al atajo `source_sync_key IS NULL` y comparaba
--   el recuento del supervisor contra el snapshot congelado en vez del stock
--   vigente. No daba 0, pero rompía la misma propiedad que el módulo construyó a
--   propósito: el conteo en caliente compara contra lo que el sistema dice AHORA.
--
-- La lección, para que el barrido no haya que repetirlo a mano: la ruta del
-- stock vivo son SIETE funciones, y `source_sync_key` es el hilo que las une.

SET lock_timeout = '5s';

-- ── 1. La impresión y el CSV ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_modo text;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
BEGIN
  SELECT c.branch_id, c.modo INTO v_branch_id, v_modo
  FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  RETURN (
    WITH live_inv AS MATERIALIZED (
      SELECT i.sync_key, i.cantidad::int AS sistema_live
      FROM public.inventory i
      WHERE v_modo <> 'SIMPLE' AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
    ),
    live_agg AS MATERIALIZED (
      SELECT i.erp_product_id AS a_pid, i.presentacion AS a_pres, i.is_vencidos AS a_venc,
             sum(i.cantidad)::int AS sistema_live
      FROM public.inventory i
      WHERE v_modo = 'SIMPLE' AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
      GROUP BY 1, 2, 3
    )
    SELECT coalesce(json_agg(to_json(t)), '[]'::json)
    FROM (
      SELECT ci.id, ci.erp_product_id, ci.presentacion, ci.detalle, ci.lote, ci.fecha_vencimiento, ci.is_vencidos,
        CASE WHEN NOT v_ver THEN NULL
             WHEN ci.fisico_cantidad IS NULL AND NOT ci.es_agregado_manual THEN
               COALESCE(CASE WHEN v_modo = 'SIMPLE' THEN la.sistema_live ELSE li.sistema_live END, 0)
             ELSE ci.sistema_cantidad
        END AS sistema_cantidad,
        CASE WHEN v_ver THEN ci.sistema_inicial END AS sistema_inicial,
        ci.fisico_cantidad,
        CASE WHEN v_ver THEN ci.diferencia END AS diferencia,
        ci.estado_item, ci.nota,
        CASE WHEN v_ver THEN ci.costo_unitario END AS costo_unitario,
        ci.es_agregado_manual,
        CASE WHEN v_ver THEN ci.fisico_primer_conteo END AS fisico_primer_conteo,
        ci.recontado_at,
        p.nombre AS product_nombre, p.es_antibiotico, p.foto_url, p.codigo_barras, l.nombre AS laboratorio_nombre,
        NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS contado_por_nombre,
        NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS recontado_por_nombre,
        ci.contado_at,
        v_ver AS ver_sistema
      FROM public.conteo_inventario_items ci
      LEFT JOIN public.products p ON p.id = ci.erp_product_id
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      LEFT JOIN public.employees e ON e.id = ci.contado_por
      LEFT JOIN public.employees r ON r.id = ci.recontado_por
      LEFT JOIN live_inv li ON li.sync_key = ci.source_sync_key
      LEFT JOIN live_agg la ON la.a_pid = ci.erp_product_id
                           AND la.a_pres IS NOT DISTINCT FROM ci.presentacion
                           AND la.a_venc = ci.is_vencidos
      WHERE ci.conteo_id = p_conteo_id
      -- `presentacion` cierra el orden: en sencillo el lote es NULL en todos los
      -- renglones y sin ella dos presentaciones del mismo producto salían en
      -- orden arbitrario, distinto entre la hoja y el reporte.
      ORDER BY l.nombre NULLS LAST, p.nombre, ci.lote, ci.presentacion
    ) t
  );
END;
$function$;


-- ── 2. El recuento del supervisor ───────────────────────────────────────────
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

  -- Mismo orden y mismo criterio que `guardar_conteo_item`: la rama del modo va
  -- ANTES del atajo de `source_sync_key IS NULL`, porque en sencillo esa clave
  -- es NULL en todos los renglones del snapshot y el atajo se los tragaría.
  IF v_item.es_agregado_manual THEN
    v_live_sistema := v_item.sistema_cantidad;
  ELSIF v_conteo.modo = 'SIMPLE' THEN
    SELECT COALESCE(sum(i.cantidad), 0)::int INTO v_live_sistema
    FROM public.inventory i
    JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id
    WHERE m.branch_id = v_conteo.branch_id
      AND i.erp_product_id = v_item.erp_product_id
      AND i.presentacion IS NOT DISTINCT FROM v_item.presentacion
      AND i.is_vencidos = v_item.is_vencidos;
  ELSIF v_item.source_sync_key IS NULL THEN
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
