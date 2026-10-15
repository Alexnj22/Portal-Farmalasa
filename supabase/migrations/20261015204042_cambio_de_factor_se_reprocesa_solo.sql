-- El cambio de factor de un producto se reprocesa solo (2026-10-15).
--
-- Disparador: URO VAXOM 6 MG pasó de CAJA 1X30 a CAJA 1x1 el 13-oct. Las
-- existencias y el pedido leen el factor del catálogo al momento; el MIN·MAX
-- está GUARDADO en la unidad vieja (19·34 tabletas en Salud 2) y las ventas
-- viejas llevan factor_unidades = 30 congelado. Sin reproceso, el pedido pedía
-- 34 cajas donde hacía falta 1 (docs/PLAN-FACTOR-Y-MINMAX-2026-08-13.md §5).
--
-- Y mv_product_factor —el factor que usa el pedido para contar existencias—
-- no lo refrescaba NADIE: medido hoy, 3 factores viejos y 128 combinaciones
-- faltantes. Ahora se refresca en cada corrida con cambios.

SET lock_timeout = '5s';

-- ── La cola ────────────────────────────────────────────────────────────────
-- Una fila por producto cuyo factor cambió. Sin FK a `products` a propósito:
-- crearla toma un lock sobre una tabla que el sync escribe cada minuto, y el id
-- llega del mismo catálogo que la llena. Es historial de negocio —qué cambió y
-- qué se convirtió—, así que no se purga.
CREATE TABLE public.cambios_de_factor (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  erp_product_id integer     NOT NULL,
  detectado_at   timestamptz NOT NULL DEFAULT now(),
  procesado_at   timestamptz,
  resultado      jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cambios_de_factor_producto_idx   ON public.cambios_de_factor (erp_product_id);
CREATE INDEX cambios_de_factor_pendientes_idx ON public.cambios_de_factor (erp_product_id)
  WHERE procesado_at IS NULL;
ALTER TABLE public.cambios_de_factor ENABLE ROW LEVEL SECURITY;
CREATE POLICY cambios_de_factor_select ON public.cambios_de_factor
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('minmax', 'can_view')));
REVOKE ALL ON public.cambios_de_factor FROM anon;

-- ── Convertir un par MIN·MAX a la unidad nueva ─────────────────────────────
-- Sólo para lo que el recálculo NO reescribe: un ajuste decidido por una
-- persona, o una sala sin ventas en la ventana. El MIN redondea (un 0.63 de
-- caja es 1), el MAX sube, y al final la escalera de publish_stock_params para
-- que el par cumpla sus CHECK.
CREATE FUNCTION public.par_min_max_convertido(p_min integer, p_max integer, p_razon numeric)
RETURNS integer[]
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  n_min integer;
  n_max integer;
BEGIN
  IF p_razon IS NULL OR p_razon = 1 THEN
    RETURN ARRAY[p_min, p_max];
  END IF;
  n_min := CASE WHEN p_min IS NULL THEN NULL WHEN p_min <= 0 THEN 0
                ELSE GREATEST(1, round(p_min * p_razon))::integer END;
  n_max := CASE WHEN p_max IS NULL THEN NULL WHEN p_max <= 0 THEN 0
                ELSE GREATEST(1, ceil(p_max * p_razon))::integer END;
  IF n_min IS NOT NULL AND n_max IS NOT NULL THEN
    n_min := GREATEST(n_min, CASE WHEN n_max > 1 THEN 1 ELSE 0 END);
    IF n_min >= 1 THEN n_max := GREATEST(n_max, n_min + 1); END IF;
  END IF;
  RETURN ARRAY[n_min, n_max];
