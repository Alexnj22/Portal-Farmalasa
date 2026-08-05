-- Conteo sencillo: un renglón por (producto, presentación), sin lote ni vencimiento.
--
-- El módulo nació copiando una fila de `inventory` por cada lote, porque el
-- ajuste contra el sistema se hace lote por lote. Pero contar un anaquel no se
-- hace así: quien cuenta ve la caja de X y anota cuántas hay — partir eso en 14
-- renglones por lote es lo que vuelve impracticable el conteo total.
--
-- El modo vive en la CABECERA (`conteos_inventario.modo`) y no en el alcance,
-- porque son dos ejes distintos: se puede querer un cíclico sencillo o un total
-- por lote. 'LOTE' es el default y es exactamente el comportamiento de hoy:
-- ningún conteo existente cambia, y el cíclico automático del día 15
-- (`crear_conteos_ciclicos_programados`) no se toca.
--
-- La granularidad colapsa lote y vencimiento, NO la presentación. En este
-- catálogo un mismo producto convive como PAQUETE (1x12) y UNIDAD (1x1) —4,437
-- pares producto-sucursal tienen más de una— y sumarlas daría un número que no
-- se puede ajustar contra el sistema, que lleva el stock por presentación.
-- Medido el 2026-08-05 en Salud 1: 3,383 renglones por lote contra 2,777
-- sencillos, con la MISMA suma de unidades (12,599) — no se pierde cantidad,
-- solo el desglose.
--
-- `is_vencidos` también queda en la clave: el stock vencido vive en su propia
-- área del sistema y mezclarlo con el bueno dejaría el renglón irreconciliable
-- (39 renglones del catálogo lo mezclarían).

SET lock_timeout = '5s';

-- ── 1. El modo, en la cabecera ──────────────────────────────────────────────
ALTER TABLE public.conteos_inventario
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'LOTE';

ALTER TABLE public.conteos_inventario
  DROP CONSTRAINT IF EXISTS conteos_inventario_modo_check;
ALTER TABLE public.conteos_inventario
  ADD CONSTRAINT conteos_inventario_modo_check CHECK (modo IN ('LOTE','SIMPLE'));


-- ── 2. crear_conteo_inventario: arma el snapshot agrupado ───────────────────
-- DROP + CREATE y no CREATE OR REPLACE: agregar un parámetro cambia la firma,
-- así que un REPLACE dejaría viva la versión de 4 argumentos y PostgREST no
-- sabría cuál elegir en una llamada sin `p_modo`. Como el parámetro nuevo tiene
-- DEFAULT, un bundle viejo que no lo mande sigue funcionando.
DROP FUNCTION IF EXISTS public.crear_conteo_inventario(bigint, text, jsonb, integer[]);

