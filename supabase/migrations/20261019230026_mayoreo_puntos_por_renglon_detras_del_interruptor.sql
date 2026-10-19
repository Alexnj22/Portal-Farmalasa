SET lock_timeout = '5s';
-- Mayoreo (2026-10-19) · Los puntos POR RENGLÓN del Cliente Mayorista y del
-- personal, detrás de `puntos_config.mayoreo_puntos_activo` (APAGADO).
--
-- Hasta hoy `ventas_elegibles_puntos` era todo-o-nada por factura
-- (`WHERE agg.todas`): un solo renglón por debajo del Preferente dejaba la
-- factura entera en cero. Para el consumidor ésa ES la regla (Reglamento v2:
-- «basta que una de ellas figure en el documento de venta para que esa compra
-- no acumule puntos») y no cambia. Para el Cliente Mayorista las Condiciones
-- §5 dicen otra cosa: lo de mayoreo da los puntos de su rango, lo de Preferente
-- 1 punto por US$1.00, y no tiene nivel de Puntos Salud. Y el personal (precio
-- Mayoreo Plus por política) perdía la compra entera por llevar algo a precio
-- de personal: con el interruptor encendido sólo deja de acumular ESE renglón.
--
-- Apagado, la función ejecuta la definición anterior letra por letra (rama
-- `IF NOT v_mayoreo`). Medido contra producción, 30 días (2026-09-19 a
-- 10-19), sin el filtro de lotes: consumidor 11,890 facturas / 158,912 puntos
-- en las dos versiones, 0 distintas; el personal gana 17 facturas / 91 puntos
-- que hoy pierde. Ventana del motor (3 días): 26 → 29 ms, 12,860 → 13,467
-- bloques. Probado en el branch de pruebas con 8 facturas sintéticas (Jade,
-- Plus, Zafiro, personal, consumidor mixto, debajo del precio asignado).
--
-- Encender: UPDATE public.puntos_config SET mayoreo_puntos_activo = true;

CREATE OR REPLACE FUNCTION public.ventas_elegibles_puntos(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 100000)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v json;
  -- Mayoreo (2026-10-19): el interruptor `puntos_config.mayoreo_puntos_activo`.
  -- Apagado, esta función hace EXACTAMENTE lo de antes: la rama de abajo es la
  -- definición anterior, letra por letra.
  v_mayoreo boolean := coalesce((SELECT c.mayoreo_puntos_activo FROM public.puntos_config c LIMIT 1), false);
