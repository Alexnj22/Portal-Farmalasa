-- El anti-join deja de ser un nested loop de 2.5 millones de comparaciones.
--
-- `sincronizar_conteo_en_vivo` tardaba **188 ms** parejos --nueve llamadas
-- seguidas, sin salto en la sexta, o sea que NO era el plan generico de la
-- regla 1 de CLAUDE.md--. El mismo cuerpo escrito con literales: **24 ms**.
--
-- La migracion anterior culpo al `LEFT JOIN products` que el `OR` de alcance
-- mantenia vivo. **Estaba equivocada, y la medicion lo dijo enseguida**: sacar
-- el join no movio el numero ni un milisegundo. Vale anotarlo, porque la
-- hipotesis era razonable y el instrumento fue lo unico que la desmintio.
--
-- El costo real, leido en el plan:
--
--   Nested Loop Anti Join   Rows Removed by Join Filter: 2,558,585
--     ->  Bitmap Heap Scan on inventory        (2,564 filas)
--     ->  Materialize
--           ->  Index Scan ... conteo_inventario_items (est. rows=1, reales 1,991)
--
-- 2,564 x 999. Y la causa de esa estimacion de UNA fila no es una estadistica
-- vieja (la tabla se autoanalizo ese mismo dia): es que el planificador empuja
-- los dos predicados del lote DENTRO del index scan, y ahi quedan como
-- expresiones --`COALESCE(lote,'') = ''`, `lote IS NOT DISTINCT FROM NULL`--
-- para las que no tiene estadisticas y aplica su 0.5% por defecto. Dos veces:
-- 1,991 x 0.005 x 0.005 -> 1. Con una fila estimada del lado interno, un nested
-- loop parece gratis.
--
-- Tres formas que PARECEN la correccion y no lo son, las tres medidas aca:
--   * cambiar `IS NOT DISTINCT FROM` por `COALESCE(...) = COALESCE(...)`
--     (hasheable): 223 ms -- el planificador los empuja igual.
--   * escribirlo como `LEFT JOIN ... WHERE IS NULL` con la lista en una
--     subconsulta: 225 ms -- la aplana y vuelve al mismo plan.
--   * sacar el join a `products`: 188 ms, sin cambio.
--
-- Lo que si: **un CTE `MATERIALIZED`**. La cerca impide que los predicados se
-- empujen adentro, asi que el CTE se estima por lo que realmente trae --1,991
-- filas, exacto-- y el planificador elige `Hash Anti Join`. 225 ms -> **24.6 ms**
-- con `EXPLAIN (ANALYZE, TIMING OFF)`, y 188 -> 24-27 ms de punta a punta.
--
-- Ojo con leer esto como "los CTE materializados arreglan estimaciones": en
-- `get_conteo_products_count` la cerca NO alcanzo y la salida fue pasar a
-- plpgsql (CLAUDE.md, trampa 4). Aca el problema es el inverso --el CTE es el
-- que TIENE la buena estimacion y lo que sobra es el pushdown--, y por eso
-- funciona.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.sincronizar_conteo_en_vivo(p_conteo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_erp_sucursal_ids int[];
  v_scope_ids int[];
  v_actor uuid;
  v_agregados int := 0;
  v_productos json;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;

  -- Los tres motivos por los que no hay nada que hacer se responden igual, con
  -- `agregados: 0` y el motivo escrito: quien llama es una sincronización de
  -- fondo, y hacerla lanzar convertiría "acá no aplica" en un aviso de error
  -- sobre la cara de alguien que está contando.
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'CONTEO_CERRADO', 'productos', '[]'::jsonb);
  END IF;
  IF v_conteo.fuente_sistema <> 'VIVO' THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'NO_ES_EN_VIVO', 'productos', '[]'::jsonb);
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit')
     OR (public.auth_module_scope('conteo_inventario') <> 'ALL'
         AND v_conteo.branch_id <> public.auth_employee_branch_id()) THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'SIN_PERMISO', 'productos', '[]'::jsonb);
  END IF;

  SELECT array_agg(erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map WHERE branch_id = v_conteo.branch_id;
  IF v_erp_sucursal_ids IS NULL THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'SUCURSAL_SIN_MAPEO_ERP', 'productos', '[]'::jsonb);
  END IF;

  -- El alcance, resuelto a una lista de productos. NULL = sin recorte (TOTAL).
  IF v_conteo.scope_type = 'LABORATORIO' THEN
    SELECT array_agg(id) INTO v_scope_ids FROM public.products
    WHERE laboratorio_id = (v_conteo.scope_filter->>'laboratorio_id')::int;
  ELSIF v_conteo.scope_type = 'BAJO_RECETA' THEN
    SELECT array_agg(id) INTO v_scope_ids FROM public.products WHERE es_antibiotico = true;
  ELSIF v_conteo.scope_type IN ('MANUAL','CICLICO') THEN
    -- Su alcance es una lista elegida (o sorteada) al crear el conteo y no se
    -- guardo en `scope_filter`; se reconstruye desde los renglones que el
    -- conteo ya tiene. Asi entra un LOTE nuevo de un producto de la muestra y
    -- NO entra un producto que nadie eligio: agrandar una muestra sorteada
    -- rompe justo lo que la hace auditable.
    SELECT array_agg(DISTINCT erp_product_id) INTO v_scope_ids
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND es_agregado_manual = false;
  END IF;

  -- Un alcance que se resolvio a lista VACIA no es "todos": es "ninguno", y
  -- devolver `array_agg` sobre cero filas da NULL, que aca significa lo
  -- contrario. Se corta antes de que ese NULL se lea como TOTAL.
  IF v_conteo.scope_type <> 'TOTAL' AND v_scope_ids IS NULL THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'ALCANCE_VACIO', 'productos', '[]'::jsonb);
  END IF;

  v_actor := public.auth_employee_id();

  WITH existentes AS MATERIALIZED (
    -- La cerca es lo que hace rapida a la funcion entera: sin ella el
    -- planificador empuja los predicados del lote adentro del index scan, se
    -- estima 1 fila donde hay 1,991, y el anti-join se vuelve un nested loop.
    -- Las claves se normalizan aca una vez, para que arriba queden igualdades.
    SELECT erp_product_id, is_vencidos,
           COALESCE(grupo_key, '') AS gk,
           COALESCE(lote, '') AS lt,
           COALESCE(fecha_vencimiento::text, '') AS fv
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id
  ), nuevos AS (
    INSERT INTO public.conteo_inventario_items (
      conteo_id, erp_product_id, source_inventory_id, source_sync_key,
      presentacion, detalle, lote, fecha_vencimiento, is_vencidos,
      sistema_cantidad, sistema_inicial, costo_unitario, grupo_key)
    SELECT
      p_conteo_id,
      s.erp_product_id,
      CASE WHEN count(*) = 1 THEN min(s.inv_id) END,
      CASE WHEN count(*) = 1 THEN min(s.sync_key) END,
      (array_agg(s.presentacion ORDER BY s.cantidad DESC, s.presentacion))[1],
      (array_agg(s.detalle      ORDER BY s.cantidad DESC, s.presentacion))[1],
      s.g_lote,
      s.g_fecha,
      s.is_vencidos,
      sum(s.cantidad)::int,
      sum(s.cantidad)::int,
      public.conteo_costo_unitario(
        s.erp_product_id,
        (array_agg(s.presentacion ORDER BY s.cantidad DESC, s.presentacion))[1]),
      s.gkey
    FROM (
      SELECT i.id AS inv_id, i.sync_key, i.erp_product_id, i.presentacion, i.detalle,
             i.cantidad, i.is_vencidos,
             CASE WHEN v_conteo.modo = 'SIMPLE' THEN NULL ELSE i.lote END AS g_lote,
             CASE WHEN v_conteo.modo = 'SIMPLE' THEN NULL ELSE i.fecha_vencimiento END AS g_fecha,
             COALESCE(g.grupo_key, 'P:' || upper(btrim(COALESCE(i.presentacion, '')))) AS gkey
      FROM public.inventory i
      LEFT JOIN public.conteo_presentacion_grupo g
             ON g.product_id = i.erp_product_id
            AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
      WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
        AND (v_scope_ids IS NULL OR i.erp_product_id = ANY(v_scope_ids))
    ) s
    -- El renglón que ya existe no se vuelve a crear, tenga cantidad o no. La
    -- clave es la misma con la que agrupa el snapshot.
    WHERE NOT EXISTS (
      SELECT 1 FROM existentes t
      WHERE t.erp_product_id = s.erp_product_id
        AND t.is_vencidos = s.is_vencidos
        AND t.gk = COALESCE(s.gkey, '')
        AND t.lt = COALESCE(s.g_lote, '')
        AND t.fv = COALESCE(s.g_fecha::text, ''))
    GROUP BY s.erp_product_id, s.is_vencidos, s.gkey, s.g_lote, s.g_fecha
    -- Sólo entra lo que HAY. Un grupo en cero no "llegó" a la sala, y un
    -- renglón que se materializa en cero no le pide nada a quien cuenta: sólo
    -- sube el "faltan N" con trabajo que no existe.
    HAVING sum(s.cantidad) > 0
    RETURNING id, erp_product_id, sistema_cantidad
  ), bitacora AS (
    INSERT INTO public.conteo_inventario_item_history
      (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
    SELECT n.id, NULL, n.sistema_cantidad, NULL, 'PENDIENTE',
           'Llegó a la sala después de iniciar el conteo', v_actor, 'ALTA_EN_VIVO'
    FROM nuevos n
    RETURNING 1
  )
  SELECT count(*)::int,
         COALESCE(json_agg(json_build_object('producto', pr.nombre, 'sistema', n.sistema_cantidad)
                           ORDER BY n.sistema_cantidad DESC), '[]'::json)
  INTO v_agregados, v_productos
  FROM nuevos n LEFT JOIN public.products pr ON pr.id = n.erp_product_id;

  RETURN jsonb_build_object('agregados', v_agregados, 'productos', v_productos::jsonb);
END;
$function$;