CREATE FUNCTION public.crear_conteo_inventario(
  p_branch_id bigint,
  p_scope_type text,
  p_scope_filter jsonb DEFAULT NULL::jsonb,
  p_erp_product_ids integer[] DEFAULT NULL::integer[],
  p_modo text DEFAULT 'LOTE')
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo_id uuid;
  v_erp_sucursal_ids int[];
  v_ciclico_ids int[];
  v_composicion jsonb;
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND p_branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF p_scope_type NOT IN ('TOTAL','LABORATORIO','BAJO_RECETA','MANUAL','CICLICO') THEN
    RAISE EXCEPTION 'ALCANCE_INVALIDO';
  END IF;
  IF p_modo NOT IN ('LOTE','SIMPLE') THEN
    RAISE EXCEPTION 'MODO_INVALIDO';
  END IF;

  -- Dos conteos abiertos sobre la misma sucursal se pisan: ambos leen el mismo
  -- stock en vivo y producen diferencias que se contradicen.
  IF EXISTS (SELECT 1 FROM public.conteos_inventario
             WHERE branch_id = p_branch_id AND status IN ('BORRADOR','EN_PROGRESO')) THEN
    RAISE EXCEPTION 'CONTEO_ABIERTO_EN_SUCURSAL';
  END IF;

  SELECT array_agg(erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map WHERE branch_id = p_branch_id;

  IF v_erp_sucursal_ids IS NULL THEN
    RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP';
  END IF;

  -- La muestra se sortea EN EL SERVIDOR: si la eligiera el cliente, elegir qué
  -- se cuenta dejaría de ser un control y pasaría a ser una preferencia.
  IF p_scope_type = 'CICLICO' THEN
    SELECT array_agg(s.erp_product_id),
           jsonb_object_agg(s.segmento, s.n)
    INTO v_ciclico_ids, v_composicion
    FROM (
      SELECT erp_product_id, segmento, count(*) OVER (PARTITION BY segmento) n
      FROM public.seleccionar_muestra_ciclica(p_branch_id, COALESCE((p_scope_filter->>'tamano')::int, 200))
    ) s;

    IF v_ciclico_ids IS NULL THEN RAISE EXCEPTION 'MUESTRA_CICLICA_VACIA'; END IF;

    -- Queda registrado con qué composición se sorteó: un conteo cíclico que no
    -- dice cómo se armó no se puede auditar después.
    p_scope_filter := COALESCE(p_scope_filter, '{}'::jsonb)
      || jsonb_build_object('composicion', v_composicion, 'productos', array_length(v_ciclico_ids, 1));
  END IF;

  -- Siempre incluye TODO el inventario (vencido o no) — el conteo físico debe
  -- reflejar la realidad completa del anaquel/bodega; lo vencido/próximo a
  -- vencer se señala como aviso en la UI, no se excluye del snapshot.
  INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status, modo)
  VALUES (p_branch_id, public.auth_employee_id(), p_scope_type, p_scope_filter, true, 'EN_PROGRESO', p_modo)
  RETURNING id INTO v_conteo_id;

  IF p_modo = 'SIMPLE' THEN
    -- Un renglón por (producto, presentación, área). `source_inventory_id` y
    -- `source_sync_key` van NULL a propósito: el renglón ya no representa UNA
    -- fila del sistema sino la suma de varias, así que no hay una sola a la que
    -- apuntar. Quien relee el stock en vivo para este caso es
    -- `guardar_conteo_item`, que suma el mismo grupo (ver más abajo).
    --
    -- `detalle` es rótulo ("1x12"), no dato de cuadre: se toma el menor del
    -- grupo. Solo 20 renglones de todo el catálogo tienen más de uno.
    INSERT INTO public.conteo_inventario_items (
      conteo_id, erp_product_id, source_inventory_id, source_sync_key,
      presentacion, detalle, lote, fecha_vencimiento, is_vencidos,
      sistema_cantidad, sistema_inicial, costo_unitario)
    SELECT v_conteo_id, i.erp_product_id, NULL, NULL,
           i.presentacion, min(i.detalle), NULL, NULL, i.is_vencidos,
           sum(i.cantidad)::int, sum(i.cantidad)::int,
           public.conteo_costo_unitario(i.erp_product_id, i.presentacion)
    FROM public.inventory i
    LEFT JOIN public.products p ON p.id = i.erp_product_id
    WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
      AND (
        p_scope_type = 'TOTAL'
        OR (p_scope_type = 'LABORATORIO' AND p.laboratorio_id = (p_scope_filter->>'laboratorio_id')::int)
        OR (p_scope_type = 'BAJO_RECETA' AND p.es_antibiotico = true)
        OR (p_scope_type = 'MANUAL' AND i.erp_product_id = ANY(p_erp_product_ids))
        OR (p_scope_type = 'CICLICO' AND i.erp_product_id = ANY(v_ciclico_ids))
      )
    GROUP BY i.erp_product_id, i.presentacion, i.is_vencidos;
  ELSE
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
        OR (p_scope_type = 'CICLICO' AND i.erp_product_id = ANY(v_ciclico_ids))
      );
  END IF;

  RETURN v_conteo_id;
