-- Revisión de factor: la existencia que dejó un cambio de presentación, en los
-- DOS sentidos y sólo donde estaba en el momento del cambio (2026-10-29).
--
-- La caja guarda la existencia en su unidad base (la presentación de factor 1)
-- y la reparte entre presentaciones al informarla. Cuando la presentación que
-- ERA la unidad cambia de tamaño, el número guardado se queda y pasa a leerse
-- en la medida nueva:
--
--   achica  CAJA 1x16 → 1x1: había 1 caja = 16 guardadas; ahora 16 cajas.
--           Se descartan 15.                                 (ya existía)
--   crece   CAJA 1x1 → 1x24: había 1 caja = 1 guardada; ahora 1 tableta
--           (0 cajas). Se carga 1 caja.                      (nuevo)
--
-- Dos defectos de la versión anterior, medidos en la auditoría del 29-oct:
--   * la pantalla volvía a buscar en TODO el inventario del producto durante
--     120 días, así que una compra nueva de ≥16 cajas salía como «muestra 20,
--     son 1, se descartan 19» — con el botón de descarte al lado;
--   * el sentido «crece» no existía: el aviso salía y la existencia no.
--
-- Ahora el proceso saca UNA foto al convertir (`existencia_por_corregir`) y la
-- pantalla ofrece sólo esas filas mientras sigan exactamente como estaban.
SET lock_timeout = '5s';

