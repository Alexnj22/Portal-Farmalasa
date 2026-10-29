-- Revisión de factor: el de→a sale del CATÁLOGO, no sólo de las ventas
-- (2026-10-29).
--
-- `procesar_cambios_de_factor` sabía de qué tamaño a qué tamaño cambió una
-- presentación mirando con qué factor se VENDIÓ antes y después. Un producto
-- que pasó de CAJA 1x1 a 1x24 sin haberse vendido nunca con el tamaño viejo
-- no dejaba rastro, y la existencia que quedó en la unidad vieja no se
-- ofrecía para corregir aunque el aviso saliera.
--
-- El dato estaba: la carga de precios VE el catálogo de antes al detectar el
-- cambio, y lo tiraba. Ahora guarda esa foto (`catalogo_antes`) y el proceso
-- la compara con el catálogo de ahora. Las ventas siguen mandando para
-- reescribir el historial y convertir el MIN·MAX; para la existencia manda el
-- catálogo, y si no hay foto (cambios viejos) se usa lo de antes.
SET lock_timeout = '5s';

ALTER TABLE public.cambios_de_factor ADD COLUMN IF NOT EXISTS catalogo_antes jsonb;
COMMENT ON COLUMN public.cambios_de_factor.catalogo_antes IS
  'Presentaciones activas del producto ({tipo, factor}) justo antes del cambio, tal como las vio la carga de precios.';

-- Parte de la definición VIVA del 2026-10-29. Cambia sólo `cambio_de_factor`:
-- además del producto, guarda las presentaciones activas de ANTES. Se leen en
-- esta misma sentencia, que comparte el snapshot previo a `upserted`.
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
--
-- `catalogo_antes` (2026-10-29): las presentaciones activas que el producto
-- tenía ANTES de esta carga. Es el de→a que usa la revisión de existencia
-- cuando no hay ventas con el tamaño viejo de donde sacarlo.
cambio_de_factor AS (
  INSERT INTO public.cambios_de_factor (erp_product_id, catalogo_antes)
  SELECT q.product_id,
         (SELECT jsonb_agg(jsonb_build_object('tipo', upper(trim(pr.tipo)), 'factor', pp.factor)
                           ORDER BY pr.tipo, pp.factor)
            FROM public.product_precios pp
            JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
           WHERE pp.product_id = q.product_id AND pp.activo AND pp.factor > 0)
    FROM (
      SELECT DISTINCT u.product_id
        FROM upserted u
        LEFT JOIN previo p
          ON p.product_id = u.product_id AND p.id_presentacion = u.id_presentacion
       WHERE ((p.product_id IS NULL AND u.activo)
              OR (p.product_id IS NOT NULL
                  AND (p.factor IS DISTINCT FROM u.factor OR p.activo IS DISTINCT FROM u.activo)))
         AND NOT EXISTS (SELECT 1 FROM public.cambios_de_factor c
                          WHERE c.erp_product_id = u.product_id AND c.procesado_at IS NULL)
    ) q
  RETURNING 1
)
SELECT count(*)::integer FROM upserted;
$function$;

-- Parte de la definición aplicada hoy en 20261029173744. Cambia: el de→a del
-- catálogo manda para la existencia y para el aviso cuando no hubo ventas.
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
             WHERE c.id = ANY(v_ids) AND c.erp_product_id = pr.id)         AS desde,
           cat.antes AS cat_de, cat.ahora AS cat_a, cat.tipo AS cat_tipo
      FROM unnest(v_productos) AS u(pid)
      JOIN public.products pr ON pr.id = u.pid
      LEFT JOIN _cf_linea l ON l.pid = u.pid
      -- El de→a del CATÁLOGO (2026-10-29): la foto de las presentaciones
      -- activas que guardó la carga de precios al detectar el cambio, contra
      -- las de ahora. Es el cambio de verdad y no depende de las ventas: un
      -- producto que pasó de 1x1 a 1x24 sin haberse vendido con el tamaño
      -- viejo no deja rastro en `_cf_linea`. Sólo un tipo con UN tamaño antes
      -- y UN tamaño ahora (si la caja dejó las dos prendidas, no se adivina),
      -- y sólo cambios de UNIDAD: 12→8 en un blíster no mueve la existencia.
      LEFT JOIN LATERAL (
        SELECT x.tipo, x.antes, y.ahora
          FROM (SELECT c.catalogo_antes FROM public.cambios_de_factor c
                 WHERE c.id = ANY(v_ids) AND c.erp_product_id = pr.id
                   AND c.catalogo_antes IS NOT NULL
                 ORDER BY c.id LIMIT 1) f
          CROSS JOIN LATERAL (
                SELECT e.tipo, min(e.factor) AS antes
                  FROM jsonb_to_recordset(f.catalogo_antes) AS e(tipo text, factor int)
                 GROUP BY e.tipo HAVING min(e.factor) = max(e.factor)) x
          JOIN (SELECT upper(trim(pre.tipo)) AS tipo, min(pp.factor) AS ahora
                  FROM public.product_precios pp
                  JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = pr.id AND pp.activo AND pp.factor > 0
                 GROUP BY 1 HAVING min(pp.factor) = max(pp.factor)) y ON y.tipo = x.tipo
         WHERE x.antes <> y.ahora AND (x.antes = 1 OR y.ahora = 1)
         ORDER BY x.tipo
         LIMIT 1) cat ON true
     GROUP BY pr.id, pr.nombre, cat.antes, cat.ahora, cat.tipo
  LOOP
    -- strip_nulls: un null de JSON no es un NULL de SQL, y el aviso pregunta por NULL.
    v_res := jsonb_strip_nulls(jsonb_build_object(
      'ventas_convertidas', p.reescritas,
      'ventas_sin_convertir', p.dudosas,
      'factor_antes', coalesce(p.cat_de, p.de),
      'factor_ahora', coalesce(p.cat_a, p.a),
      'presentacion', coalesce(p.cat_tipo, p.tipo),
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
      -- sentidos, tal como estaba AHORA. Con el de→a del catálogo, siempre:
      -- es el cambio que acaba de pasar. Con el de las ventas, sólo si es
      -- RECIENTE (se vendió con el tamaño viejo en los últimos 60 días): uno
      -- de hace un año ya se corrigió en la caja, y medido en la prueba,
      -- DOLACO —1x1 desde 2025— salía acusado en 3 salas.
      'existencia_por_corregir', CASE
                 WHEN p.cat_de IS NOT NULL THEN
                   nullif(public.existencia_por_corregir(p.id, p.cat_tipo, p.cat_de, p.cat_a, p.desde), '[]'::jsonb)
                 WHEN p.ultima_vieja >= CURRENT_DATE - 60 THEN
                   nullif(public.existencia_por_corregir(p.id, p.tipo, p.de, p.a, p.desde), '[]'::jsonb)
               END));

    UPDATE public.cambios_de_factor
       SET procesado_at = now(), resultado = v_res
     WHERE id = ANY(v_ids) AND erp_product_id = p.id;

    IF p.reescritas > 0 OR p.dudosas > 0 OR v_res ? 'existencia_por_corregir' THEN
      v_cuerpo := p.nombre || ': ';
      IF p.reescritas = 0 THEN
        -- Sin ventas que convertir: el aviso igual dice qué cambió.
        v_cuerpo := v_cuerpo || 'cambió el tamaño de su presentación (antes '
                 || (v_res->>'factor_antes') || ' por unidad de venta, ahora '
                 || (v_res->>'factor_ahora') || ').';
      ELSE
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