END;
$function$;

-- El DROP se llevó los permisos: hay que volver a ponerlos.
REVOKE ALL ON FUNCTION public.crear_conteo_inventario(bigint, text, jsonb, integer[], text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crear_conteo_inventario(bigint, text, jsonb, integer[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_conteo_inventario(bigint, text, jsonb, integer[], text) TO postgres;
GRANT EXECUTE ON FUNCTION public.crear_conteo_inventario(bigint, text, jsonb, integer[], text) TO service_role;


-- ── 3. guardar_conteo_item: releer el stock en vivo del GRUPO ───────────────
-- El módulo congela el "sistema" en el instante de guardar el renglón, no en el
-- del snapshot, para que un conteo en caliente (sucursal vendiendo) compare
-- contra el stock vigente. En modo LOTE eso es leer la fila por `sync_key`; en
-- SIMPLE es sumar el grupo. Sin esta rama el renglón caería en el atajo de
-- `source_sync_key IS NULL` y compararía contra un snapshot viejo, que es
-- exactamente la diferencia inventada que el módulo evita.
CREATE OR REPLACE FUNCTION public.guardar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text DEFAULT NULL::text, p_estado_item text DEFAULT 'CONTADO'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
  -- --no lo que diga inventory ahora-- es lo que evita que un click de más
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

  -- El orden importa: en SIMPLE todos los renglones del snapshot tienen
  -- `source_sync_key` NULL, así que la rama del modo va ANTES del atajo.
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

  v_diferencia := CASE WHEN p_fisico_cantidad IS NULL THEN NULL ELSE p_fisico_cantidad - v_live_sistema END;

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


-- ── 4. get_conteo_items_search: el "vivo" de cada renglón ───────────────────
-- Mismo criterio que guardar_conteo_item, del lado de la lectura: en SIMPLE el
-- stock del renglón es la suma del grupo. Las dos CTE de stock vivo llevan el
-- modo en su WHERE, así que la que no corresponde no lee nada.
CREATE OR REPLACE FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_erp_product_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, erp_product_id integer, presentacion text, detalle text, lote text, fecha_vencimiento date, is_vencidos boolean, sistema_cantidad integer, fisico_cantidad integer, diferencia integer, estado_item text, nota text, costo_unitario numeric, es_agregado_manual boolean, product_nombre text, es_antibiotico boolean, foto_url text, laboratorio_nombre text, contado_por_nombre text, contado_at timestamp with time zone, fisico_primer_conteo integer, recontado_at timestamp with time zone, recontado_por_nombre text, contado_por_photo_url text, recontado_por_photo_url text, ediciones_count integer, ver_sistema boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_modo text;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id, c.modo INTO v_branch_id, v_modo FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  v_filtro := CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre,
           NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS e_nombre,
           NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS r_nombre,
           e.photo_url AS e_photo, r.photo_url AS r_photo
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN public.employees e ON e.id = ci.contado_por
    LEFT JOIN public.employees r ON r.id = ci.recontado_por
    WHERE ci.conteo_id = p_conteo_id
      AND (p_erp_product_id IS NULL OR ci.erp_product_id = p_erp_product_id)
      AND (p_erp_product_ids IS NULL OR ci.erp_product_id = ANY(p_erp_product_ids))
  ),
  live_inv AS MATERIALIZED (
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
  ),
  filtered AS (
    SELECT b.* FROM base b
    WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
           OR (v_filtro = 'PENDIENTES' AND b.estado_item = 'PENDIENTE')
           OR (v_filtro = 'DIFERENCIA' AND b.diferencia IS NOT NULL AND b.diferencia != 0)
           OR (v_filtro = 'SIN_UBICAR' AND b.estado_item = 'SIN_UBICAR'))
      AND (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.lote,'') || ' ' ||
             coalesce(b.l_nombre,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
    -- `presentacion` como último desempate: en SIMPLE el lote es NULL en todos
    -- los renglones, y sin él dos presentaciones del mismo producto quedaban en
    -- orden arbitrario — o sea con una página inestable entre llamadas.
    ORDER BY b.l_nombre NULLS LAST, b.p_nombre, b.lote, b.presentacion
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    f.id, f.erp_product_id, f.presentacion, f.detalle, f.lote, f.fecha_vencimiento, f.is_vencidos,
    CASE WHEN NOT v_ver THEN NULL
         WHEN f.fisico_cantidad IS NULL AND NOT f.es_agregado_manual
           THEN COALESCE(CASE WHEN v_modo = 'SIMPLE' THEN la.sistema_live ELSE li.sistema_live END, 0)
         ELSE f.sistema_cantidad END,
    f.fisico_cantidad,
    CASE WHEN v_ver THEN f.diferencia END,
    f.estado_item, f.nota,
    CASE WHEN v_ver THEN f.costo_unitario END,
    f.es_agregado_manual,
    f.p_nombre, f.p_es_antibiotico, f.p_foto_url, f.l_nombre,
    f.e_nombre, f.contado_at,
    CASE WHEN v_ver THEN f.fisico_primer_conteo END,
    f.recontado_at, f.r_nombre,
    f.e_photo, f.r_photo,
    (SELECT count(*)::int FROM public.conteo_inventario_item_history h
      WHERE h.item_id = f.id AND h.evento IN ('EDICION', 'BORRADO')),
    v_ver
  FROM filtered f
  LEFT JOIN live_inv li ON li.sync_key = f.source_sync_key
  LEFT JOIN live_agg la ON la.a_pid = f.erp_product_id
                       AND la.a_pres IS NOT DISTINCT FROM f.presentacion
                       AND la.a_venc = f.is_vencidos
  ORDER BY f.l_nombre NULLS LAST, f.p_nombre, f.lote, f.presentacion;
END;
$function$;


-- ── 5. get_conteo_products_page: el total por producto ──────────────────────
CREATE OR REPLACE FUNCTION public.get_conteo_products_page(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_laboratorio_id integer DEFAULT NULL::integer, p_order_by text DEFAULT NULL::text, p_order_dir text DEFAULT 'asc'::text)
 RETURNS TABLE(erp_product_id integer, product_nombre text, laboratorio_nombre text, es_antibiotico boolean, foto_url text, item_count integer, contados_count integer, sistema_total integer, fisico_total integer, diferencia_total integer, con_diferencia_count integer, con_vencidos_count integer, con_proximos_count integer, sin_ubicar_count integer, ver_sistema boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_modo text;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_ob text;
  v_asc boolean := lower(coalesce(p_order_dir, 'asc')) <> 'desc';
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id, c.modo INTO v_branch_id, v_modo FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  v_filtro := CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  -- Lista blanca: cualquier otra cosa cae al orden por defecto. Y en conteo
  -- ciego, ordenar por sistema o por diferencia se ignora — ordenar la lista
  -- por el número que no se muestra lo revela igual, solo más despacio
  -- (es el mismo razonamiento que apaga el filtro "con diferencia").
  v_ob := CASE
            WHEN p_order_by IN ('sistema', 'diferencia') AND NOT v_ver THEN NULL
            WHEN p_order_by IN ('producto', 'laboratorio', 'lotes', 'progreso',
                                'sistema', 'fisico', 'diferencia') THEN p_order_by
            ELSE NULL
          END;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre, COALESCE(p.laboratorio_id, 0) AS p_lab_id
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_laboratorio_id IS NULL OR COALESCE(p.laboratorio_id, 0) = p_laboratorio_id)
  ),
  live_inv AS MATERIALIZED (
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
  ),
  matched AS (
    SELECT DISTINCT b.erp_product_id AS m_erp_product_id FROM base b
    WHERE (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.l_nombre,'') || ' ' ||
             coalesce(b.lote,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
  ),
  with_live AS (
    SELECT b.*,
           CASE
             WHEN b.fisico_cantidad IS NULL AND NOT b.es_agregado_manual
               THEN COALESCE(CASE WHEN v_modo = 'SIMPLE' THEN la.sistema_live ELSE li.sistema_live END, 0)
             ELSE b.sistema_cantidad
           END AS sistema_now
    FROM base b
    LEFT JOIN live_inv li ON li.sync_key = b.source_sync_key
    LEFT JOIN live_agg la ON la.a_pid = b.erp_product_id
                         AND la.a_pres IS NOT DISTINCT FROM b.presentacion
                         AND la.a_venc = b.is_vencidos
    WHERE b.erp_product_id IN (SELECT m.m_erp_product_id FROM matched m)
  ),
  per_product AS (
    SELECT
      w.erp_product_id,
      max(w.p_nombre) AS product_nombre,
      max(w.l_nombre) AS laboratorio_nombre,
      bool_or(w.p_es_antibiotico) AS es_antibiotico,
      max(w.p_foto_url) AS foto_url,
      count(*)::int AS item_count,
      count(*) FILTER (WHERE w.estado_item != 'PENDIENTE')::int AS contados_count,
      sum(w.sistema_now)::int AS sistema_total,
      sum(w.fisico_cantidad)::int AS fisico_total,
      sum(w.diferencia)::int AS diferencia_total,
      count(*) FILTER (WHERE w.diferencia IS NOT NULL AND w.diferencia != 0)::int AS con_diferencia_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento < CURRENT_DATE)::int AS con_vencidos_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento >= CURRENT_DATE AND w.fecha_vencimiento <= CURRENT_DATE + 90)::int AS con_proximos_count,
      count(*) FILTER (WHERE w.estado_item = 'SIN_UBICAR')::int AS sin_ubicar_count
    FROM with_live w
    GROUP BY w.erp_product_id
  ),
  -- Dos claves de orden calculadas —una numérica y una de texto— en vez de SQL
  -- dinámico: la consulta queda estática (se lee, se explica y no admite
  -- inyección ni por descuido), y cada fila solo llena la que corresponde.
  ordenable AS (
    SELECT pp.*,
           CASE v_ob
             WHEN 'lotes'      THEN pp.item_count::numeric
             WHEN 'progreso'   THEN pp.contados_count::numeric / greatest(pp.item_count, 1)
             WHEN 'sistema'    THEN pp.sistema_total::numeric
             WHEN 'fisico'     THEN pp.fisico_total::numeric
             WHEN 'diferencia' THEN pp.diferencia_total::numeric
           END AS ord_num,
           CASE v_ob
             WHEN 'producto'    THEN pp.product_nombre
             WHEN 'laboratorio' THEN pp.laboratorio_nombre
           END AS ord_txt
    FROM per_product pp
  )
  SELECT
    o.erp_product_id, o.product_nombre, o.laboratorio_nombre, o.es_antibiotico, o.foto_url,
    o.item_count, o.contados_count,
    CASE WHEN v_ver THEN o.sistema_total END,
    o.fisico_total,
    CASE WHEN v_ver THEN o.diferencia_total END,
    CASE WHEN v_ver THEN o.con_diferencia_count END,
    o.con_vencidos_count, o.con_proximos_count,
    o.sin_ubicar_count,
    v_ver
  FROM ordenable o
  WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
         OR (v_filtro = 'PENDIENTES' AND o.contados_count < o.item_count)
         OR (v_filtro = 'DIFERENCIA' AND o.con_diferencia_count > 0)
         OR (v_filtro = 'SIN_UBICAR' AND o.sin_ubicar_count > 0))
  ORDER BY
    CASE WHEN v_asc     THEN o.ord_num END ASC  NULLS LAST,
    CASE WHEN NOT v_asc THEN o.ord_num END DESC NULLS LAST,
    CASE WHEN v_asc     THEN o.ord_txt END ASC  NULLS LAST,
    CASE WHEN NOT v_asc THEN o.ord_txt END DESC NULLS LAST,
    -- Desempate y orden por defecto: laboratorio y después producto, que es el
    -- orden del anaquel y por eso el que sirve para recorrerlo contando.
    o.laboratorio_nombre NULLS LAST, o.product_nombre
  LIMIT p_limit OFFSET p_offset;
