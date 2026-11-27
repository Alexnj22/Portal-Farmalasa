SET lock_timeout = '5s';

-- Recontar sin poder aprobar (2026-11-27). Hasta hoy el recuento pedía
-- `can_approve` del módulo, el mismo permiso que firma el conteo. La capacidad
-- `conteo_inventario_recontar` deja revisar las diferencias a quien NO firma.
-- Partido de la definición viva (md5 6f0e0ca627229f3cd780a2f4ac12adc1); sólo
-- cambia el chequeo de permiso.
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
  IF NOT (public.auth_has_module_permission('conteo_inventario', 'can_approve')
          OR public.auth_has_module_permission('conteo_inventario_recontar', 'can_view')) THEN
    RAISE EXCEPTION 'SIN_PERMISO_RECUENTO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF v_actor IS NOT NULL AND v_actor = v_item.contado_por THEN
    RAISE EXCEPTION 'RECUENTO_MISMO_CONTADOR';
  END IF;

  -- Mismo criterio que `guardar_conteo_item`: el recuento no puede comparar
  -- contra otra cosa que el primer conteo, o la revisión mediría dos cosas.
  IF v_conteo.fuente_sistema = 'HOJA' THEN
    v_live_sistema := COALESCE(v_item.sistema_inicial, v_item.sistema_cantidad);
  ELSIF v_item.es_agregado_manual THEN
    v_live_sistema := v_item.sistema_cantidad;
  ELSIF v_item.source_sync_key IS NOT NULL THEN
    SELECT COALESCE((SELECT cantidad FROM public.inventory WHERE sync_key = v_item.source_sync_key), 0)
    INTO v_live_sistema;
  ELSE
    SELECT COALESCE(sum(i.cantidad), 0)::int INTO v_live_sistema
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

REVOKE EXECUTE ON FUNCTION public.recontar_conteo_item(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recontar_conteo_item(uuid, integer, text) TO authenticated, service_role;

-- Lo pidió el usuario: Jefe/a de Compras y Logística recuenta Bodega sin aprobar.
-- Guarda «sólo si existe» para el entorno de pruebas.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'conteo_inventario_recontar', true, false, false, 'ALL'
FROM public.roles r
WHERE r.id = 12 AND r.name ILIKE 'Jefe/a de Compras%'
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true;
