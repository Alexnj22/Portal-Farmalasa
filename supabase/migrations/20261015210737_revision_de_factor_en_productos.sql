-- Revisión de factor en Productos (2026-10-15, pedido del usuario).
--
-- La primera mitad (20261015204042) convierte ventas y MIN·MAX solos cuando
-- cambia el factor. Lo que NO puede hacer sola es corregir la existencia: la
-- caja no la convierte (La Popular quedó mostrando 30 «cajas» de Uro Vaxom
-- donde hay una) y descartar existencia es una decisión. Esto le da un lugar:
-- qué cambió, qué existencia hay que corregir —con el porqué y el de→a— y qué
-- productos tienen un factor que no cuadra. Y un aviso diario de lo nuevo.

SET lock_timeout = '5s';

-- ── Lo que no cuadra ────────────────────────────────────────────────────────
-- Tres preguntas, cada una con su clave estable para avisar sólo lo nuevo:
--   texto      el catálogo dice «1X10» y el factor dice otra cosa;
--   existencia la existencia dice un tamaño y el catálogo otro;
--   venta      una venta de los últimos 30 días entró con un tamaño que el
--              catálogo ya no tiene (la caja la armó con el texto viejo).
-- Medido al escribirlo: las tres en CERO. Una lista que normalmente está
-- vacía es la que se mira cuando tiene algo.
CREATE FUNCTION public.factores_sospechosos()
RETURNS TABLE (clave text, tipo text, erp_product_id integer, nombre text,
               presentacion text, dice integer, catalogo integer, filas integer)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  WITH cat AS (
    SELECT pp.product_id, upper(trim(pr.tipo)) AS tipo, pp.factor, pp.descripcion,
           nullif(substring(regexp_replace(pp.descripcion, '\s', '', 'g') from '(?i)^\d*x(\d+)$'), '')::int AS txt
      FROM public.product_precios pp
      JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
      JOIN public.products p ON p.id = pp.product_id
     WHERE pp.activo AND pp.factor > 0 AND p.activo AND p.nombre NOT ILIKE 'RECARGA%'
  ),
  unico AS (
    SELECT product_id, tipo, min(factor) AS factor
      FROM cat GROUP BY 1, 2 HAVING min(factor) = max(factor)
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
  SELECT 'venta:' || ii.erp_product_id || ':' || u.tipo || ':' || ii.factor_unidades || ':' || u.factor,
         'venta', ii.erp_product_id, p.nombre, u.tipo, ii.factor_unidades::int, u.factor, count(*)::int
    FROM public.sales_invoices si
    JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
    JOIN unico u ON u.product_id = ii.erp_product_id AND upper(ii.presentacion) LIKE u.tipo || ' %'
    JOIN public.products p ON p.id = ii.erp_product_id
   WHERE si.fecha >= CURRENT_DATE - 30
     AND public.venta_valida(si.estado)
     AND ii.factor_unidades <> u.factor
     -- Un tipo más largo que también calza («CAJA X 100» contra «CAJA») es el
     -- que manda: ésa no es una venta con el tamaño equivocado.
     AND NOT EXISTS (SELECT 1 FROM unico u2
                      WHERE u2.product_id = u.product_id AND length(u2.tipo) > length(u.tipo)
                        AND upper(ii.presentacion) LIKE u2.tipo || ' %')
   GROUP BY ii.erp_product_id, u.tipo, ii.factor_unidades, u.factor, p.nombre;
$$;
REVOKE EXECUTE ON FUNCTION public.factores_sospechosos() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.factores_sospechosos() TO service_role;

-- ── La pantalla ─────────────────────────────────────────────────────────────
-- Una sola llamada con las tres listas. DEFINER porque junta tablas con RLS
-- distinto (la cola es de Min·Máx, las ventas de Ventas); el permiso que
-- decide es el de la pestaña.
CREATE FUNCTION public.revision_de_presentaciones()
RETURNS json
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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

    -- La existencia que quedó contada en la unidad vieja, lote por lote. Sólo
    -- de los cambios que el reproceso marcó con existencia a revisar (es decir,
    -- recientes: uno de hace un año ya se corrigió allá), y sólo las filas que
    -- todavía muestran al menos una caja vieja entera.
    'existencias', (
      WITH rec AS (
        SELECT DISTINCT ON (c.erp_product_id)
               c.id AS cambio_id, c.erp_product_id, c.procesado_at,
               (c.resultado->>'factor_antes')::int AS de,
               (c.resultado->>'factor_ahora')::int AS a
          FROM public.cambios_de_factor c
         WHERE c.procesado_at >= now() - interval '120 days'
           AND c.resultado ? 'existencia_a_revisar'
         ORDER BY c.erp_product_id, c.procesado_at DESC
      )
      SELECT coalesce(json_agg(json_build_object(
               'cambio_id', r.cambio_id, 'erp_product_id', r.erp_product_id, 'nombre', p.nombre,
               'sala', m.nombre, 'erp_sucursal_id', m.erp_sucursal_id, 'branch_id', m.branch_id,
               'presentacion', trim(i.presentacion), 'detalle', i.detalle,
               'lote', i.lote, 'vence', i.fecha_vencimiento,
               'muestra', i.cantidad, 'de', r.de, 'a', r.a,
               'quedan', floor(i.cantidad / r.de)::int,
               'descartar', (i.cantidad - floor(i.cantidad / r.de))::int,
               'sueltas', (i.cantidad - floor(i.cantidad / r.de) * r.de)::int,
               'solicitud', (SELECT json_build_object('id', ar.id, 'status', ar.status,
                                    'aplicada', ar.metadata ? 'erp_aplicado', 'at', ar.created_at)
                               FROM public.approval_requests ar
                              WHERE ar.type = 'INVENTORY_DISCARD_REQUEST'
                                AND ar.metadata->'correccion_de_factor'->>'cambio_id' = r.cambio_id::text
                                AND (ar.metadata->>'erp_sucursal_id')::int = m.erp_sucursal_id
                                AND ar.status IN ('PENDING', 'APPROVED')
                              ORDER BY ar.created_at DESC LIMIT 1))
             ORDER BY p.nombre, m.erp_sucursal_id, i.lote), '[]'::json)
        FROM rec r
        JOIN public.inventory i ON i.erp_product_id = r.erp_product_id
                               AND NOT i.is_vencidos AND i.cantidad >= r.de
        JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id
        JOIN public.products p ON p.id = r.erp_product_id
       WHERE r.a = 1 AND r.de > 1),

    'sospechosos', (
      SELECT coalesce(json_agg(to_json(f) ORDER BY f.nombre, f.tipo), '[]'::json)
        FROM public.factores_sospechosos() f)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revision_de_presentaciones() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revision_de_presentaciones() TO authenticated, service_role;

-- ── El aviso de lo nuevo ────────────────────────────────────────────────────
-- Una clave por hallazgo, para avisar UNA vez y no todos los días lo mismo.
-- Historial de qué se avisó: no se purga (son pocas filas por definición).
CREATE TABLE public.factores_sospechosos_avisados (
  clave      text PRIMARY KEY,
  avisado_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.factores_sospechosos_avisados ENABLE ROW LEVEL SECURITY;
CREATE POLICY factores_sospechosos_avisados_select ON public.factores_sospechosos_avisados
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('productos_tab_presentaciones', 'can_view')));
REVOKE ALL ON public.factores_sospechosos_avisados FROM anon;