END;
$$;
REVOKE EXECUTE ON FUNCTION public.par_min_max_convertido(integer, integer, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.par_min_max_convertido(integer, integer, numeric) TO authenticated, service_role;

-- ── El reproceso ────────────────────────────────────────────────────────────
-- Lo que docs/PLAN-FACTOR-Y-MINMAX-2026-08-13.md §6 manda hacer a mano, en una
-- sola transacción: o queda todo convertido o no queda nada.
--
-- Qué ventas se reescriben: las que el catálogo de HOY clasifica en una
-- presentación con UN solo factor activo, distinto del que la venta guardó, y
-- donde uno de los dos es 1. Ése es «ahora se vende por caja» (30 → 1) o «antes
-- se contaba por caja» (1 → 10): la venta vieja dice qué se entregó, y lo que
-- cambió es la unidad. Un cambio entre dos tamaños (50 → 52, 12 → 8) puede ser
-- una caja distinta de verdad, y reescribirlo inventaría historia: ésas quedan
-- como están y van al aviso. Las recargas no se tocan (decisión del usuario,
-- 2026-09-22): no tienen MIN·MAX y su «unidad» no es un tamaño.
CREATE FUNCTION public.procesar_cambios_de_factor()
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
                       FROM jsonb_array_elements(v_res->'existencia_a_revisar') x) || '.';
      END IF;
      IF p.dudosas > 0 THEN
        v_cuerpo := v_cuerpo || ' ' || p.dudosas
                 || ' ventas tienen otro tamaño de caja y quedaron como estaban: revisar si es la misma caja.';
      END IF;
      v_avisos := v_avisos + public.notify_employees(
        v_dest, 'SYSTEM', 'Cambio de presentación · ' || p.nombre, v_cuerpo, '/minmax',
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
REVOKE EXECUTE ON FUNCTION public.procesar_cambios_de_factor() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.procesar_cambios_de_factor() TO service_role;

-- Cinco minutos después de cada carga del catálogo (sync-products corre en
-- los múltiplos de 10). Con la cola vacía es una lectura de índice.
SELECT cron.schedule('procesar-cambios-de-factor', '5-59/10 * * * *',
                     'SELECT public.procesar_cambios_de_factor()');


-- ── calculate_stock_params: cambia la firma, así que se reemplaza ──────────
DROP FUNCTION public.calculate_stock_params(integer);
CREATE OR REPLACE FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cfg             public.stock_config%ROWTYPE;
  v_from          date;
  v_now           timestamptz := NOW();
  v_count         integer := 0;
  v_auto_applied  integer := 0;
  v_sparse_reset  integer := 0;
  v_lock          public.module_locks%ROWTYPE;
BEGIN
  -- Candado de mantenimiento: aplica INCLUSO a service_role.
  IF public.auth_module_locked(ARRAY['minmax','pedidos']) THEN
    SELECT * INTO v_lock
    FROM public.module_locks
    WHERE module_key = ANY(ARRAY['minmax','pedidos'])
      AND expires_at > now()
    ORDER BY locked_at
    LIMIT 1;

    IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' THEN
      RETURN jsonb_build_object(
        'ok',              false,
        'skipped',         true,
        'reason',          'module_locked',
        'locked_by',       v_lock.locked_by_name,
        'locked_module',   v_lock.module_key,
        'erp_sucursal_id', p_erp_sucursal_id
      );
    END IF;

    RAISE EXCEPTION 'MODULE_LOCKED: % esta en mantenimiento por % — no se puede recalcular',
      v_lock.module_key, v_lock.locked_by_name;
  END IF;

  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' AND NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax']))
     AND p_erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: tu permiso es solo para tu sucursal';
  END IF;

  IF p_erp_sucursal_id = 6 THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'skipped', true,
      'reason',  'bodega_not_calculated_here — su MIN/MAX real viene de trg_bodega_draft_sync (SUM de sucursales), no de este cálculo independiente'
    );
  END IF;

  SET LOCAL work_mem = '128MB';
  SELECT * INTO cfg FROM public.stock_config WHERE id = 1;
  v_from := CURRENT_DATE - (cfg.analysis_days || ' days')::interval;

  -- Saltar sucursal si tiene borradores pendientes de revisión manual.
  -- Los OCULTOS no cuentan: su borrador es inalcanzable desde la UI y este
  -- mismo cálculo no los toca, así que bloqueaban la sucursal para siempre.
  -- El cron del día 1 (service_role) recalcula SIEMPRE: decisión del usuario,
  -- 2026-09-22. Sólo el botón manual respeta los borradores pendientes, y sin
  -- contar los de productos inactivos, que la pantalla no muestra.
  IF p_erp_sucursal_id IS NOT NULL
     AND (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    PERFORM 1 FROM product_stock_params sp
    WHERE sp.erp_sucursal_id = p_erp_sucursal_id
      AND sp.draft_status = 'pending'
      AND sp.is_hidden IS NOT TRUE
      AND EXISTS (SELECT 1 FROM products p WHERE p.id = sp.erp_product_id AND p.activo)
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok',               false,
        'skipped',          true,
        'reason',           'branch_has_pending_drafts',
        'erp_sucursal_id',  p_erp_sucursal_id
      );
    END IF;
  END IF;

  WITH branch_map AS (
    SELECT branch_id AS bid, erp_sucursal_id AS esid
    FROM erp_sucursal_map
    WHERE es_bodega = false
  ),
  -- Lo que una persona declaró sobre estos productos. Son POCAS filas (las
  -- cubre idx_psp_manual_at) y sólo las que traen motivo: un ajuste sin motivo
  -- protege el número al publicar, pero no le dice nada al cálculo.
  ajustes AS (
    SELECT erp_product_id, erp_sucursal_id, manual_motivo, manual_at,
           min_units AS manual_min_vigente, max_units AS manual_max_vigente,
           manual_cliente_unidades, manual_cliente_dias
    FROM product_stock_params
    WHERE manual_motivo IS NOT NULL
      AND erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR erp_sucursal_id = p_erp_sucursal_id)
  ),
  -- Los renglones, sin agrupar todavia. El calculo agrupaba por dia de una vez
  -- y con eso perdia la unica forma de distinguir «veinte personas llevaron una»
  -- de «un cliente llevo veinte»: el TAMAÑO de cada venta.
  lineas AS MATERIALIZED (
    SELECT
      bm.esid                                     AS erp_sucursal_id,
      ii.erp_product_id,
      inv.fecha,
      ii.cantidad::numeric * ii.factor_unidades   AS u,
      ii.total_linea                              AS rev
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm      ON bm.bid = inv.branch_id
    -- «Ya no rota»: alguien dijo que este producto dejó de venderse, así que lo
    -- vendido ANTES de esa fecha no describe la demanda de mañana. LEFT JOIN y
    -- no NOT EXISTS a propósito: `ajustes` tiene pocas filas y entra por hash,
    -- mientras que un EXISTS correlacionado fijaría la dirección del join
    -- contra las 180,000 facturas del año (CLAUDE.md, medido el 2026-08-17).
    LEFT JOIN ajustes anr ON anr.erp_product_id  = ii.erp_product_id
                         AND anr.erp_sucursal_id = bm.esid
                         AND anr.manual_motivo   = 'ya_no_rota'
    WHERE inv.fecha         >= v_from
      AND (anr.manual_at IS NULL OR inv.fecha >= anr.manual_at::date)
      AND public.venta_valida(inv.estado)
      AND ii.erp_product_id IS NOT NULL
      AND ii.cantidad        > 0
      AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
      AND NOT EXISTS (
        SELECT 1 FROM products p
        JOIN laboratorios l ON l.id = p.laboratorio_id
        WHERE p.id = ii.erp_product_id AND l.ocultar_en_minmax = true
      )
  ),
  -- Cuanto lleva la gente normalmente de este producto EN ESTA SALA. Por sala y
  -- no por producto a proposito: hay salas que atienden clinicas y ahi vender de
  -- a cajas ES lo normal — La Popular tiene mediana 20 en el mismo producto en
  -- que las demas tienen 10, y con la mediana global se le recortarian ventas
  -- que para ella son corrientes.
  linea_tipica AS (
    SELECT erp_sucursal_id, erp_product_id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY u) AS mediana
    FROM lineas
    GROUP BY 1, 2
  ),
  daily AS MATERIALIZED (
    -- Una venta QUINCE veces mas grande que la normal de ese producto en esa
    -- sala no describe la demanda del mostrador: es mayoreo, y se atiende, pero
    -- no define cuanto hay que tener en vitrina.
    --
    -- El caso que lo destapo: DICLOFENACO SODICO 50MG X 100 CAP. ROJA SAIMED,
    -- Salud 3, 26-ago-2026 — UNA factura de 26 cajas, 2,600 unidades, el 78% de
    -- todo lo que ese producto vendio en agosto en las seis salas. La venta
    -- normal de mostrador son 20 capsulas por un dolar. El calculo proponia
    -- 172·243 contra un vigente de 11·16; con la regla propone 12·18.
    --
    -- El 15 salio de medir 5x, 10x y 15x sobre el catalogo entero: los tres
    -- arreglan Salud 3 igual de bien, pero 5x y 10x ademas le bajan el numero a
    -- Salud 2 y La Popular, donde vender de a cajas puede ser demanda legitima.
    -- Se eligio el mas conservador que resuelve el caso.
    --
    -- Medido: 703 renglones excluidos de 227,374 (0.3%), 291 pares producto·sala
    -- bajan de 13,365, NINGUNO se queda sin ventas, y el costo de llenar el
    -- maximo de las seis salas baja 0.63%.
    --
    -- Lo que esta regla NO caza, y hay que saberlo: la PROMOCION. GLUDETHON AR
    -- vendio 214 unidades en agosto en 204 facturas —una unidad por persona— y
    -- ningun umbral lo toca, porque no hay ninguna venta grande que excluir.
    -- Eso necesita una lista de campañas, que es otra decision.
    SELECT
      l.erp_sucursal_id,
      l.erp_product_id,
      l.fecha,
      SUM(l.u)   AS units,
      SUM(l.rev) AS rev
    FROM lineas l
    JOIN linea_tipica lt ON lt.erp_sucursal_id = l.erp_sucursal_id
                        AND lt.erp_product_id  = l.erp_product_id
    -- El `mediana + 1` es el piso: con mediana 0 (posible si la mayoria de los
    -- renglones son fracciones) el tope seria 0 y se excluiria todo.
    WHERE l.u < GREATEST(lt.mediana * 15, lt.mediana + 1)
    GROUP BY 1, 2, 3
  ),
  daily_p95 AS (
    SELECT
      erp_sucursal_id,
      erp_product_id,
      PERCENTILE_CONT(cfg.outlier_percentile::float / 100.0)
          WITHIN GROUP (ORDER BY units) AS cap
    FROM daily
    GROUP BY erp_sucursal_id, erp_product_id
  ),
  -- Las sumas y el denominador real, separados del calculo de la velocidad para
  -- poder reusar data_days (un alias no se puede referenciar en el mismo SELECT).
  --
  -- F2.3 sigue vigente: el denominador arranca en la PRIMERA VENTA HISTORICA,
  -- que es lo unico que distingue un producto nuevo (no pudo vender los dias
  -- que no existia) de uno viejo con venta esporadica. Lo que cambio es de
  -- donde sale ese dato: antes una CTE `primera_venta` sin filtro de fecha que
  -- escaneaba las 578K filas de sales_invoice_items en CADA llamada (6 veces
  -- por corrida del cron, y el scan en frio de la PRIMERA sucursal es lo que
  -- reventó por statement timeout el 2026-08-01); ahora la MV
  -- mv_primera_venta_producto, que es una lectura de ~13K filas.
  --
  -- El LEAST(...) con MIN(d.fecha) NO es una aproximacion, es lo que hace el
  -- resultado EXACTO aunque la MV este desactualizada: si un producto se vendio
  -- por primera vez despues del ultimo refresh, no esta en la MV (pv.primera
  -- NULL, y LEAST ignora NULLs en Postgres) y su primera venta real es
  -- justamente su primera venta dentro de la ventana. Verificado contra la
  -- formula vieja: 13,526 productos, 0 diferencias.
  stats_raw AS (
    SELECT
      d.erp_sucursal_id,
      d.erp_product_id,
      SUM(d.units)::integer                                       AS sold_period,
      SUM(d.rev)                                                  AS rev_period,
      SUM(LEAST(d.units, p.cap))::numeric                         AS units_w,
      SUM(LEAST(d.units, p.cap) * LEAST(d.units, p.cap))::numeric AS units_w_sq,
      SUM(CASE WHEN d.fecha >= CURRENT_DATE - 30 THEN d.units ELSE 0 END)::numeric AS units_30d,
      LEAST(cfg.analysis_days,
            GREATEST(30, (CURRENT_DATE - GREATEST(LEAST(pv.primera, MIN(d.fecha)), v_from))::int + 1)) AS data_days,
      COUNT(DISTINCT d.fecha)                                     AS dias
    FROM daily d
    JOIN daily_p95 p ON p.erp_sucursal_id = d.erp_sucursal_id
                    AND p.erp_product_id  = d.erp_product_id
    LEFT JOIN public.mv_primera_venta_producto pv
                       ON pv.erp_sucursal_id = d.erp_sucursal_id
                      AND pv.erp_product_id  = d.erp_product_id
    GROUP BY d.erp_sucursal_id, d.erp_product_id, pv.primera
    HAVING COUNT(DISTINCT d.fecha) >= 1
  ),
  stats AS (
    SELECT
      sr.erp_sucursal_id, sr.erp_product_id, sold_period, rev_period, data_days, dias,
      -- «Cliente fijo»: «compra 20 cada 2 meses» es un dato mejor que un
      -- promedio de 180 días, que lo ve como pico irregular y lo winsoriza.
      CASE WHEN acf.manual_cliente_unidades > 0 AND acf.manual_cliente_dias > 0
           THEN acf.manual_cliente_unidades::numeric / acf.manual_cliente_dias
           ELSE units_w / data_days END   AS velocity,
      units_30d / 30        AS velocity_30d,
      ROUND((
        SQRT(GREATEST(0, units_w_sq / data_days - POWER(units_w / data_days, 2)))
        / NULLIF(units_w / data_days, 0) * 100
      )::numeric, 1) AS cv
    FROM stats_raw sr
    LEFT JOIN ajustes acf ON acf.erp_product_id  = sr.erp_product_id
                         AND acf.erp_sucursal_id = sr.erp_sucursal_id
                         AND acf.manual_motivo   = 'cliente_fijo'
  ),
  ranked AS (
    SELECT *,
      PERCENT_RANK() OVER (PARTITION BY erp_sucursal_id ORDER BY cv) AS cv_pctile,
      SUM(rev_period) OVER (
        PARTITION BY erp_sucursal_id
        ORDER BY rev_period DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )                                                    AS cum_rev,
      SUM(rev_period) OVER (PARTITION BY erp_sucursal_id) AS tot_rev
    FROM stats
    WHERE dias >= 3
  ),
  lead_times AS MATERIALIZED (
    SELECT erp_product_id, erp_sucursal_id, lead_time_days
    FROM product_stock_params
    WHERE lead_time_days IS NOT NULL AND erp_sucursal_id != 6
  ),
  classified AS (
    SELECT r.*,
      CASE
        WHEN r.tot_rev = 0                                               THEN 'D'
        WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_a_pct/100 THEN 'A'
        WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_b_pct/100 THEN 'B'
        ELSE                                                                  'C'
      END AS abc,
      CASE
        WHEN r.cv_pctile <= cfg.xyz_x_percentile / 100.0 THEN 'X'
        WHEN r.cv_pctile <= cfg.xyz_y_percentile / 100.0 THEN 'Y'
        ELSE                               'Z'
      END AS xyz,
      COALESCE(lt.lead_time_days,
        CASE
          WHEN r.cv_pctile <= cfg.xyz_x_percentile / 100.0 THEN cfg.reorder_x_days + cfg.buffer_x_days
          WHEN r.cv_pctile <= cfg.xyz_y_percentile / 100.0 THEN cfg.reorder_y_days + cfg.buffer_y_days
          ELSE                               cfg.reorder_z_days + cfg.buffer_z_days
        END
      ) AS effective_lead_days
    FROM ranked r
    LEFT JOIN lead_times lt ON lt.erp_product_id = r.erp_product_id
                            AND lt.erp_sucursal_id = r.erp_sucursal_id
  ),
  with_min AS (
    SELECT c.*,
      GREATEST(
        FLOOR(velocity * effective_lead_days)::int,
        CASE WHEN CEIL(velocity * cfg.cycle_days)::int > 1 THEN 1 ELSE 0 END,
        -- «Lo están buscando»: demanda real que el historial NO puede ver,
        -- porque nunca hubo producto que vender. El cálculo propondría cero
        -- para siempre, por diseño. El número que puso la persona es el piso.
        COALESCE(alb.manual_min_vigente, 0)
      ) AS computed_min,
      COALESCE(alb.manual_max_vigente, 0) AS piso_max
    FROM classified c
    LEFT JOIN ajustes alb ON alb.erp_product_id  = c.erp_product_id
                         AND alb.erp_sucursal_id = c.erp_sucursal_id
                         AND alb.manual_motivo   = 'lo_buscan'
  ),
  main_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
      calc_min, calc_max,
      draft_units_sold, draft_revenue, draft_data_days,
      draft_calculated_at, draft_status,
      updated_at
    )
    SELECT
      erp_product_id, erp_sucursal_id,
      abc,
      ROUND(velocity::numeric, 6),
      ROUND(velocity_30d::numeric, 6),
      cv, xyz,
      computed_min,
      GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1, piso_max),
      computed_min,
      GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1),
      sold_period, rev_period, data_days,
      v_now, 'pending',
      v_now
    FROM with_min
    -- p_erp_product_ids (2026-10-15): el cambio de factor recalcula SÓLO los
    -- productos que cambiaron. El cálculo corre sobre la sala entera igual —el
    -- ABC y el percentil del CV se rankean contra todos—, lo que se acota es
    -- qué filas se ESCRIBEN.
    WHERE p_erp_product_ids IS NULL OR erp_product_id = ANY(p_erp_product_ids)
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      abc_class                  = EXCLUDED.draft_abc_class,
      daily_velocity              = EXCLUDED.draft_velocity,
      velocity_30d                 = EXCLUDED.draft_velocity_30d,
      cv                           = EXCLUDED.draft_cv,
      demand_variability            = EXCLUDED.draft_demand_variability,
      units_sold_6m                 = EXCLUDED.draft_units_sold,
      revenue_6m                    = EXCLUDED.draft_revenue,
      calculated_at                 = EXCLUDED.draft_calculated_at,
      draft_abc_class            = EXCLUDED.draft_abc_class,
      draft_velocity             = EXCLUDED.draft_velocity,
      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,
      draft_cv                   = EXCLUDED.draft_cv,
      draft_demand_variability   = EXCLUDED.draft_demand_variability,
      draft_min                  = EXCLUDED.draft_min,
      draft_max                  = EXCLUDED.draft_max,
      calc_min                   = EXCLUDED.calc_min,
      calc_max                   = EXCLUDED.calc_max,
      draft_units_sold           = EXCLUDED.draft_units_sold,
      draft_revenue              = EXCLUDED.draft_revenue,
      draft_data_days            = EXCLUDED.draft_data_days,
      draft_calculated_at        = EXCLUDED.draft_calculated_at,
      draft_status               = CASE
        WHEN product_stock_params.min_units IS NULL
          OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min
          OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max
        THEN 'pending'
        ELSE 'none'
      END,
      updated_at                 = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  ),
  sparse_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
      calc_min, calc_max,
      draft_units_sold, draft_revenue, draft_data_days,
      draft_calculated_at, draft_status,
      updated_at
    )
    SELECT
      erp_product_id, erp_sucursal_id,
      NULL,
      ROUND(velocity::numeric, 6),
      ROUND(velocity_30d::numeric, 6),
      NULL, NULL,
      NULL, NULL,
      NULL, NULL,
      sold_period, rev_period, data_days,
      v_now, 'sparse_data',
      v_now
    FROM stats
    WHERE dias BETWEEN 1 AND 2
      AND (p_erp_product_ids IS NULL OR erp_product_id = ANY(p_erp_product_ids))
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      draft_abc_class            = NULL,
      draft_velocity             = EXCLUDED.draft_velocity,
      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,
      draft_cv                   = NULL,
      draft_demand_variability   = NULL,
      draft_min                  = NULL,
      draft_max                  = NULL,
      calc_min                   = NULL,
      calc_max                   = NULL,
      draft_units_sold           = EXCLUDED.draft_units_sold,
      draft_revenue              = EXCLUDED.draft_revenue,
      draft_data_days            = EXCLUDED.draft_data_days,
      draft_calculated_at        = EXCLUDED.draft_calculated_at,
      draft_status               = 'sparse_data',
      updated_at                 = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  )
  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT erp_product_id FROM main_upsert
    UNION ALL
    SELECT erp_product_id FROM sparse_upsert
  ) combined;

  -- F2.5: los sparse_data que este recalculo NO volvio a escribir ya no tienen
  -- ni una venta en la ventana: dejan de ser "datos escasos".
  UPDATE product_stock_params
  SET draft_status             = 'none',
      draft_abc_class          = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_cv                 = NULL,
      draft_demand_variability = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_calculated_at      = NULL,
      updated_at               = v_now
  WHERE draft_status = 'sparse_data'
    AND erp_sucursal_id != 6
    AND (p_erp_sucursal_id IS NULL OR erp_sucursal_id = p_erp_sucursal_id)
    AND (p_erp_product_ids IS NULL OR erp_product_id = ANY(p_erp_product_ids))
    AND (draft_calculated_at IS NULL OR draft_calculated_at < v_now);

  GET DIAGNOSTICS v_sparse_reset = ROW_COUNT;

  -- F2.1: sin INSERT a product_stock_params_history — lo escribe
  -- trg_psp_capture_history, que ve este UPDATE igual que cualquier otro.
  WITH con_stock AS (
    -- Los pares que HOY tienen algo en la sala. Se usa por ausencia: un par que
    -- no esta aca esta en quiebre. Tiene que ser «no existe fila con cantidad
    -- > 0» y no «la suma da 0», porque un producto agotado a veces no deja
    -- ninguna fila en inventory.
    SELECT erp_sucursal_id AS esid, erp_product_id AS pid
    FROM inventory
    WHERE is_vencidos = false
      AND cantidad > 0
      AND (p_erp_sucursal_id IS NULL OR erp_sucursal_id = p_erp_sucursal_id)
    GROUP BY 1, 2
  ),
  -- Los días que la foto diaria mira, POR SALA, y los días que cada producto
  -- tuvo existencia. Un día en cero es la AUSENCIA de la fila: la foto sólo
  -- guarda lo que hay. `inventory_daily` arrancó el 1-sep-2026, así que hoy son
  -- 21 días y la ventana crece sola.
  dias_foto_sala AS MATERIALIZED (
    SELECT id.erp_sucursal_id AS esid, count(DISTINCT id.fecha) AS dias
    FROM public.inventory_daily id
    WHERE id.fecha >= v_from
      AND (p_erp_sucursal_id IS NULL OR id.erp_sucursal_id = p_erp_sucursal_id)
    GROUP BY 1
  ),
  dias_con_stock AS MATERIALIZED (
    SELECT id.erp_sucursal_id AS esid, id.erp_product_id AS pid, count(DISTINCT id.fecha) AS dias
    FROM public.inventory_daily id
    WHERE id.fecha >= v_from
      AND id.unidades > 0
      AND (p_erp_sucursal_id IS NULL OR id.erp_sucursal_id = p_erp_sucursal_id)
    GROUP BY 1, 2
  ),
  auto_apply AS (
    UPDATE product_stock_params psp
    SET
      abc_class                = psp.draft_abc_class,
      daily_velocity           = psp.draft_velocity,
      velocity_30d             = psp.draft_velocity_30d,
      cv                       = psp.draft_cv,
      demand_variability       = psp.draft_demand_variability,
      min_units                = psp.draft_min,
      max_units                = psp.draft_max,
      units_sold_6m            = psp.draft_units_sold,
      revenue_6m               = psp.draft_revenue,
      data_days                = psp.draft_data_days,
      calculated_at            = psp.draft_calculated_at,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_abc_class          = NULL,
      draft_demand_variability = NULL,
      draft_cv                 = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      -- Igual que al publicar: el número pasa a ser el calculado. Acá sin
      -- CASE porque el auto-aplicar sólo alcanza filas sin sello ni motivo.
      manual_at                = NULL,
      manual_por               = NULL,
      manual_nota              = NULL,
      published_at             = v_now,
      published_by             = 'auto',
      updated_at                = v_now
    WHERE psp.draft_status = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND psp.is_hidden IS NOT TRUE
      AND (p_erp_product_ids IS NULL OR psp.erp_product_id = ANY(p_erp_product_ids))
      -- El auto-aplicar escribe min_units/max_units SIN pasar por
      -- publish_stock_params, así que el freno que se le puso allá no lo
      -- alcanzaba: era la cuarta puerta por la que un ajuste humano se perdía,
      -- y la peor, porque corre sola el día 1 sin que nadie lo decida.
      -- Frena la DECISIÓN, no la edición: una solicitud aprobada
      -- (`ajuste_solicitud_id`) o un motivo declarado. Corregir un borrador
      -- durante la revisión del mes es trabajo de ese ciclo y no congela la
      -- fila contra el cálculo siguiente.
      AND psp.ajuste_solicitud_id IS NULL
      AND psp.manual_motivo IS NULL
      AND COALESCE(psp.min_units, 0) > 0
      AND COALESCE(psp.draft_min,  0) > 0
      AND COALESCE(psp.draft_max,  0) > 0
      -- El freno tiene DOS puertas y basta con pasar una.
      AND (
        -- Puerta 1, la de siempre: el cambio es chico EN PROPORCION.
        (    ABS(psp.draft_min - psp.min_units)::numeric / GREATEST(psp.min_units, 1) <= 0.40
         AND ABS(psp.draft_max - psp.max_units)::numeric / GREATEST(psp.max_units, 1) <= 0.40)
        -- Puerta 2, nueva: el cambio es chico EN DINERO. El costo unitario sale
        -- de la presentacion mas chica, IDENTICO a get_inventory_cost_summary:
        -- si la pantalla y el calculo midieran distinto, el numero que se ve no
        -- seria el que decide. Sin costo conocido la subconsulta da NULL, la
        -- comparacion da NULL y la puerta NO se abre — o sea que un producto
        -- sin costo sigue yendo a revision, que es la falla segura.
        OR (     ABS(psp.draft_max - psp.max_units) <= 10
             AND ABS(psp.draft_min - psp.min_units) <= 10
             AND ABS(psp.draft_max - psp.max_units) * (
                   SELECT pp.costo / pp.factor::numeric
                     FROM product_precios pp
                    WHERE pp.product_id = psp.erp_product_id
                      AND pp.activo AND pp.costo > 0 AND pp.factor > 0
                    ORDER BY pp.factor ASC
                    LIMIT 1
                 ) <= 50)
      )
      -- Lo que falta no vende, y esa falta de venta NO dice que bajo la demanda:
      -- dice que no habia que vender. Bajarle el numero por eso cierra el
      -- circulo — menos maximo, menos pedido, falta antes y mas tiempo.
      --
      -- Medido el 2026-09-01: 505 pares en quiebre, y de los que se movieron
      -- ese dia 62 recibieron una BAJA estando en cero, 409 unidades de maximo.
      -- Esta guarda los manda a revision en vez de aplicarlos.
      --
      -- Las tres condiciones tienen que darse juntas:
      --   1. el cambio BAJA el par (subirlo estando en quiebre esta bien);
      --   2. no hay nada en la sala;
      --   3. el producto SI se vendia hace poco. Sin esto se congelaria tambien
      --      lo descontinuado — medido: de los 505 en quiebre, 128 no venden
      --      hace 90 dias y a esos bajarles el numero es correcto.
      --
      -- `product_last_sale` se verifico contra las ventas reales antes de
      -- confiarle esto: 13,574 de 13,599 pares coinciden al dia exacto y solo 5
      -- discrepan en el corte de los 90 dias.
      AND NOT (
            (psp.draft_min < psp.min_units OR psp.draft_max < psp.max_units)
        -- «No hay» AHORA, o NO HUBO en algún día de la ventana. Lo segundo se
        -- agregó el 2026-09-22: con sólo lo primero, un producto que se agotó y
        -- REINGRESÓ ayer quedaba sin protección —la sala ya tiene existencia—, y
        -- el cálculo le aplicaba solo la baja que le provocó justamente el
        -- quiebre. Medido sobre 21 días de foto: 1 de cada 5 pares producto·sala
        -- tuvo días en cero, y 1,304 de ellos ya habían reingresado.
        AND (
             NOT EXISTS (
               SELECT 1 FROM con_stock cs
                WHERE cs.esid = psp.erp_sucursal_id
                  AND cs.pid  = psp.erp_product_id)
             OR COALESCE((SELECT dcs.dias FROM dias_con_stock dcs
                           WHERE dcs.esid = psp.erp_sucursal_id
                             AND dcs.pid  = psp.erp_product_id), 0)
                < COALESCE((SELECT dfs.dias FROM dias_foto_sala dfs
                             WHERE dfs.esid = psp.erp_sucursal_id), 0)
            )
        AND EXISTS (
              SELECT 1 FROM product_last_sale pls
               WHERE pls.erp_product_id  = psp.erp_product_id
                 AND pls.erp_sucursal_id = psp.erp_sucursal_id
                 AND pls.last_sale_date >= CURRENT_DATE - 90)
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_auto_applied FROM auto_apply;

  RETURN jsonb_build_object(
    'ok', true, 'rows', v_count,
    'auto_applied', v_auto_applied,
    'drafted', GREATEST(v_count - v_auto_applied, 0),
    'sparse_reset', v_sparse_reset,
    'at', v_now
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.calculate_stock_params(integer, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_stock_params(integer, integer[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[], p_published_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count        INTEGER;
  v_bodega_count INTEGER := 0;
  v_omitidas     INTEGER := 0;
  v_now          TIMESTAMPTZ := NOW();
  -- El servidor no tiene correo: firma con p_published_by (2026-10-15, el
  -- reproceso del cambio de factor). Una persona firma SIEMPRE con su correo:
  -- el parámetro no le sirve para firmar con otro nombre.
  v_publisher    TEXT := CASE WHEN (SELECT auth.role()) = 'service_role'
                              THEN COALESCE(p_published_by, 'sistema')
                              ELSE (SELECT auth.email()) END;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax']))
     AND (p_erp_sucursal_id IS NULL
          OR p_erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id())) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: tu permiso es solo para tu sucursal';
  END IF;

  -- Cuántas deja quietas el barrido por ser una decisión sellada. Se cuenta
  -- ANTES de publicar para poder decirlo: una publicación que calla lo que no
  -- hizo se lee como "publicó todo".
  IF p_erp_product_ids IS NULL THEN
    SELECT COUNT(*) INTO v_omitidas
    FROM product_stock_params psp
    WHERE psp.draft_status     = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (psp.ajuste_solicitud_id IS NOT NULL OR psp.manual_motivo IS NOT NULL)
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id);
  END IF;

  WITH par_ordenado AS (
    SELECT
      psp.id,
      LEAST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0))    AS lo,
      GREATEST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0)) AS hi
    FROM product_stock_params psp
    WHERE psp.draft_status     = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND (p_erp_product_ids IS NULL OR psp.erp_product_id  = ANY(p_erp_product_ids))
      -- El BARRIDO no pisa una DECISIÓN —una solicitud aprobada, o un motivo
      -- declarado—; la publicación DIRIGIDA a productos concretos sí, porque
      -- alguien los eligió uno por uno. Una edición a mano de la revisión del
      -- mes no es ninguna de las dos y se publica como cualquier otra.
      AND (p_erp_product_ids IS NOT NULL
           OR (psp.ajuste_solicitud_id IS NULL AND psp.manual_motivo IS NULL))
  ),
  con_min AS (
    SELECT id, hi, GREATEST(lo, CASE WHEN hi > 1 THEN 1 ELSE 0 END) AS n_min
    FROM par_ordenado
  ),
  par AS (
    SELECT id, n_min,
           CASE WHEN n_min >= 1 THEN GREATEST(hi, n_min + 1) ELSE hi END AS n_max
    FROM con_min
  ),
  published AS (
    UPDATE product_stock_params psp
    SET
      abc_class                = psp.draft_abc_class,
      daily_velocity           = psp.draft_velocity,
      velocity_30d             = psp.draft_velocity_30d,
      cv                       = psp.draft_cv,
      demand_variability       = psp.draft_demand_variability,
      min_units                = par.n_min,
      max_units                = par.n_max,
      units_sold_6m            = psp.draft_units_sold,
      revenue_6m               = psp.draft_revenue,
      data_days                = psp.draft_data_days,
      calculated_at            = psp.draft_calculated_at,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_abc_class          = NULL,
      draft_demand_variability = NULL,
      draft_cv                 = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      -- El número pasa a ser el calculado, así que la firma de la persona
      -- deja de describirlo. `manual_motivo` sobrevive: es una declaración
      -- sobre el producto, y «ya no rota» depende de `manual_at` como corte.
      manual_at                = CASE WHEN psp.manual_motivo IS NULL THEN NULL ELSE psp.manual_at   END,
      manual_por               = CASE WHEN psp.manual_motivo IS NULL THEN NULL ELSE psp.manual_por  END,
      manual_nota              = CASE WHEN psp.manual_motivo IS NULL THEN NULL ELSE psp.manual_nota END,
      ajuste_solicitud_id      = NULL,
      published_at             = v_now,
      published_by             = v_publisher,
      updated_at               = v_now
    FROM par
    WHERE par.id = psp.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM published;

  IF p_erp_sucursal_id IS DISTINCT FROM 6 THEN
    WITH branch_sums AS (
      SELECT
        s.erp_product_id,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_min ELSE s.min_units END, 0))::integer AS eff_min,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_max ELSE s.max_units END, 0))::integer AS eff_max,
        SUM(COALESCE(s.min_units, 0))::integer AS pub_min,
        SUM(COALESCE(s.max_units, 0))::integer AS pub_max
      FROM product_stock_params s
      WHERE s.erp_sucursal_id != 6
        AND s.is_hidden IS NOT TRUE
        AND (p_erp_product_ids IS NULL OR s.erp_product_id = ANY(p_erp_product_ids))
      GROUP BY s.erp_product_id
      HAVING
        SUM(COALESCE(s.min_units, 0)) > 0
        OR SUM(COALESCE(s.max_units, 0)) > 0
        OR EXISTS (
          SELECT 1 FROM product_stock_params b
          WHERE b.erp_sucursal_id = 6
            AND b.erp_product_id  = s.erp_product_id
            AND b.draft_status    = 'pending'
        )
    ),
    -- La escalera, IDÉNTICA para los dos pares (es la de
    -- `sync_bodega_draft_from_branch_stmt`): primero el MIN sube a 1 si el MAX
    -- pasa de 1, después el MAX sube a MIN+1 si el MIN llegó a 1. Sale siempre
    -- un par que cumple `chk_min_lt_max` y `psp_draft_pair_valid`.
    bodega_min AS (
      SELECT
        erp_product_id,
        GREATEST(eff_min, CASE WHEN eff_max > 1 THEN 1 ELSE 0 END) AS d_min,
        eff_max,
        GREATEST(pub_min, CASE WHEN pub_max > 1 THEN 1 ELSE 0 END) AS n_min,
        pub_max
      FROM branch_sums
    ),
    bodega AS (
      SELECT
        erp_product_id,
        d_min,
        CASE WHEN d_min >= 1 THEN GREATEST(eff_max, d_min + 1) ELSE eff_max END AS d_max,
        n_min,
        CASE WHEN n_min >= 1 THEN GREATEST(pub_max, n_min + 1) ELSE pub_max END AS n_max
      FROM bodega_min
    )
    INSERT INTO product_stock_params AS psp (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_min, draft_max, draft_status,
      published_at, published_by, updated_at
    )
    SELECT
      erp_product_id, 6,
      n_min,
      n_max,
      CASE WHEN d_min != n_min OR d_max != n_max THEN d_min ELSE NULL END,
      CASE WHEN d_min != n_min OR d_max != n_max THEN d_max ELSE NULL END,
      CASE WHEN d_min != n_min OR d_max != n_max THEN 'pending' ELSE 'none' END,
      v_now, v_publisher, v_now
    FROM bodega
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units    = EXCLUDED.min_units,
      max_units    = EXCLUDED.max_units,
      draft_min    = EXCLUDED.draft_min,
      draft_max    = EXCLUDED.draft_max,
      draft_status = EXCLUDED.draft_status,
      published_at = EXCLUDED.published_at,
      published_by = EXCLUDED.published_by,
      updated_at   = EXCLUDED.updated_at
    WHERE psp.is_hidden IS NOT TRUE
      AND (psp.min_units, psp.max_units, psp.draft_min, psp.draft_max, psp.draft_status)
       IS DISTINCT FROM
          (EXCLUDED.min_units, EXCLUDED.max_units, EXCLUDED.draft_min, EXCLUDED.draft_max, EXCLUDED.draft_status);

    GET DIAGNOSTICS v_bodega_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',                        true,
    'published',                 v_count,
    'bodega_updated',            v_bodega_count,
    'omitidas_por_ajuste_manual', v_omitidas,
    'at',                        v_now
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_product_precios_batch(p_rows jsonb)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT * FROM jsonb_to_recordset(p_rows) AS r(
    product_id      integer,
    id_presentacion integer,
    descripcion     text,
    factor          integer,
    activo          boolean,
    costo           numeric,
    vineta          numeric,
    descuento_1     numeric,
    vip             numeric,
    clinica         numeric,
    mayoreo         numeric,
    premium         numeric,
    precio_7        numeric
  )
),
-- El estado ANTERIOR. Se puede leer acá aunque `upserted` esté por modificar la
-- tabla: todas las CTE de una misma sentencia comparten el snapshot, así que
-- esto ve lo de antes. Es lo que permite armar el «valor_anterior» sin un
-- trigger aparte.
previo AS (
  SELECT pp.product_id, pp.id_presentacion, pp.vineta, pp.descuento_1, pp.vip,
         pp.clinica, pp.mayoreo, pp.premium, pp.precio_7, pp.factor, pp.activo
    FROM public.product_precios pp
    JOIN incoming i
      ON i.product_id = pp.product_id AND i.id_presentacion = pp.id_presentacion
),
upserted AS (
  INSERT INTO public.product_precios AS pp
    (product_id, id_presentacion, descripcion, factor, activo, costo, vineta,
     descuento_1, vip, clinica, mayoreo, premium, precio_7, updated_at)
  SELECT i.product_id, i.id_presentacion, i.descripcion, i.factor, i.activo,
         i.costo, i.vineta, i.descuento_1, i.vip, i.clinica, i.mayoreo,
         i.premium, i.precio_7, now()
  FROM incoming i
  ON CONFLICT (product_id, id_presentacion) DO UPDATE
    SET descripcion = EXCLUDED.descripcion,
        factor      = EXCLUDED.factor,
        activo      = EXCLUDED.activo,
        costo       = EXCLUDED.costo,
        vineta      = EXCLUDED.vineta,
        descuento_1 = EXCLUDED.descuento_1,
        vip         = EXCLUDED.vip,
        clinica     = EXCLUDED.clinica,
        mayoreo     = EXCLUDED.mayoreo,
        premium     = EXCLUDED.premium,
        precio_7    = EXCLUDED.precio_7,
        updated_at  = EXCLUDED.updated_at
    WHERE (pp.descripcion, pp.factor, pp.activo, pp.costo, pp.vineta,
           pp.descuento_1, pp.vip, pp.clinica, pp.mayoreo, pp.premium, pp.precio_7)
          IS DISTINCT FROM
          (EXCLUDED.descripcion, EXCLUDED.factor, EXCLUDED.activo, EXCLUDED.costo,
           EXCLUDED.vineta, EXCLUDED.descuento_1, EXCLUDED.vip, EXCLUDED.clinica,
           EXCLUDED.mayoreo, EXCLUDED.premium, EXCLUDED.precio_7)
  RETURNING pp.product_id, pp.id_presentacion, pp.costo, pp.vineta, pp.descuento_1,
            pp.vip, pp.clinica, pp.mayoreo, pp.premium, pp.precio_7,
            pp.factor, pp.activo
),
cerradas AS (
  UPDATE public.product_precios_history h
     SET valid_until = now()
    FROM upserted u
   WHERE h.product_id      = u.product_id
     AND h.id_presentacion = u.id_presentacion
     AND h.valid_until IS NULL
  RETURNING 1
),
nuevas AS (
  INSERT INTO public.product_precios_history
    (product_id, id_presentacion, costo, vineta, descuento_1, vip, clinica,
     mayoreo, premium, precio_7, valid_from, valid_until)
  SELECT u.product_id, u.id_presentacion, u.costo, u.vineta, u.descuento_1,
         u.vip, u.clinica, u.mayoreo, u.premium, u.precio_7, now(), NULL
  FROM upserted u
  RETURNING 1
),
-- Una fila POR CAMPO que cambió, que es la forma que ya tienen las 1,667
-- existentes. El JOIN contra `previo` deja fuera a los productos nuevos: dar de
-- alta no es cambiar un precio, y sin esto un alta escribiría siete filas de
-- «cambio» con `valor_anterior` vacío.
changelog AS (
  INSERT INTO public.product_precios_changelog
    (product_id, id_presentacion, campo, valor_anterior, valor_nuevo, detected_at)
  SELECT u.product_id, u.id_presentacion, v.campo, v.anterior, v.nuevo, now()
    FROM upserted u
    JOIN previo p
      ON p.product_id = u.product_id AND p.id_presentacion = u.id_presentacion
   CROSS JOIN LATERAL (VALUES
      ('vineta',      p.vineta::text,      u.vineta::text),
      ('descuento_1', p.descuento_1::text, u.descuento_1::text),
      ('vip',         p.vip::text,         u.vip::text),
      ('clinica',     p.clinica::text,     u.clinica::text),
      ('mayoreo',     p.mayoreo::text,     u.mayoreo::text),
      ('premium',     p.premium::text,     u.premium::text),
      ('precio_7',    p.precio_7::text,    u.precio_7::text)
   ) AS v(campo, anterior, nuevo)
   WHERE v.anterior IS DISTINCT FROM v.nuevo
  RETURNING 1
),
-- El factor de un producto cambió (2026-10-15). La caja no lo cambia en la
-- misma fila: desactiva la presentación vieja y activa otra, así que cuenta
-- tanto un factor distinto como una fila que se prende o se apaga. El trabajo
-- —reescribir el historial, convertir el MIN·MAX— lo hace
-- procesar_cambios_de_factor() fuera de esta sentencia: la carga de precios no
-- puede tardar lo que tarda recalcular seis salas.
cambio_de_factor AS (
  INSERT INTO public.cambios_de_factor (erp_product_id)
  SELECT DISTINCT u.product_id
    FROM upserted u
    LEFT JOIN previo p
      ON p.product_id = u.product_id AND p.id_presentacion = u.id_presentacion
   WHERE ((p.product_id IS NULL AND u.activo)
          OR (p.product_id IS NOT NULL
              AND (p.factor IS DISTINCT FROM u.factor OR p.activo IS DISTINCT FROM u.activo)))
     AND NOT EXISTS (SELECT 1 FROM public.cambios_de_factor c
                      WHERE c.erp_product_id = u.product_id AND c.procesado_at IS NULL)
  RETURNING 1
)
SELECT count(*)::integer FROM upserted;
$function$;
