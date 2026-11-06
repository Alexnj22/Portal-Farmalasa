SET lock_timeout = '5s';

-- Crear un conteo fallaba SIEMPRE, de cualquier alcance (2026-11-06).
--
-- `i.erp_product_id = ANY((SELECT public.antibioticos_del_cuadre()))`: con el
-- SELECT adentro, Postgres lo lee como `ANY (subconsulta)` —una fila por
-- elemento— y la fila es el arreglo entero, así que compara `integer = integer[]`
-- y lanza 42883. Como es un error de planificación, no de ejecución, rompe la
-- función entera aunque el alcance pedido no sea BAJO_RECETA. PostgREST traduce
-- 42883 a 404 y la pantalla lo mostraba como «no está habilitado». Venía de
-- 20261028220600: desde entonces no se creó ni un conteo (el último, 15-oct).
--
-- El arreglo se calcula una vez, en una variable, y sólo si el alcance lo pide.
-- El resto es la definición viva, sin cambios.
CREATE OR REPLACE FUNCTION public.crear_conteo_inventario(p_branch_id bigint, p_scope_type text, p_scope_filter jsonb DEFAULT NULL::jsonb, p_erp_product_ids integer[] DEFAULT NULL::integer[], p_modo text DEFAULT 'LOTE'::text, p_fuente_sistema text DEFAULT 'HOJA'::text, p_aplica_en_caja boolean DEFAULT false)
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
  v_antibioticos int[];
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
  IF p_fuente_sistema NOT IN ('VIVO','HOJA') THEN
    RAISE EXCEPTION 'FUENTE_SISTEMA_INVALIDA';
  END IF;
  -- Corregir la caja exige saber el lote de cada unidad y lo que el sistema
  -- decía al contarla: por lote y en vivo, sin excepción.
  IF p_aplica_en_caja AND (p_modo <> 'LOTE' OR p_fuente_sistema <> 'VIVO') THEN
    RAISE EXCEPTION 'CAJA_REQUIERE_LOTE_EN_VIVO';
  END IF;

  -- Dos conteos abiertos sobre la misma sucursal se pisan: ambos leen el mismo
  -- stock en vivo y producen diferencias que se contradicen.
  IF EXISTS (SELECT 1 FROM public.conteos_inventario
             WHERE branch_id = p_branch_id AND status IN ('BORRADOR','EN_PROGRESO')) THEN
    RAISE EXCEPTION 'CONTEO_ABIERTO_EN_SUCURSAL';
  END IF;
  -- Y uno que ajusta, con otro que ajusta y todavía no terminó de aplicarse:
  -- los dos medirían contra la misma existencia y la diferencia entraría dos
  -- veces (2026-11-06).
  IF p_aplica_en_caja AND EXISTS (
       SELECT 1 FROM public.conteos_inventario
       WHERE branch_id = p_branch_id AND aplica_en_caja
         AND (status = 'FINALIZADO' OR caja_estado = 'EN_COLA')) THEN
    RAISE EXCEPTION 'CONTEO_POR_APLICAR_EN_SUCURSAL';
  END IF;

  SELECT array_agg(erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map WHERE branch_id = p_branch_id;

  IF v_erp_sucursal_ids IS NULL THEN
    RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP';
  END IF;

  IF p_scope_type = 'BAJO_RECETA' THEN
    v_antibioticos := public.antibioticos_del_cuadre();
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

    p_scope_filter := COALESCE(p_scope_filter, '{}'::jsonb)
      || jsonb_build_object('composicion', v_composicion, 'productos', array_length(v_ciclico_ids, 1));
  END IF;

  INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status, modo, fuente_sistema, aplica_en_caja)
  VALUES (p_branch_id, public.auth_employee_id(), p_scope_type, p_scope_filter, true, 'EN_PROGRESO', p_modo, p_fuente_sistema, p_aplica_en_caja)
  RETURNING id INTO v_conteo_id;

  INSERT INTO public.conteo_inventario_items (
    conteo_id, erp_product_id, source_inventory_id, source_sync_key,
    presentacion, detalle, lote, fecha_vencimiento, is_vencidos,
    sistema_cantidad, sistema_inicial, costo_unitario, grupo_key)
  SELECT
    v_conteo_id,
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
           CASE WHEN p_modo = 'SIMPLE' THEN NULL ELSE i.lote END AS g_lote,
           CASE WHEN p_modo = 'SIMPLE' THEN NULL ELSE i.fecha_vencimiento END AS g_fecha,
           COALESCE(g.grupo_key, 'P:' || upper(btrim(COALESCE(i.presentacion, '')))) AS gkey
    FROM public.inventory i
    LEFT JOIN public.products p ON p.id = i.erp_product_id
    LEFT JOIN public.conteo_presentacion_grupo g
           ON g.product_id = i.erp_product_id
          AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
    WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
      AND (
        p_scope_type = 'TOTAL'
        OR (p_scope_type = 'LABORATORIO' AND p.laboratorio_id = (p_scope_filter->>'laboratorio_id')::int)
        OR (p_scope_type = 'BAJO_RECETA' AND i.erp_product_id = ANY(v_antibioticos))
        OR (p_scope_type = 'MANUAL' AND i.erp_product_id = ANY(p_erp_product_ids))
        OR (p_scope_type = 'CICLICO' AND i.erp_product_id = ANY(v_ciclico_ids))
      )
  ) s
  GROUP BY s.erp_product_id, s.is_vencidos, s.gkey, s.g_lote, s.g_fecha;

  RETURN v_conteo_id;
END;
$function$;
