-- Un conteo en vivo también se entera de lo que llegó después.
--
-- `crear_conteo_inventario` arma la lista de renglones UNA vez, y hasta hoy esa
-- foto no se movía nunca. Con `fuente_sistema = 'VIVO'` eso deja la mitad de la
-- promesa sin cumplir: el número del sistema de un renglón que YA está sí se
-- vuelve a leer al capturar (`guardar_conteo_item`), pero un producto que entró
-- a la sala después de crear el conteo no tiene renglón, así que no se puede
-- contar y no aparece en ningún faltante ni sobrante. Medido el 2026-08-26 en
-- el conteo de La Popular (creado el 25-ago 16:26 UTC): 12 productos con
-- existencia y 93 unidades sin un renglón donde anotarse.
--
-- El «Agregar» a mano tampoco servía para esto: `agregar_item_conteo` inserta
-- con `sistema_cantidad = 0` clavado —está escrito para «apareció algo que el
-- libro no tiene»—, así que meter ahí un producto que SÍ llegó al sistema lo
-- registraba como sobrante por su cantidad completa.
--
-- Tres decisiones que no son obvias:
--
--  1. **Sólo `VIVO`.** En un conteo `HOJA` el número del sistema es el que se
--     imprimió y no se mueve; un renglón que nadie imprimió no tendría contra
--     qué compararse, y quien camina el anaquel con el papel en la mano no lo
--     vería.
--  2. **Sólo agrega, nunca toca lo contado ni quita nada.** Un renglón que ya
--     tiene cantidad es el trabajo de una persona.
--  3. **MANUAL y CICLICO no crecen con productos nuevos.** Su alcance es una
--     lista elegida (o sorteada) al crear el conteo y no se guardó en
--     `scope_filter`; se reconstruye desde los renglones que el conteo ya
--     tiene, así entra un LOTE nuevo de un producto de la muestra y no entra
--     uno que nadie eligió. Agrandar una muestra sorteada rompe justo lo que la
--     hace auditable.
--
-- El grupo se arma con el MISMO SQL que el snapshot —mismo `LEFT JOIN` a
-- `conteo_presentacion_grupo`, misma presentación ganadora, mismo costo—: si
-- las dos formas de agrupar divergieran, un producto podría entrar dos veces
-- bajo dos claves distintas.

SET lock_timeout = '5s';

-- El alta queda en la bitácora del renglón: un renglón que apareció solo, sin
-- una línea que diga cuándo y por qué, no se puede explicar después contra la
-- hoja con la que se empezó.
ALTER TABLE public.conteo_inventario_item_history
  DROP CONSTRAINT IF EXISTS conteo_item_history_evento_check;
ALTER TABLE public.conteo_inventario_item_history
  ADD CONSTRAINT conteo_item_history_evento_check
  CHECK (evento = ANY (ARRAY['CAPTURA','EDICION','BORRADO','RECUENTO','LOTE','CIERRE','ALTA_EN_VIVO']));

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

  IF v_conteo.scope_type IN ('MANUAL','CICLICO') THEN
    SELECT array_agg(DISTINCT erp_product_id) INTO v_scope_ids
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND es_agregado_manual = false;
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
      LEFT JOIN public.products p ON p.id = i.erp_product_id
      LEFT JOIN public.conteo_presentacion_grupo g
             ON g.product_id = i.erp_product_id
            AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
      WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
        AND (
          v_conteo.scope_type = 'TOTAL'
          OR (v_conteo.scope_type = 'LABORATORIO' AND p.laboratorio_id = (v_conteo.scope_filter->>'laboratorio_id')::int)
          OR (v_conteo.scope_type = 'BAJO_RECETA' AND p.es_antibiotico = true)
          OR (v_conteo.scope_type IN ('MANUAL','CICLICO') AND i.erp_product_id = ANY(v_scope_ids))
        )
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

COMMENT ON FUNCTION public.sincronizar_conteo_en_vivo(uuid) IS
  'Agrega al conteo los renglones que aparecieron en la existencia después de crearlo. Sólo conteos abiertos con fuente_sistema=VIVO; no toca ni quita lo que ya está.';

REVOKE EXECUTE ON FUNCTION public.sincronizar_conteo_en_vivo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_conteo_en_vivo(uuid) TO authenticated, service_role;
