-- El conteo en vivo no le agrega un lote nuevo a un producto que ya se contó.
--
-- `sincronizar_conteo_en_vivo` sólo preguntaba «¿este lote ya tiene renglón?».
-- No preguntaba si el PRODUCTO ya se había contado. Medido el 2026-11-26 en el
-- conteo total de Bodega (creado el 23-nov): Vijosa se contó el 23-nov, el
-- 25-nov 16:58–17:22 UTC se registraron tres compras de Vijosa, y a las
-- 17:35 el conteo agregó 39 lotes como pendientes. Cinco eran de productos ya
-- contados (Ultra Doceplex ampollas 130, Vermagest 60, Ambroxol Nordic 15,
-- Griin Vitamin 4, Fórmula Piernas y Venas 2). Para la sala, «Vijosa ya estaba
-- contado» y de pronto «no está en conteo»; y cerrados con «pendientes como
-- cero» habrían salido como faltante falso por la compra entera.
--
-- La regla: el conteo de un producto vale a la hora en que se contó. Lo que
-- entra después por compra o traslado es un movimiento posterior, no algo que
-- faltó contar. Un lote nuevo entra sólo si su producto (misma presentación,
-- misma sección de vencidos) todavía no tiene NINGÚN renglón con cantidad. Si
-- el producto sigue sin contar, entra como antes: cuando lo cuenten, la
-- mercadería ya va a estar ahí.
--
-- El resto del cuerpo es la definición VIVA (pg_get_functiondef) sin cambios.

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

  -- Los motivos por los que no hay nada que hacer se responden igual, con
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
    v_scope_ids := public.antibioticos_del_cuadre();
  ELSIF v_conteo.scope_type IN ('MANUAL','CICLICO') THEN
    -- Su alcance es una lista elegida (o sorteada) al crear el conteo y no se
    -- guardó en `scope_filter`; se reconstruye desde los renglones que el
    -- conteo ya tiene. Así entra un LOTE nuevo de un producto de la muestra y
    -- NO entra un producto que nadie eligió: agrandar una muestra sorteada
    -- rompe justo lo que la hace auditable.
    SELECT array_agg(DISTINCT erp_product_id) INTO v_scope_ids
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND es_agregado_manual = false;
  END IF;

  -- Un alcance que se resolvió a lista VACÍA no es "todos": es "ninguno", y
  -- `array_agg` sobre cero filas da NULL, que acá significa lo contrario.
  IF v_conteo.scope_type <> 'TOTAL' AND v_scope_ids IS NULL THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'ALCANCE_VACIO', 'productos', '[]'::jsonb);
  END IF;

  v_actor := public.auth_employee_id();

  WITH existentes AS MATERIALIZED (
    -- La cerca es lo que hace rápida a la función entera: sin ella el
    -- planificador empuja los predicados del lote adentro del index scan, se
    -- estima 1 fila donde hay 1,991, y el anti-join se vuelve un nested loop.
    -- Las claves se normalizan acá una vez, para que arriba queden igualdades.
    SELECT erp_product_id, is_vencidos,
           COALESCE(grupo_key, '') AS gk,
           COALESCE(lote, '') AS lt,
           COALESCE(fecha_vencimiento::text, '') AS fv
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id
    UNION ALL
    -- La existencia contra la que se compara un renglón cuya etiqueta se
    -- corrigió: sin esto se lo tomaba por mercadería que llegó después.
    SELECT erp_product_id, is_vencidos,
           COALESCE(grupo_key, ''),
           COALESCE(lote_sistema, ''),
           COALESCE(vence_sistema::text, '')
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND etiqueta_corregida
  ), contados AS MATERIALIZED (
    -- Producto ya contado (2026-11-26): su conteo vale a la hora en que se
    -- hizo, y un lote que entra después es un movimiento posterior. Misma
    -- cerca que `existentes`, por la misma razón.
    SELECT DISTINCT erp_product_id, is_vencidos, COALESCE(grupo_key, '') AS gk
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NOT NULL
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
      AND NOT EXISTS (
      SELECT 1 FROM contados c
      WHERE c.erp_product_id = s.erp_product_id
        AND c.is_vencidos = s.is_vencidos
        AND c.gk = COALESCE(s.gkey, ''))
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
           'Llegó a la sucursal después de iniciar el conteo', v_actor, 'ALTA_EN_VIVO'
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

REVOKE EXECUTE ON FUNCTION public.sincronizar_conteo_en_vivo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_conteo_en_vivo(uuid) TO authenticated, service_role;