CREATE FUNCTION public.avisar_factores_sospechosos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_nuevos jsonb;
  v_n      integer;
  v_cuerpo text;
BEGIN
  WITH ins AS (
    INSERT INTO public.factores_sospechosos_avisados (clave)
    SELECT f.clave FROM public.factores_sospechosos() f
    ON CONFLICT (clave) DO NOTHING
    RETURNING clave
  )
  SELECT jsonb_agg(to_jsonb(f)), count(*)
    INTO v_nuevos, v_n
    FROM public.factores_sospechosos() f
    JOIN ins ON ins.clave = f.clave;

  IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

  SELECT string_agg(x->>'nombre' || ' (' || (x->>'presentacion') || ': '
                    || CASE x->>'tipo'
                         WHEN 'texto'      THEN 'el texto dice ' || (x->>'dice') || ' y el factor ' || (x->>'catalogo')
                         WHEN 'existencia' THEN 'la existencia dice ' || (x->>'dice') || ' y el catálogo ' || (x->>'catalogo')
                         ELSE (x->>'filas') || ' ventas con ' || (x->>'dice') || ' y el catálogo dice ' || (x->>'catalogo')
                       END || ')', '; ')
    INTO v_cuerpo
    FROM (SELECT x FROM jsonb_array_elements(v_nuevos) x LIMIT 5) s;

  PERFORM public.notify_employees(
    public.get_minmax_approver_ids(), 'SYSTEM',
    CASE WHEN v_n = 1 THEN 'Un producto con el factor que no cuadra'
         ELSE v_n || ' productos con el factor que no cuadra' END,
    v_cuerpo || CASE WHEN v_n > 5 THEN ' y ' || (v_n - 5) || ' más.' ELSE '.' END
      || ' Revisalo en Productos → Revisión de factor.',
    '/productos?tab=revision',
    jsonb_build_object('factores_sospechosos', v_nuevos));
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.avisar_factores_sospechosos() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_factores_sospechosos() TO service_role;