-- ── 1. La foto ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.existencia_por_corregir(
  p_producto integer, p_tipo text, p_de integer, p_a integer, p_desde timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v jsonb := '[]'::jsonb;
BEGIN
  IF p_de > 1 AND p_a = 1 THEN
    -- La unidad creció: cada fila que muestra al menos una caja vieja entera.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'sentido', 'achica',
             'erp_sucursal_id', i.erp_sucursal_id,
             'presentacion', trim(i.presentacion),
             'lote', i.lote, 'vence', i.fecha_vencimiento,
             'muestra', i.cantidad)
           ORDER BY i.erp_sucursal_id, i.lote), '[]'::jsonb)
      INTO v
      FROM public.inventory i
     WHERE i.erp_product_id = p_producto
       AND NOT i.is_vencidos
       AND i.cantidad >= p_de
       AND (p_tipo IS NULL OR upper(trim(i.presentacion)) = p_tipo);

  ELSIF p_de = 1 AND p_a > 1
        -- Sólo si la presentación que cambió ERA la unidad. Si el producto
        -- tiene otra (UNIDAD, BLISTER…), la existencia ya estaba guardada en
        -- ésa y no hay nada que convertir: Alerkem, Distem y Reversal Flex
        -- pasaron de 1 a N con una presentación chica al lado, y su
        -- existencia está bien (medido: 1 caja = 20 en cada sala de Reversal).
        AND p_tipo IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.product_precios pp
            JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
           WHERE pp.product_id = p_producto AND pp.activo AND pp.factor > 0
             AND upper(trim(pr.tipo)) <> p_tipo) THEN
    -- La unidad se achicó. Lo que había no se ve en el inventario de hoy
    -- (1 guardada con caja de 24 = 0 cajas), así que sale de la foto diaria
    -- ANTERIOR al cambio: ahí se contó con el tamaño viejo.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'sentido', 'crece',
             'erp_sucursal_id', d.erp_sucursal_id,
             'presentacion', coalesce(l.presentacion, p_tipo),
             'lote', l.lote, 'vence', l.fecha_vencimiento,
             'muestra', d.unidades,
             -- Lo que el inventario de hoy muestra si nadie tocó nada: la
             -- pantalla lo compara para saber si la foto sigue vigente.
             'esperado', (d.unidades / p_a) * p_a)
           ORDER BY d.erp_sucursal_id), '[]'::jsonb)
      INTO v
      FROM (SELECT DISTINCT ON (x.erp_sucursal_id) x.erp_sucursal_id, x.unidades
              FROM public.inventory_daily x
             WHERE x.erp_product_id = p_producto
               AND x.fecha BETWEEN (p_desde AT TIME ZONE 'America/El_Salvador')::date - 3
                               AND (p_desde AT TIME ZONE 'America/El_Salvador')::date
               AND x.created_at < p_desde
             ORDER BY x.erp_sucursal_id, x.fecha DESC) d
      LEFT JOIN LATERAL (
              SELECT trim(i.presentacion) AS presentacion, i.lote, i.fecha_vencimiento
                FROM public.inventory i
               WHERE i.erp_product_id = p_producto
                 AND i.erp_sucursal_id = d.erp_sucursal_id
                 AND NOT i.is_vencidos
               ORDER BY i.cantidad DESC, i.lote
               LIMIT 1) l ON true
     WHERE d.unidades > 0;
  END IF;

  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.existencia_por_corregir(integer, text, integer, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.existencia_por_corregir(integer, text, integer, integer, timestamptz)
  TO service_role;

-- ── 2. El proceso saca la foto ────────────────────────────────────────────
-- Parte de la definición VIVA del 2026-10-29. Cambia: `_cf_linea` lleva el
-- tipo de la presentación, y el paso 9 guarda `existencia_por_corregir` (los
-- dos sentidos) en vez de `existencia_a_revisar` (sólo «achica», por sala).
CREATE OR REPLACE FUNCTION public.procesar_cambios_de_factor()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ids        bigint[];
  v_productos  integer[];
  v_ajustados  integer[];
  v_dias       integer;
  v_reescritas integer := 0;
  v_convertidas integer := 0;
  v_calc       jsonb := '[]'::jsonb;
  v_r          jsonb;
  v_pub        jsonb;
  v_sala       integer;
  v_dest       uuid[];
  v_res        jsonb;
  v_cuerpo     text;
  v_avisos     integer := 0;
  p            record;
BEGIN
  -- Dos corridas a la vez convertirían dos veces el mismo MIN·MAX.
  IF NOT pg_try_advisory_xact_lock(hashtext('procesar_cambios_de_factor')) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'en_curso');
  END IF;

  SELECT array_agg(id), array_agg(DISTINCT erp_product_id)
    INTO v_ids, v_productos
    FROM public.cambios_de_factor
   WHERE procesado_at IS NULL;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'pendientes', 0);
  END IF;

  -- Alguien tiene MIN·MAX o Pedidos en mantenimiento: la cola espera.
  IF public.auth_module_locked(ARRAY['minmax', 'pedidos']) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'module_locked',
                              'pendientes', array_length(v_ids, 1));
  END IF;

  SELECT analysis_days INTO v_dias FROM public.stock_config WHERE id = 1;

  -- 1. Cada venta de esos productos con el factor que su presentación tiene HOY.
  --    El prefijo más largo gana («CAJA X 100» antes que «CAJA»), igual que la
  --    corrección del 2026-09-22.
  CREATE TEMP TABLE _cf_linea ON COMMIT DROP AS
  WITH cat AS (
    SELECT pp.product_id, upper(trim(pr.tipo)) AS tipo,
           min(pp.factor) AS fmin, max(pp.factor) AS fmax
      FROM public.product_precios pp
      JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
     WHERE pp.activo AND pp.factor > 0 AND pp.product_id = ANY(v_productos)
     GROUP BY 1, 2
  )
  SELECT DISTINCT ON (ii.id)
         ii.id, ii.erp_product_id AS pid, ii.cantidad::numeric AS cantidad,
         ii.factor_unidades AS viejo, c.fmax, c.tipo,
         CASE WHEN c.fmin = c.fmax AND c.fmax <> ii.factor_unidades
                   AND (ii.factor_unidades = 1 OR c.fmax = 1)
              THEN c.fmax END AS nuevo,
         si.fecha, esm.erp_sucursal_id AS sala
    FROM public.sales_invoice_items ii
    JOIN cat c ON c.product_id = ii.erp_product_id
              AND upper(ii.presentacion) LIKE c.tipo || ' %'
    JOIN public.sales_invoices si ON si.id = ii.invoice_id
    LEFT JOIN public.erp_sucursal_map esm ON esm.branch_id = si.branch_id AND esm.es_bodega = false
   WHERE ii.erp_product_id = ANY(v_productos)
     AND NOT EXISTS (SELECT 1 FROM public.products x
                      WHERE x.id = ii.erp_product_id AND x.nombre ILIKE 'RECARGA%')
   ORDER BY ii.id, length(c.tipo) DESC;

  SELECT array_agg(DISTINCT pid) INTO v_ajustados FROM _cf_linea WHERE nuevo IS NOT NULL;

  CREATE TEMP TABLE _cf_antes ON COMMIT DROP AS
  SELECT erp_product_id, erp_sucursal_id, min_units, max_units
    FROM public.product_stock_params
   WHERE erp_product_id = ANY(COALESCE(v_ajustados, '{}'));

  IF v_ajustados IS NOT NULL THEN
    -- 2. En qué unidad está el MIN·MAX guardado de cada sala: la mezcla de
    --    ventas de la ventana con la que se calculó. Calculado sobre puras
    --    ventas viejas de 30, la razón es 1/30; sobre ventas que ya venían en
    --    la unidad nueva, es 1 y no se toca nada — que es lo que pasa con un
    --    cambio de hace meses que el recálculo ya absorbió.
    CREATE TEMP TABLE _cf_razon ON COMMIT DROP AS
    SELECT psp.id,
           sum(l.cantidad * COALESCE(l.nuevo, l.viejo)) / NULLIF(sum(l.cantidad * l.viejo), 0) AS razon
      FROM public.product_stock_params psp
      JOIN _cf_linea l ON l.pid = psp.erp_product_id AND l.sala = psp.erp_sucursal_id
     WHERE psp.erp_product_id = ANY(v_ajustados)
       AND psp.erp_sucursal_id <> 6
       AND l.cantidad > 0
       AND l.fecha >  COALESCE(psp.calculated_at, psp.manual_at, now())::date - v_dias
       AND l.fecha <= COALESCE(psp.calculated_at, psp.manual_at, now())::date
     GROUP BY psp.id;

    UPDATE public.product_stock_params psp SET
      min_units   = (public.par_min_max_convertido(psp.min_units,  psp.max_units,  r.razon))[1],
      max_units   = (public.par_min_max_convertido(psp.min_units,  psp.max_units,  r.razon))[2],
      draft_min   = (public.par_min_max_convertido(psp.draft_min,  psp.draft_max,  r.razon))[1],
      draft_max   = (public.par_min_max_convertido(psp.draft_min,  psp.draft_max,  r.razon))[2],
      calc_min    = (public.par_min_max_convertido(psp.calc_min,   psp.calc_max,   r.razon))[1],
      calc_max    = (public.par_min_max_convertido(psp.calc_min,   psp.calc_max,   r.razon))[2],
      manual_min  = (public.par_min_max_convertido(psp.manual_min, psp.manual_max, r.razon))[1],
      manual_max  = (public.par_min_max_convertido(psp.manual_min, psp.manual_max, r.razon))[2],
      daily_velocity     = round(psp.daily_velocity     * r.razon, 6),
      velocity_30d       = round(psp.velocity_30d       * r.razon, 6),
      draft_velocity     = round(psp.draft_velocity     * r.razon, 6),
      draft_velocity_30d = round(psp.draft_velocity_30d * r.razon, 6),
      units_sold_6m      = round(psp.units_sold_6m      * r.razon)::integer,
      draft_units_sold   = round(psp.draft_units_sold   * r.razon)::integer,
      manual_cliente_unidades = CASE WHEN psp.manual_cliente_unidades IS NULL THEN NULL
                                     ELSE GREATEST(1, round(psp.manual_cliente_unidades * r.razon))::integer END,
      updated_at  = now()
      FROM _cf_razon r
     WHERE r.id = psp.id AND r.razon IS NOT NULL AND r.razon <> 1;
    GET DIAGNOSTICS v_convertidas = ROW_COUNT;

    -- 3. El historial. Sólo `factor_unidades`, que es derivada del portal;
    --    `cantidad` y `total_linea` son fiscales. El trigger es
    --    `UPDATE OF presentacion`, así que esto no lo dispara.
    UPDATE public.sales_invoice_items ii
       SET factor_unidades = l.nuevo
      FROM _cf_linea l
     WHERE ii.id = l.id AND l.nuevo IS NOT NULL;
    GET DIAGNOSTICS v_reescritas = ROW_COUNT;

    -- 4. Recalcular esos productos en cada sala, ya sobre el historial nuevo.
    --    calculate_stock_params pide la llave del servidor; acá no hay sesión.
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    FOR v_sala IN SELECT erp_sucursal_id FROM public.erp_sucursal_map
                   WHERE es_bodega = false ORDER BY 1 LOOP
      v_r := public.calculate_stock_params(v_sala, v_ajustados);
      IF NOT COALESCE((v_r->>'ok')::boolean, false) THEN
        RAISE EXCEPTION 'CAMBIO_DE_FACTOR: el recálculo de la sala % no corrió: %', v_sala, v_r;
      END IF;
      v_calc := v_calc || jsonb_build_object('sala', v_sala, 'resultado', v_r);
    END LOOP;

    -- 5. Una decisión de una persona (solicitud aprobada o motivo) no se pisa:
    --    ya quedó convertida en el paso 2. Se le quita el borrador para que la
    --    publicación dirigida no la reemplace por el cálculo.
    UPDATE public.product_stock_params SET
      draft_min = NULL, draft_max = NULL, draft_abc_class = NULL,
      draft_demand_variability = NULL, draft_cv = NULL, draft_velocity = NULL,
      draft_velocity_30d = NULL, draft_units_sold = NULL, draft_revenue = NULL,
      draft_data_days = NULL, draft_calculated_at = NULL, draft_status = 'none',
      updated_at = now()
     WHERE erp_product_id = ANY(v_ajustados)
       AND erp_sucursal_id <> 6
       AND draft_status = 'pending'
       AND (ajuste_solicitud_id IS NOT NULL OR manual_motivo IS NOT NULL);

    -- 6. Publicar: es un cambio de UNIDAD, no de demanda. Dejarlo en borrador
    --    —el freno del 40% lo dejaría ahí siempre— es dejar el pedido pidiendo
    --    en la unidad vieja hasta que alguien lo revise. Bodega se rehace acá.
    v_pub := public.publish_stock_params(NULL, v_ajustados, 'cambio de factor');

    PERFORM set_config('request.jwt.claims', '', true);

    -- 7. La venta por sala que leen otras pantallas.
    PERFORM public.refresh_product_sales_rollup();
  END IF;

  -- 8. El factor que usa el pedido para contar existencias. Siempre: también
  --    cambia cuando no hubo historial que reescribir.
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_product_factor;

  -- 9. Qué pasó, por producto, y el aviso a quien decide el MIN·MAX.
  v_dest := public.get_minmax_approver_ids();
  FOR p IN
    SELECT pr.id, pr.nombre,
           count(l.id) FILTER (WHERE l.nuevo IS NOT NULL)                   AS reescritas,
           count(l.id) FILTER (WHERE l.nuevo IS NULL AND l.fmax <> l.viejo) AS dudosas,
           max(l.viejo) FILTER (WHERE l.nuevo IS NOT NULL)                  AS de,
           max(l.nuevo)                                                     AS a,
           max(l.tipo)  FILTER (WHERE l.nuevo IS NOT NULL)                  AS tipo,
           max(l.fecha) FILTER (WHERE l.nuevo IS NOT NULL)                  AS ultima_vieja,
           (SELECT min(c.detectado_at) FROM public.cambios_de_factor c
             WHERE c.id = ANY(v_ids) AND c.erp_product_id = pr.id)         AS desde
      FROM unnest(v_productos) AS u(pid)
      JOIN public.products pr ON pr.id = u.pid
      LEFT JOIN _cf_linea l ON l.pid = u.pid
     GROUP BY pr.id, pr.nombre
  LOOP
    -- strip_nulls: un null de JSON no es un NULL de SQL, y el aviso pregunta por NULL.
    v_res := jsonb_strip_nulls(jsonb_build_object(
      'ventas_convertidas', p.reescritas,
      'ventas_sin_convertir', p.dudosas,
      'factor_antes', p.de,
      'factor_ahora', p.a,
      'presentacion', p.tipo,
      'minmax', (SELECT jsonb_agg(jsonb_build_object(
                          'sala', m.nombre,
                          'antes', jsonb_build_array(a.min_units, a.max_units),
                          'ahora', jsonb_build_array(s.min_units, s.max_units))
                        ORDER BY s.erp_sucursal_id)
                   FROM _cf_antes a
                   JOIN public.product_stock_params s
                     ON s.erp_product_id = a.erp_product_id AND s.erp_sucursal_id = a.erp_sucursal_id
                   JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = s.erp_sucursal_id
                  WHERE a.erp_product_id = p.id
                    AND (a.min_units, a.max_units) IS DISTINCT FROM (s.min_units, s.max_units)),
      -- La existencia que quedó contada en la unidad vieja, en los dos
      -- sentidos, tal como estaba AHORA. Sólo si el cambio es RECIENTE
      -- (todavía se vendió con el tamaño viejo en los últimos 60 días): uno de
      -- hace un año ya se corrigió en la caja, y medido en la prueba, DOLACO
      -- —1x1 desde 2025— salía acusado en 3 salas.
      'existencia_por_corregir', CASE WHEN p.ultima_vieja >= CURRENT_DATE - 60 THEN
                 nullif(public.existencia_por_corregir(p.id, p.tipo, p.de, p.a, p.desde), '[]'::jsonb)
               END));

    UPDATE public.cambios_de_factor
       SET procesado_at = now(), resultado = v_res
     WHERE id = ANY(v_ids) AND erp_product_id = p.id;

    IF p.reescritas > 0 OR p.dudosas > 0 THEN
      v_cuerpo := p.nombre || ': ';
      IF p.reescritas > 0 THEN
        v_cuerpo := v_cuerpo || 'cambió el tamaño de su presentación (antes '
                 || p.de || ' por unidad de venta, ahora ' || p.a || '). Se convirtieron '
                 || p.reescritas || ' ventas'
                 || CASE WHEN v_res->'minmax' IS NOT NULL
                         THEN ' y el MIN·MAX: ' || (SELECT string_agg(
                                (x->>'sala') || ' ' || (x->'antes'->>0) || '·' || (x->'antes'->>1)
                                || ' → ' || (x->'ahora'->>0) || '·' || (x->'ahora'->>1), ', ')
                              FROM jsonb_array_elements(v_res->'minmax') x)
                         ELSE '' END || '.';
      END IF;
      IF v_res->'existencia_por_corregir' IS NOT NULL THEN
        v_cuerpo := v_cuerpo || ' La existencia quedó contada en la unidad vieja en '
                 || (SELECT string_agg(DISTINCT m.nombre, ', ')
                       FROM jsonb_array_elements(v_res->'existencia_por_corregir') x
                       JOIN public.erp_sucursal_map m
                         ON m.erp_sucursal_id = (x->>'erp_sucursal_id')::int)
                 || '. Se corrige con un botón en Productos → Revisión de factor.';
      END IF;
      IF p.dudosas > 0 THEN
        v_cuerpo := v_cuerpo || ' ' || p.dudosas
                 || ' ventas tienen otro tamaño de caja y quedaron como estaban: revisar si es la misma caja.';
      END IF;
      v_avisos := v_avisos + public.notify_employees(
        v_dest, 'SYSTEM', 'Cambio de presentación · ' || p.nombre, v_cuerpo, '/productos?tab=revision',
        jsonb_build_object('erp_product_id', p.id, 'cambio_de_factor', v_res));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'productos', array_length(v_productos, 1),
    'productos_convertidos', COALESCE(array_length(v_ajustados, 1), 0),
    'ventas_convertidas', v_reescritas,
    'filas_minmax_convertidas', v_convertidas,
    'recalculo', v_calc,
    'publicado', v_pub,
    'avisos', v_avisos);