END;
$function$;


-- ── 6. agregar_item_conteo: en SIMPLE no se pide lote ───────────────────────
CREATE OR REPLACE FUNCTION public.agregar_item_conteo(p_conteo_id uuid, p_erp_product_id integer, p_presentacion text, p_lote text, p_fecha_vencimiento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_pres text := NULLIF(TRIM(p_presentacion), '');
  v_lote text := NULLIF(TRIM(p_lote), '');
  v_fecha date := p_fecha_vencimiento;
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

  -- En SIMPLE el renglón no tiene lote NI vencimiento por definición: se
  -- descartan en vez de rechazarlos, para que un cliente viejo que todavía los
  -- mande no cree un renglón que la lista no sabría mostrar.
  IF v_conteo.modo = 'SIMPLE' THEN
    v_lote := NULL;
    v_fecha := NULL;
    IF v_pres IS NULL THEN
      RAISE EXCEPTION 'PRESENTACION_REQUERIDA';
    END IF;
  ELSIF v_pres IS NULL OR v_lote IS NULL THEN
    RAISE EXCEPTION 'PRESENTACION_Y_LOTE_REQUERIDOS';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_erp_product_id AND activo = true) THEN
    RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO';
  END IF;

  -- El duplicado se chequea por (producto, presentación, lote), no por producto
  -- suelto: agregar el mismo renglón dos veces lo contaría dos veces, pero un
  -- lote NUEVO de un producto que ya está en el snapshot es el caso normal en
  -- farmacia y antes no se podía registrar (C7). En SIMPLE el lote es NULL en
  -- ambos lados, así que la misma condición colapsa a (producto, presentación).
  IF EXISTS (
    SELECT 1 FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id
      AND erp_product_id = p_erp_product_id
      AND COALESCE(presentacion,'') = COALESCE(v_pres,'')
      AND COALESCE(lote,'') = COALESCE(v_lote,'')
  ) THEN
    -- Códigos distintos porque el motivo que se le explica al usuario es
    -- distinto, y ninguno es prefijo del otro (el traductor del cliente busca
    -- por substring).
    IF v_conteo.modo = 'SIMPLE' THEN
      RAISE EXCEPTION 'PRODUCTO_YA_EN_CONTEO';
    ELSE
      RAISE EXCEPTION 'LINEA_YA_EXISTE';
    END IF;
  END IF;

  -- sistema 0 e is_vencidos false son la definición de "apareció algo que el
  -- libro no tiene": todo lo que se cuente aquí es sobrante. El costo lo pone
  -- el servidor con el mismo criterio que el snapshot (C3).
  INSERT INTO public.conteo_inventario_items (
    conteo_id, erp_product_id, presentacion, lote, fecha_vencimiento, is_vencidos,
    sistema_cantidad, sistema_inicial, costo_unitario, estado_item, es_agregado_manual)
  VALUES (
    p_conteo_id, p_erp_product_id, v_pres, v_lote, v_fecha, false,
    0, 0, public.conteo_costo_unitario(p_erp_product_id, v_pres), 'PENDIENTE', true)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;


-- ── 7. editar_lote_conteo_item: no existe en SIMPLE ─────────────────────────
-- La UI esconde el lápiz, pero un filtro que solo vive en el cliente es
-- decorativo — este módulo ya cometió ese error una vez con el <Switch> del
-- conteo ciego.
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
  IF v_conteo.modo = 'SIMPLE' THEN
    RAISE EXCEPTION 'CONTEO_SIMPLE_SIN_LOTE';
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