BEGIN
  IF NOT v_mayoreo THEN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.customer_id, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND public.venta_valida(si.estado)
        -- Cláusula 3.2: «vale US$1.00 o más». El circuito viejo usa `> 1`.
        AND si.total >= 1
        AND si.cod_vendedor ~ '^[0-9]{1,9}$'
        AND coalesce(cu.acumula_puntos, true)
        -- Quien salió del programa desde «Mis puntos» no acumula (2026-09-28).
        AND cu.acepta_programa_puntos IS DISTINCT FROM false
        -- Sólo las que todavía NO tienen su lote (2026-10-05). El motor corre
        -- cada minuto sobre 3 días y `puntos_acumular` ya descartaba estas
        -- después — pero recién DESPUÉS de evaluar cada renglón contra el
        -- historial de precios. Lo marcó `gate:perf` sección F: ~31,700
        -- bloques por llamada en 4,594 llamadas. Mismo resultado: el índice
        -- único de `puntos_lote.invoice_id` ya impedía acreditar dos veces.
        AND NOT EXISTS (SELECT 1 FROM public.puntos_lote pl WHERE pl.invoice_id = si.id)
    ),
    pv AS (
      SELECT p.product_id, p.id_presentacion,
             upper(regexp_replace(coalesce(pr.tipo,'') || ' ' || coalesce(p.descripcion,''),
                                  '\s+', ' ', 'g')) AS pkey,
             p.vineta, p.descuento_1, p.vip
      FROM public.product_precios p
      LEFT JOIN public.presentaciones pr ON pr.id = p.id_presentacion
      WHERE p.activo
    ),
    lin AS (
      SELECT ii.invoice_id, ii.precio_unitario, ii.erp_product_id, inv.fecha,
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey,
             -- La lista por producto manda sobre el laboratorio (2026-09-28):
             -- chips y bebidas cargados en un laboratorio de farmacia.
             coalesce(lab.acumula_puntos, true)
               AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x
                                WHERE x.product_id = ii.erp_product_id) AS acumula
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
      LEFT JOIN public.products      prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios  lab ON lab.id = prd.laboratorio_id
    ),
    ok AS (
      SELECT lin.invoice_id, lin.acumula,
             EXISTS (
               SELECT 1
               FROM pv
               CROSS JOIN LATERAL (
                 SELECT coalesce(h.vineta,      pv.vineta)      AS p1,
                        coalesce(h.descuento_1, pv.descuento_1) AS p2,
                        coalesce(h.vip,         pv.vip)         AS p3
                 FROM (SELECT 1) z
                 LEFT JOIN LATERAL (
                   SELECT h2.vineta, h2.descuento_1, h2.vip
                   FROM public.product_precios_history h2
                   WHERE h2.product_id      = pv.product_id
                     AND h2.id_presentacion = pv.id_presentacion
                     AND h2.valid_from  <  (lin.fecha + 1)::timestamptz
                     AND (h2.valid_until IS NULL OR h2.valid_until >= lin.fecha::timestamptz)
                   ORDER BY h2.valid_from DESC
                   LIMIT 1
                 ) h ON true
               ) e
               WHERE pv.product_id = lin.erp_product_id
                 AND pv.pkey       = lin.pkey
                 AND coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) IS NOT NULL
                 AND lin.precio_unitario >=
                     coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) * (1 - p_margen)
             ) AS ok
      FROM lin
    ),
    agg AS (
      SELECT invoice_id,
             bool_and(ok)      AS todas,
             bool_or(acumula)  AS lleva_producto
      FROM ok GROUP BY 1
    )
    SELECT inv.id AS invoice_id, inv.sucursal, inv.erp_invoice_id, inv.correlativo,
           inv.customer_id, inv.cod_vendedor, inv.total, inv.fecha,
           -- «Por cada US$1.00 se otorga 1 punto. Las fracciones no acumulan.»
           floor(inv.total)::int AS puntos
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas AND agg.lleva_producto
    ORDER BY inv.fecha, inv.id
    LIMIT p_tope
  ) t;

  RETURN v;
  END IF;

  -- ── Encendido: por RENGLÓN para el Cliente Mayorista y el personal ───────
  -- Condiciones del Cliente Mayorista §5: lo comprado a su precio de mayoreo
  -- acumula los puntos de su RANGO por US$1.00 (Jade 0.25 · Zafiro 0.5 · Rubí
  -- 0.75 · Diamante 1); lo comprado a Preferente o más alto, 1 punto por
  -- US$1.00; no acumula lo vendido por debajo de su precio asignado, ni la
  -- telefonía, las bebidas, los helados y las paletas. No tiene nivel de
  -- Puntos Salud: `puntos_acumular` no le aplica el factor de nivel.
  -- El personal (precio Mayoreo Plus por política, sin ser mayorista): lo de
  -- Preferente acumula como a cualquier cliente y lo de precio de personal no
  -- acumula, pero ya NO deja la factura entera en cero.
  -- El consumidor sigue con el todo-o-nada: es la regla del Reglamento v2
  -- («basta que una de ellas figure en el documento de venta para que esa
  -- compra no acumule puntos»), y su cálculo es el MISMO de arriba.
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH emp AS (
      -- El personal activo, por DUI (la regla de `cliente_es_empleado`).
      SELECT DISTINCT regexp_replace(e.dui, '\D', '', 'g') AS dui
        FROM public.employees e
       WHERE e.status = 'ACTIVO' AND length(regexp_replace(coalesce(e.dui, ''), '\D', '', 'g')) = 9
    ),
    inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.customer_id, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha,
             cm.precio AS lista,
             (cm.customer_id IS NULL AND regexp_replace(coalesce(cu.dui, ''), '\D', '', 'g') IN (SELECT dui FROM emp)) AS personal
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
      LEFT JOIN public.clientes_mayoristas cm ON cm.customer_id = si.customer_id AND cm.estado = 'aprobado'
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND public.venta_valida(si.estado)
        AND si.total >= 1
        AND si.cod_vendedor ~ '^[0-9]{1,9}$'
        AND coalesce(cu.acumula_puntos, true)
        AND cu.acepta_programa_puntos IS DISTINCT FROM false
        AND NOT EXISTS (SELECT 1 FROM public.puntos_lote pl WHERE pl.invoice_id = si.id)
    ),
    pv AS (
      SELECT p.product_id, p.id_presentacion,
             upper(regexp_replace(coalesce(pr.tipo,'') || ' ' || coalesce(p.descripcion,''),
                                  '\s+', ' ', 'g')) AS pkey,
             p.vineta, p.descuento_1, p.vip, p.clinica, p.mayoreo
      FROM public.product_precios p
      LEFT JOIN public.presentaciones pr ON pr.id = p.id_presentacion
      WHERE p.activo
    ),
    lin AS (
      SELECT ii.invoice_id, ii.precio_unitario, ii.erp_product_id, inv.fecha, inv.lista,
             coalesce(ii.total_linea, 0) AS total_linea,
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey,
             coalesce(lab.acumula_puntos, true)
               AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x
                                WHERE x.product_id = ii.erp_product_id) AS acumula
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
      LEFT JOIN public.products      prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios  lab ON lab.id = prd.laboratorio_id
    ),
    ok AS (
      SELECT lin.invoice_id, lin.acumula, lin.total_linea,
             coalesce(e.ok, false) AS ok, coalesce(e.ok_lista, false) AS ok_lista
      FROM lin
      LEFT JOIN LATERAL (
        SELECT
          -- `ok`: la MISMA condición del todo-o-nada (Preferente o más alto).
          bool_or(coalesce(nullif(pz.p3,0), nullif(pz.p2,0), nullif(pz.p1,0)) IS NOT NULL
                  AND lin.precio_unitario >=
                      coalesce(nullif(pz.p3,0), nullif(pz.p2,0), nullif(pz.p1,0)) * (1 - p_margen)) AS ok,
          -- `ok_lista`: a su precio de mayoreo asignado o más (precio_de_lista,
          -- la misma regla del catálogo y del cobro de la app). Sin lista, no.
          bool_or(lin.lista IS NOT NULL
                  AND public.precio_de_lista(lin.lista, pz.p1, pz.p3, pz.p4, pz.p5) IS NOT NULL
                  AND lin.precio_unitario >=
                      public.precio_de_lista(lin.lista, pz.p1, pz.p3, pz.p4, pz.p5) * (1 - p_margen)) AS ok_lista
        FROM pv
        CROSS JOIN LATERAL (
          SELECT coalesce(h.vineta,      pv.vineta)      AS p1,
                 coalesce(h.descuento_1, pv.descuento_1) AS p2,
                 coalesce(h.vip,         pv.vip)         AS p3,
                 coalesce(h.clinica,     pv.clinica)     AS p4,
                 coalesce(h.mayoreo,     pv.mayoreo)     AS p5
          FROM (SELECT 1) z
          LEFT JOIN LATERAL (
            SELECT h2.vineta, h2.descuento_1, h2.vip, h2.clinica, h2.mayoreo
            FROM public.product_precios_history h2
            WHERE h2.product_id      = pv.product_id
              AND h2.id_presentacion = pv.id_presentacion
              AND h2.valid_from  <  (lin.fecha + 1)::timestamptz
              AND (h2.valid_until IS NULL OR h2.valid_until >= lin.fecha::timestamptz)
            ORDER BY h2.valid_from DESC
            LIMIT 1
          ) h ON true
        ) pz
        WHERE pv.product_id = lin.erp_product_id
          AND pv.pkey       = lin.pkey
      ) e ON true
    ),
    agg AS (
      SELECT invoice_id,
             bool_and(ok)                     AS todas,
             bool_or(acumula)                 AS lleva_producto,
             bool_or(acumula AND ok)          AS lleva_producto_ok,
             sum(total_linea) FILTER (WHERE ok)                              AS monto_ok,
             sum(total_linea) FILTER (WHERE acumula AND ok)                  AS monto_pref,
             sum(total_linea) FILTER (WHERE acumula AND NOT ok AND ok_lista) AS monto_mayoreo
      FROM ok GROUP BY 1
    ),
    cal AS (
      SELECT inv.*, agg.*,
             CASE WHEN inv.lista IS NOT NULL THEN 'mayorista'
                  WHEN inv.personal AND NOT agg.todas THEN 'personal'
                  ELSE 'consumidor' END AS regla,
             CASE WHEN inv.lista IS NOT NULL THEN public.mayorista_rango(inv.customer_id) END AS rango
      FROM inv JOIN agg ON agg.invoice_id = inv.id
    ),
    pts AS (
      SELECT cal.*,
             CASE cal.regla
               WHEN 'consumidor' THEN floor(cal.total)::int
               WHEN 'personal'   THEN floor(coalesce(cal.monto_ok, 0))::int
               ELSE floor(coalesce(cal.monto_pref, 0))::int
                    + floor(coalesce(cal.monto_mayoreo, 0)
                            * CASE cal.rango WHEN 'diamante' THEN 1 WHEN 'rubi' THEN 0.75
                                             WHEN 'zafiro' THEN 0.5 ELSE 0.25 END)::int
             END AS puntos,
             CASE WHEN cal.regla = 'mayorista' THEN floor(coalesce(cal.monto_mayoreo, 0)
                       * CASE cal.rango WHEN 'diamante' THEN 1 WHEN 'rubi' THEN 0.75
                                        WHEN 'zafiro' THEN 0.5 ELSE 0.25 END)::int END AS puntos_mayoreo
      FROM cal
    )
    SELECT pts.id AS invoice_id, pts.sucursal, pts.erp_invoice_id, pts.correlativo,
           pts.customer_id, pts.cod_vendedor, pts.total, pts.fecha, pts.puntos,
           pts.regla, pts.rango, pts.puntos_mayoreo,
           round(coalesce(pts.monto_mayoreo, 0), 2) AS monto_mayoreo
    FROM pts
    WHERE CASE pts.regla
            WHEN 'consumidor' THEN pts.todas AND pts.lleva_producto
            WHEN 'personal'   THEN pts.lleva_producto_ok
            ELSE true END
      AND pts.puntos > 0
    ORDER BY pts.fecha, pts.id
    LIMIT p_tope
  ) t;

  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_acumular(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 20000, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_leidas integer := 0; v_nuevas integer := 0; v_puntos bigint := 0;
  v_ya integer := 0; v_sin_ficha integer := 0;
  r record; v_lote bigint;
  v_nivel public.puntos_niveles; v_pts integer;
BEGIN
  -- El piso del arranque: lo anterior ya está en el historial migrado.
  p_desde := public.puntos_desde_efectivo(p_desde);
  IF p_desde > p_hasta THEN
    RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
      'leidas', 0, 'nuevas', 0, 'puntos', 0, 'ya_tenian_lote', 0, 'sin_ficha', 0,
      'tope_alcanzado', false, 'antes_del_inicio', true);
  END IF;

  FOR r IN
    SELECT * FROM json_to_recordset(
      public.ventas_elegibles_puntos(p_desde, p_hasta, p_margen, p_tope)
    ) AS x(invoice_id bigint, sucursal text, erp_invoice_id text, correlativo text,
           customer_id bigint, cod_vendedor int, total numeric, fecha date, puntos int,
           regla text, rango text, puntos_mayoreo int)
  LOOP
    v_leidas := v_leidas + 1;

    -- Sin ficha no hay a quién acreditarle. Medido: 0 de 4,009 en la semana de
    -- prueba, pero una venta sin cliente no puede tumbar la corrida.
    IF r.customer_id IS NULL THEN v_sin_ficha := v_sin_ficha + 1; CONTINUE; END IF;

    -- La exclusión propia del circuito nuevo: la bitácora vieja no se mira. El
    -- índice único sobre invoice_id lo garantiza igual; esto sólo evita el
    -- trabajo y deja el conteo limpio.
    IF EXISTS (SELECT 1 FROM public.puntos_lote WHERE invoice_id = r.invoice_id) THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;

    -- Cliente Mayorista (2026-10-19, Condiciones §5): una sola escalera, la
    -- de su rango, que ya viene calculada por renglón en `r.puntos`; no tiene
    -- nivel de Puntos Salud. `regla` sólo llega con `mayoreo_puntos_activo`:
    -- apagado es NULL y todo sigue como antes.
    IF r.regla = 'mayorista' THEN
      v_nivel := NULL;
      v_pts := r.puntos;
    ELSE
      -- El nivel (2026-10-07): lo comprado en los 12 meses hasta ese día, sin
      -- contar esta venta. «Las fracciones no acumulan»: hacia abajo.
      v_nivel := public.puntos_nivel_de(public.puntos_compra_12m(r.customer_id, r.fecha, r.invoice_id));
      v_pts := greatest(floor(r.puntos * coalesce(v_nivel.factor, 1))::int, r.puntos);
    END IF;

    v_nuevas := v_nuevas + 1;
    v_puntos := v_puntos + v_pts;
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.customer_id)
      ON CONFLICT (customer_id) DO NOTHING;

    INSERT INTO public.puntos_lote
      (customer_id, origen, invoice_id, sucursal, puntos, restantes, ganado_el, vence_el, puntos_base, nivel, motivo)
    VALUES (r.customer_id, 'venta', r.invoice_id, r.sucursal, v_pts, v_pts,
            r.fecha, public.puntos_vence_el(r.fecha), r.puntos,
            -- El mayorista no tiene nivel (NULL); su rango queda en el motivo.
            CASE WHEN r.regla = 'mayorista' THEN NULL ELSE coalesce(v_nivel.clave, 'vip') END,
            CASE r.regla WHEN 'mayorista' THEN 'Cliente Mayorista ' || CASE r.rango WHEN 'rubi' THEN 'Rubí' WHEN 'zafiro' THEN 'Zafiro' WHEN 'diamante' THEN 'Diamante' ELSE 'Jade' END
                           || ': ' || coalesce(r.puntos_mayoreo, 0) || ' pts a precio de mayoreo'
                         WHEN 'personal' THEN 'Personal: sólo lo comprado a precio Preferente' END)
    RETURNING id INTO v_lote;

    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_pts, ganados = ganados + v_pts, updated_at = now()
     WHERE customer_id = r.customer_id;
  END LOOP;

  RETURN json_build_object(
    'simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'leidas', v_leidas, 'nuevas', v_nuevas, 'puntos', v_puntos,
    'ya_tenian_lote', v_ya, 'sin_ficha', v_sin_ficha,
    'tope_alcanzado', v_leidas >= p_tope
  );
END;
$function$;