END;
$function$;

-- ── 3. La pantalla ofrece sólo la foto, y sólo mientras siga igual ─────────
CREATE OR REPLACE FUNCTION public.revision_de_presentaciones()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('productos_tab_presentaciones', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: no tenés acceso a las presentaciones de productos';
  END IF;

  RETURN json_build_object(
    -- Lo que cambió en los últimos 120 días y qué se convirtió.
    'cambios', (
      SELECT coalesce(json_agg(json_build_object(
               'id', c.id, 'erp_product_id', c.erp_product_id, 'nombre', p.nombre,
               'detectado_at', c.detectado_at, 'procesado_at', c.procesado_at,
               'resultado', c.resultado) ORDER BY c.procesado_at DESC NULLS FIRST), '[]'::json)
        FROM public.cambios_de_factor c
        JOIN public.products p ON p.id = c.erp_product_id
       WHERE c.detectado_at >= now() - interval '120 days'
         AND (c.procesado_at IS NULL
              OR c.resultado ? 'factor_antes'
              OR coalesce((c.resultado->>'ventas_sin_convertir')::int, 0) > 0)),

    -- La existencia que quedó contada en la unidad vieja: las filas de la foto
    -- que sacó el proceso al convertir (`existencia_por_corregir`), y sólo
    -- mientras sigan EXACTAMENTE como estaban. Una fila que cambió —se vendió,
    -- llegó una compra, alguien ya la corrigió en la caja— deja de ofrecerse:
    -- el botón descarta o carga sobre un número que ya no es el de la foto.
    'existencias', (
      WITH rec AS (
        SELECT DISTINCT ON (c.erp_product_id)
               c.id AS cambio_id, c.erp_product_id, c.detectado_at,
               (c.resultado->>'factor_antes')::int AS de,
               (c.resultado->>'factor_ahora')::int AS a,
               c.resultado->'existencia_por_corregir' AS lista
          FROM public.cambios_de_factor c
         WHERE c.procesado_at >= now() - interval '120 days'
           AND jsonb_typeof(c.resultado->'existencia_por_corregir') = 'array'
         ORDER BY c.erp_product_id, c.procesado_at DESC
      ),
      foto AS (
        SELECT r.*, e.x->>'sentido' AS sentido,
               (e.x->>'erp_sucursal_id')::int AS suc,
               nullif(btrim(coalesce(e.x->>'lote', '')), '') AS lote,
               nullif(e.x->>'vence', '')::date AS vence,
               e.x->>'presentacion' AS presentacion,
               (e.x->>'muestra')::int AS muestra,
               (e.x->>'esperado')::int AS esperado
          FROM rec r
          CROSS JOIN LATERAL jsonb_array_elements(r.lista) e(x)
      ),
      vigente AS (
        SELECT f.* FROM foto f
         WHERE (f.sentido = 'achica' AND f.de > 1 AND f.a = 1
                AND EXISTS (SELECT 1 FROM public.inventory i
                             WHERE i.erp_product_id = f.erp_product_id
                               AND i.erp_sucursal_id = f.suc
                               AND NOT i.is_vencidos
                               AND nullif(btrim(coalesce(i.lote, '')), '') IS NOT DISTINCT FROM f.lote
                               AND upper(trim(i.presentacion)) = upper(f.presentacion)
                               AND i.cantidad = f.muestra))
            OR (f.sentido = 'crece' AND f.de = 1 AND f.a > 1
                -- Lo que el inventario muestra hoy tiene que ser lo que muestra
                -- si nadie tocó nada…
                AND (SELECT coalesce(sum(i.cantidad * coalesce(
                              (regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1)), 0)
                       FROM public.inventory i
                      WHERE i.erp_product_id = f.erp_product_id
                        AND i.erp_sucursal_id = f.suc
                        AND NOT i.is_vencidos) = f.esperado
                -- …y como la existencia guardada no se ve entera (1 de 24 son 0
                -- cajas), una venta desde el cambio también la invalida.
                AND NOT EXISTS (SELECT 1
                                  FROM public.sales_invoice_items ii
                                  JOIN public.sales_invoices si ON si.id = ii.invoice_id
                                  JOIN public.erp_sucursal_map m2 ON m2.branch_id = si.branch_id
                                 WHERE ii.erp_product_id = f.erp_product_id
                                   AND m2.erp_sucursal_id = f.suc
                                   AND si.fecha >= (f.detectado_at AT TIME ZONE 'America/El_Salvador')::date
                                   AND public.venta_valida(si.estado)))
      )
      SELECT coalesce(json_agg(json_build_object(
               'cambio_id', v.cambio_id, 'erp_product_id', v.erp_product_id, 'nombre', p.nombre,
               'sentido', v.sentido,
               'sala', m.nombre, 'erp_sucursal_id', m.erp_sucursal_id, 'branch_id', m.branch_id,
               'presentacion', v.presentacion, 'lote', v.lote, 'vence', v.vence,
               'muestra', v.muestra, 'de', v.de, 'a', v.a,
               -- achica: 16 guardadas con caja de 1 son 1 caja; salen 15.
               -- crece:  1 guardada con caja de 24 es 1 caja; entra 1 caja
               --         (24) y queda 1 suelta de más que no se puede sacar
               --         sin una presentación de 1.
               'quedan',    CASE v.sentido WHEN 'achica' THEN v.muestra / v.de ELSE v.muestra END,
               'descartar', CASE v.sentido WHEN 'achica' THEN v.muestra - v.muestra / v.de END,
               'sueltas',   CASE v.sentido WHEN 'achica' THEN v.muestra % v.de END,
               'cargar',    CASE v.sentido WHEN 'crece'  THEN v.muestra END,
               'sobran',    CASE v.sentido WHEN 'crece'  THEN v.muestra END,
               'solicitud', (SELECT json_build_object('id', ar.id, 'status', ar.status,
                                    'aplicada', ar.metadata ? 'erp_aplicado', 'at', ar.created_at)
                               FROM public.approval_requests ar
                              WHERE ar.type = CASE v.sentido WHEN 'crece' THEN 'INVENTORY_LOAD_REQUEST'
                                                             ELSE 'INVENTORY_DISCARD_REQUEST' END
                                AND ar.metadata->'correccion_de_factor'->>'cambio_id' = v.cambio_id::text
                                AND (ar.metadata->>'erp_sucursal_id')::int = m.erp_sucursal_id
                                -- H28: la corrección es de UN lote.
                                AND nullif(btrim(coalesce(ar.metadata->'correccion_de_factor'->>'lote',
                                                          ar.metadata->'items'->0->>'lote', '')), '')
                                    IS NOT DISTINCT FROM v.lote
                                AND ar.status IN ('PENDING', 'APPROVED')
                              ORDER BY ar.created_at DESC LIMIT 1))
             ORDER BY p.nombre, m.erp_sucursal_id, v.lote), '[]'::json)
        FROM vigente v
        JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = v.suc
        JOIN public.products p ON p.id = v.erp_product_id),

    'sospechosos', (
      SELECT coalesce(json_agg(to_json(f) ORDER BY f.nombre, f.tipo), '[]'::json)
        FROM public.factores_sospechosos() f)
  );
END;
$function$;

-- ── 4. «Factor que no cuadra» no acusa ventas de antes de un cambio ───────
-- Una venta hecha con el tamaño viejo ANTES de que el catálogo cambiara no es
-- un factor equivocado: es historia. Se cuentan sólo las del día siguiente al
-- último cambio detectado del producto en adelante.
CREATE OR REPLACE FUNCTION public.factores_sospechosos()
 RETURNS TABLE(clave text, tipo text, erp_product_id integer, nombre text, presentacion text, dice integer, catalogo integer, filas integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH cat AS (
    SELECT pp.product_id, upper(trim(pr.tipo)) AS tipo, pp.factor, pp.descripcion,
           nullif(substring(regexp_replace(pp.descripcion, '\s', '', 'g') from '(?i)^\d*x(\d+)$'), '')::int AS txt
      FROM public.product_precios pp
      JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
      JOIN public.products p ON p.id = pp.product_id
     WHERE pp.activo AND pp.factor > 0 AND p.activo AND p.nombre NOT ILIKE 'RECARGA%'
  ),
  unico AS MATERIALIZED (
    SELECT product_id, tipo, min(factor) AS factor
      FROM cat GROUP BY 1, 2 HAVING min(factor) = max(factor)
  ),
  ultimo_cambio AS MATERIALIZED (
    SELECT c.erp_product_id, max(c.detectado_at AT TIME ZONE 'America/El_Salvador')::date AS dia
      FROM public.cambios_de_factor c
     GROUP BY 1
  ),
  ven AS MATERIALIZED (
    SELECT ii.erp_product_id, upper(ii.presentacion) AS pres, ii.factor_unidades
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
      LEFT JOIN ultimo_cambio uc ON uc.erp_product_id = ii.erp_product_id
     WHERE si.fecha >= CURRENT_DATE - 30
       AND public.venta_valida(si.estado)
       AND (uc.dia IS NULL OR si.fecha > uc.dia)
  )
  SELECT 'texto:' || c.product_id || ':' || c.tipo || ':' || c.txt || ':' || c.factor,
         'texto', c.product_id, p.nombre, c.tipo, c.txt, c.factor, 1
    FROM cat c JOIN public.products p ON p.id = c.product_id
   WHERE c.txt IS NOT NULL AND c.txt <> c.factor
  UNION ALL
  SELECT 'existencia:' || i.erp_product_id || ':' || u.tipo || ':' || x.dice || ':' || u.factor,
         'existencia', i.erp_product_id, p.nombre, u.tipo, x.dice, u.factor, count(*)::int
    FROM public.inventory i
    JOIN unico u ON u.product_id = i.erp_product_id AND u.tipo = upper(trim(i.presentacion))
    JOIN public.products p ON p.id = i.erp_product_id
    CROSS JOIN LATERAL (SELECT nullif(substring(regexp_replace(i.detalle, '\s', '', 'g') from '(?i)^\d*x(\d+)$'), '')::int AS dice) x
   WHERE i.cantidad > 0 AND x.dice IS NOT NULL AND x.dice <> u.factor
   GROUP BY i.erp_product_id, u.tipo, x.dice, u.factor, p.nombre
  UNION ALL
  SELECT 'venta:' || v.erp_product_id || ':' || u.tipo || ':' || v.factor_unidades || ':' || u.factor,
         'venta', v.erp_product_id, p.nombre, u.tipo, v.factor_unidades::int, u.factor, count(*)::int
    FROM ven v
    JOIN unico u ON u.product_id = v.erp_product_id AND v.pres LIKE u.tipo || ' %'
    JOIN public.products p ON p.id = v.erp_product_id
   WHERE v.factor_unidades <> u.factor
     -- Un tipo más largo que también calza («CAJA X 100» contra «CAJA») es el
     -- que manda: ésa no es una venta con el tamaño equivocado.
     AND NOT EXISTS (SELECT 1 FROM unico u2
                      WHERE u2.product_id = u.product_id AND length(u2.tipo) > length(u.tipo)
                        AND v.pres LIKE u2.tipo || ' %')
   GROUP BY v.erp_product_id, u.tipo, v.factor_unidades, u.factor, p.nombre;
$function$;

-- ── 5. Las dos tarjetas que ya estaban en pantalla pasan al formato nuevo ──
-- Acetaminofén Forte X16 (Salud 2) y Uro Vaxom (La Popular): se vuelve a
-- sacar su foto con la función nueva. Su inventario no se movió desde el
-- cambio (medido el 29-oct contra la foto diaria), así que sale lo mismo.
UPDATE public.cambios_de_factor c
   -- strip_nulls: si la foto sale vacía, la clave no queda (un null de JSON
   -- no es un NULL de SQL).
   SET resultado = jsonb_strip_nulls((c.resultado - 'existencia_a_revisar')
                   || jsonb_build_object(
                        'presentacion', 'CAJA',
                        'existencia_por_corregir', nullif(public.existencia_por_corregir(
                          c.erp_product_id, 'CAJA',
                          (c.resultado->>'factor_antes')::int,
                          (c.resultado->>'factor_ahora')::int,
                          c.detectado_at), '[]'::jsonb)))
 WHERE c.resultado ? 'existencia_a_revisar';
