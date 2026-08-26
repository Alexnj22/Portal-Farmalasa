-- El alcance se resuelve ANTES, no adentro de la consulta grande.
--
-- `sincronizar_conteo_en_vivo` nacio copiando el `OR` de alcance del snapshot.
-- En `crear_conteo_inventario` eso esta bien: corre una vez al crear el conteo.
-- Aca corre cada vez que alguien entra a la pantalla y cada vez que vuelve a la
-- pestana, y el `scope_type` llega como PARAMETRO -- es una variable de plpgsql,
-- asi que el planificador no puede descartar las ramas que no aplican: el
-- `LEFT JOIN products` queda vivo aunque el conteo sea TOTAL y nadie mire una
-- sola columna de `products`.
--
-- La correccion es no pedirle a la consulta que decida el alcance: se resuelve
-- arriba, en plpgsql, a una lista de productos --o a NULL, que significa
-- "todos"--, y adentro queda UN predicado que no nombra `products`.
--
-- ADVERTENCIA MEDIDA (misma sesion, 2026-08-26): esto NO era el costo. Nueve
-- llamadas seguidas antes y despues del cambio dieron lo mismo, 188 ms. El
-- costo real y su correccion estan en la migracion siguiente
-- (20260826224835): un Nested Loop Anti Join de 2.5 millones de comparaciones
-- por una estimacion de 1 fila. Este cambio se queda porque simplifica y no
-- cuesta nada, no porque haya arreglado algo.

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

  WITH nuevos AS (
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
      SELECT 1 FROM public.conteo_inventario_items t
      WHERE t.conteo_id = p_conteo_id
        AND t.erp_product_id = s.erp_product_id
        AND t.is_vencidos = s.is_vencidos
        AND COALESCE(t.grupo_key, '') = COALESCE(s.gkey, '')
        AND t.lote IS NOT DISTINCT FROM s.g_lote
        AND t.fecha_vencimiento IS NOT DISTINCT FROM s.g_fecha)
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