-- 7:15 SV, cuando ya entró el catálogo de la mañana y antes de abrir.
SELECT cron.schedule('avisar-factores-sospechosos', '15 13 * * *',
                     'SELECT public.avisar_factores_sospechosos()');

-- ── El aviso del reproceso lleva a la pestaña nueva ────────────────────────
-- Mismo cuerpo que 20261015204042; cambia sólo el enlace y la última frase de
-- la existencia a revisar.
CREATE OR REPLACE FUNCTION public.procesar_cambios_de_factor()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
         ii.factor_unidades AS viejo, c.fmax,
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
           max(l.fecha) FILTER (WHERE l.nuevo IS NOT NULL)                  AS ultima_vieja
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
      -- Pasó a contarse por caja y la sala muestra tantas como unidades traía
      -- la caja vieja: casi seguro es UNA caja contada en la unidad vieja. Sólo
      -- si el cambio es RECIENTE (todavía se vendió con el tamaño viejo en los
      -- últimos 60 días): uno de hace un año ya se corrigió en la caja, y
      -- medido en la prueba, DOLACO —1x1 desde 2025— salía acusado en 3 salas.
      'existencia_a_revisar', CASE WHEN p.a = 1 AND p.de > 1
                                     AND p.ultima_vieja >= CURRENT_DATE - 60 THEN
                 (SELECT jsonb_agg(jsonb_build_object('sala', m.nombre, 'cantidad', t.cant))
                    FROM (SELECT i.erp_sucursal_id, sum(i.cantidad) AS cant
                            FROM public.inventory i
                           WHERE i.erp_product_id = p.id AND NOT i.is_vencidos
                           GROUP BY 1) t
                    JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = t.erp_sucursal_id
                   WHERE t.cant >= p.de) END));

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
      IF v_res->'existencia_a_revisar' IS NOT NULL THEN
        v_cuerpo := v_cuerpo || ' Revisar la existencia, puede estar contada en la unidad vieja: '
                 || (SELECT string_agg((x->>'sala') || ' muestra ' || (x->>'cantidad'), ', ')
                       FROM jsonb_array_elements(v_res->'existencia_a_revisar') x)
                 || '. Se corrige desde Productos → Revisión de factor.';
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
$$;
