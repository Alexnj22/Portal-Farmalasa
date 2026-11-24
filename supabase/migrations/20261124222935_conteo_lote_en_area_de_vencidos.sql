-- «Lote y vence» también en el área de vencidos (2026-11-24, pedido del
-- usuario: «se puede cambiar el lote / vence del área de vencidos así como en
-- el normal?»). `agregar_item_conteo` creaba el renglón siempre en el estante
-- bueno (`is_vencidos = false` clavado): usarlo desde el área de vencidos
-- habría sacado unidades apartadas al estante de venta. Ahora recibe el área.
--
-- La firma cambia (parámetro nuevo con DEFAULT), así que se borra la vieja:
-- con las dos vivas, la sobrecarga vieja se queda con sus permisos.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.agregar_item_conteo(uuid, integer, text, text, date);

CREATE FUNCTION public.agregar_item_conteo(
  p_conteo_id uuid, p_erp_product_id integer, p_presentacion text, p_lote text,
  p_fecha_vencimiento date DEFAULT NULL::date, p_is_vencidos boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_pres text := NULLIF(TRIM(p_presentacion), '');
  v_lote text := NULLIF(upper(TRIM(p_lote)), '');
  v_fecha date := p_fecha_vencimiento;
  v_venc boolean := COALESCE(p_is_vencidos, false);
  v_regulado boolean;
  v_perecedero boolean;
  v_gkey text;
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

  -- El área de vencidos sólo existe donde el conteo la trajo de la caja (hoy,
  -- Bodega). En una sala sin esa área, el renglón no tendría a dónde ir al
  -- ajustar.
  IF v_venc AND NOT EXISTS (
    SELECT 1 FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND is_vencidos AND NOT es_agregado_manual
  ) THEN
    RAISE EXCEPTION 'CONTEO_SIN_AREA_DE_VENCIDOS';
  END IF;

  SELECT COALESCE(regulado, false), COALESCE(perecedero, false) INTO v_regulado, v_perecedero
  FROM public.products WHERE id = p_erp_product_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO';
  END IF;

  IF v_pres IS NULL THEN
    RAISE EXCEPTION 'PRESENTACION_REQUERIDA';
  END IF;

  -- En SIMPLE el renglón no tiene lote NI vencimiento por definición.
  IF v_conteo.modo = 'SIMPLE' THEN
    v_lote := NULL;
    v_fecha := NULL;
  ELSE
    -- El lote lo pide el producto (2026-11-06): uno que no lleva lote vive en
    -- la caja como GENERICO, y uno que lo lleva no acepta GENERICO —sería
    -- volver a crear existencia sin lote, que es lo que el conteo corrige—.
    IF v_regulado THEN
      IF v_lote IS NULL THEN RAISE EXCEPTION 'LOTE_REQUERIDO'; END IF;
      IF public.conteo_lote_es_generico(v_lote) THEN RAISE EXCEPTION 'LOTE_GENERICO_NO_VALE'; END IF;
    ELSE
      v_lote := 'GENERICO';
    END IF;
    IF (v_regulado OR v_perecedero) AND v_fecha IS NULL THEN
      RAISE EXCEPTION 'VENCE_REQUERIDO';
    END IF;
    IF v_fecha IS NOT NULL AND (v_fecha < DATE '2015-01-01' OR v_fecha > current_date + interval '15 years') THEN
      RAISE EXCEPTION 'VENCE_FUERA_DE_RANGO';
    END IF;
  END IF;

  v_gkey := public.conteo_grupo_key(p_erp_product_id, v_pres);

  -- El duplicado se chequea con la MISMA clave con la que agrupa el snapshot:
  -- producto, área, grupo de presentación, lote y vencimiento.
  IF EXISTS (
    SELECT 1 FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id
      AND erp_product_id = p_erp_product_id
      AND is_vencidos = v_venc
      AND COALESCE(grupo_key,'') = COALESCE(v_gkey,'')
      AND upper(COALESCE(lote,'')) = COALESCE(v_lote,'')
      AND (v_conteo.modo = 'SIMPLE' OR fecha_vencimiento IS NOT DISTINCT FROM v_fecha)
  ) THEN
    IF v_conteo.modo = 'SIMPLE' THEN
      RAISE EXCEPTION 'PRODUCTO_YA_EN_CONTEO';
    ELSE
      RAISE EXCEPTION 'LINEA_YA_EXISTE';
    END IF;
  END IF;

  -- sistema 0 es la definición de "apareció algo que el libro no tiene": todo
  -- lo que se cuente aquí es sobrante, en el área que se pidió. El costo lo
  -- pone el servidor con el mismo criterio que el snapshot (C3).
  INSERT INTO public.conteo_inventario_items (
    conteo_id, erp_product_id, presentacion, lote, fecha_vencimiento, is_vencidos,
    sistema_cantidad, sistema_inicial, costo_unitario, estado_item, es_agregado_manual, grupo_key)
  VALUES (
    p_conteo_id, p_erp_product_id, v_pres, v_lote, v_fecha, v_venc,
    0, 0, public.conteo_costo_unitario(p_erp_product_id, v_pres), 'PENDIENTE', true, v_gkey)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.agregar_item_conteo(uuid, integer, text, text, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agregar_item_conteo(uuid, integer, text, text, date, boolean) TO authenticated, service_role;
