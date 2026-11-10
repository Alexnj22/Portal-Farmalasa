-- Puntos: un producto SIN PRECIO en el portal ya no deja sin puntos la compra
-- entera (2026-11-10, usuario). Antes, en la rama v2, el consumidor exigía que
-- TODO renglón tuviera precio y estuviera a Preferente o más; un producto sin
-- precio (lo normal: uno nuevo cuyo precio aún no llegó) tumbaba la compra
-- (medido: 12 de 18,399 compras en 30 días). Ahora:
--   · la compra ESPERA 2 días (el motor relee 3 hacia atrás): si el precio
--     llega, acumula completa;
--   · si no, acumula sin ese producto (se descuenta como una bebida), el lote
--     lo dice en su motivo y `puntos-motor` avisa.
-- Sólo cambia la rama v2 (facturas desde reglas_v2_desde()). Parte de las
-- definiciones VIVAS (md5 c193d325… y la de puntos_acumular = 20261103165843).
-- Probado en el branch de pruebas: día −3 con un producto sin precio → 6 pts
-- base (antes 0); ayer → espera; ayer con el precio ya cargado → 23 completos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.ventas_elegibles_puntos(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 100000)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v json;
  -- Reglamento v2 (2026-10-24): TODO lo nuevo rige por UNA fecha,
  -- `reglas_v2_desde()` (2026-11-15). Antes de ella, esta función hace
  -- EXACTAMENTE lo de siempre (la rama v1 de abajo es la definición anterior,
  -- letra por letra, con el interruptor apagado). Desde ella, la rama v2: el
  -- cálculo por renglón (cl. 3.3), sólo personas naturales (cl. 2.2), el
  -- Cliente Mayorista por su rango, y el canje que ya no descalifica la compra
  -- (cl. 3.3: «tampoco acumula la parte de la compra pagada con puntos»).
  -- Los interruptores `mayoreo_puntos_activo`, `acumula_por_renglon_desde` y
  -- `solo_personas_naturales_desde` ya no se leen: la fecha es una sola.
  -- La regla se decide por la FECHA DE LA FACTURA, no por el día en que corre
  -- el motor: una compra del 14-nov acreditada el 15 sigue con la v1.
  v_v2 date := public.reglas_v2_desde();
  v_mayoreo boolean;
  v_renglon date;
  v_naturales date;
  v_p1 json; v_p2 json; v_n1 integer;
BEGIN
  -- Un rango que cruza la fecha se parte en dos: lo de antes con la v1, lo de
  -- después con la v2. El orden (fecha, id) se conserva: la v1 va primero.
  IF p_desde < v_v2 AND p_hasta >= v_v2 THEN
    v_p1 := public.ventas_elegibles_puntos(p_desde, v_v2 - 1, p_margen, p_tope);
    v_n1 := json_array_length(v_p1);
    v_p2 := CASE WHEN v_n1 < p_tope
                 THEN public.ventas_elegibles_puntos(v_v2, p_hasta, p_margen, p_tope - v_n1)
                 ELSE '[]'::json END;
    RETURN (SELECT coalesce(json_agg(x.e ORDER BY x.parte, x.n), '[]'::json) FROM (
              SELECT 1 AS parte, a.n, a.e FROM json_array_elements(v_p1) WITH ORDINALITY a(e, n)
              UNION ALL
              SELECT 2, b.n, b.e FROM json_array_elements(v_p2) WITH ORDINALITY b(e, n)) x);
  END IF;
  v_mayoreo   := p_desde >= v_v2;
  -- En la rama v2 toda factura es >= v_v2: estas dos condiciones son siempre
  -- verdaderas ahí y siempre inertes en la v1 (NULL = la regla vieja).
  v_renglon   := CASE WHEN v_mayoreo THEN v_v2 END;
  v_naturales := CASE WHEN v_mayoreo THEN v_v2 END;

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
        AND NOT (v_naturales IS NOT NULL AND si.fecha >= v_naturales
                 AND cu.tipo_persona IS NOT DISTINCT FROM 'juridica')
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
             coalesce(ii.total_linea, 0) AS total_linea,
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
      SELECT lin.invoice_id, lin.acumula, lin.total_linea,
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
             bool_or(acumula)  AS lleva_producto,
             sum(total_linea) FILTER (WHERE acumula) AS monto_acumula,
             sum(total_linea)                        AS monto_todo
      FROM ok GROUP BY 1
    )
    SELECT inv.id AS invoice_id, inv.sucursal, inv.erp_invoice_id, inv.correlativo,
           inv.customer_id, inv.cod_vendedor, inv.total, inv.fecha,
           CASE WHEN v_renglon IS NOT NULL AND inv.fecha >= v_renglon
                THEN floor(inv.total * agg.monto_acumula / nullif(agg.monto_todo, 0))::int
                ELSE floor(inv.total)::int END AS puntos
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas AND agg.lleva_producto
      AND (v_renglon IS NULL OR inv.fecha < v_renglon
           OR floor(inv.total * agg.monto_acumula / nullif(agg.monto_todo, 0)) >= 1)
    ORDER BY inv.fecha, inv.id
    LIMIT p_tope
  ) t;

  RETURN v;
  END IF;

  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH emp AS (
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
        AND NOT (v_naturales IS NOT NULL AND si.fecha >= v_naturales
                 AND cu.tipo_persona IS NOT DISTINCT FROM 'juridica')
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
             (ii.erp_product_id = 0) AS canje,
             ii.erp_product_id IS DISTINCT FROM 0
             AND coalesce(lab.acumula_puntos, true)
               AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x
                                WHERE x.product_id = ii.erp_product_id) AS acumula
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
      LEFT JOIN public.products      prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios  lab ON lab.id = prd.laboratorio_id
    ),
    ok AS (
      SELECT lin.invoice_id, lin.total_linea, lin.canje,
             lin.acumula AND coalesce(e.con_precio, false) AS acumula,
             -- Un producto SIN PRECIO en el portal (2026-11-10, usuario): no se
             -- puede saber a qué precio se vendió, así que no descalifica la
             -- compra (antes la tumbaba entera) ni acumula: se descuenta como
             -- una bebida. `sin_precio` lo marca para esperar y avisar.
             coalesce(e.ok, false) OR lin.canje
               OR (NOT lin.canje AND NOT coalesce(e.con_precio, false)) AS ok,
             coalesce(e.ok_lista, false) AS ok_lista,
             (NOT lin.canje AND NOT coalesce(e.con_precio, false)) AS sin_precio,
             lin.erp_product_id
      FROM lin
      LEFT JOIN LATERAL (
        SELECT
          bool_or(coalesce(nullif(pz.p3,0), nullif(pz.p2,0), nullif(pz.p1,0)) IS NOT NULL) AS con_precio,
          bool_or(coalesce(nullif(pz.p3,0), nullif(pz.p2,0), nullif(pz.p1,0)) IS NOT NULL
                  AND lin.precio_unitario >=
                      coalesce(nullif(pz.p3,0), nullif(pz.p2,0), nullif(pz.p1,0)) * (1 - p_margen)) AS ok,
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
             sum(total_linea) FILTER (WHERE ok AND NOT canje)                AS monto_ok,
             sum(total_linea) FILTER (WHERE acumula AND ok)                  AS monto_pref,
             sum(total_linea) FILTER (WHERE acumula AND NOT ok AND ok_lista) AS monto_mayoreo,
             sum(total_linea) FILTER (WHERE acumula)                         AS monto_acumula,
             sum(total_linea) FILTER (WHERE NOT canje)                       AS monto_todo,
             coalesce(sum(total_linea) FILTER (WHERE canje), 0)              AS monto_canje,
             count(*) FILTER (WHERE sin_precio)                              AS n_sin_precio,
             array_agg(DISTINCT erp_product_id) FILTER (WHERE sin_precio)    AS productos_sin_precio
      FROM ok GROUP BY 1
    ),
    cal AS (
      SELECT inv.*, agg.*,
             CASE WHEN inv.lista IS NOT NULL THEN 'mayorista'
                  -- El personal (Team) acumula 1 punto por $1 en CUALQUIER compra, a
                  -- cualquier precio (decisión del usuario 2026-11-03). Lo que no
                  -- acumula para nadie (productos y laboratorios marcados) tampoco
                  -- acumula para él, y lo pagado con puntos no suma.
                  WHEN inv.personal THEN 'personal'
                  ELSE 'consumidor' END AS regla,
             CASE WHEN inv.lista IS NOT NULL THEN public.mayorista_rango(inv.customer_id) END AS rango
      FROM inv JOIN agg ON agg.invoice_id = inv.id
    ),
    net AS (
      SELECT cal.*,
             greatest(coalesce(cal.monto_acumula, 0) - cal.monto_canje, 0)  AS acumula_neto,
             greatest(coalesce(cal.monto_ok, 0)      - cal.monto_canje, 0)  AS ok_neto,
             greatest(coalesce(cal.monto_pref, 0)    - cal.monto_canje, 0)  AS pref_neto,
             greatest(coalesce(cal.monto_mayoreo, 0)
                      - greatest(cal.monto_canje - coalesce(cal.monto_pref, 0), 0), 0) AS mayoreo_neto
      FROM cal
    ),
    pts AS (
      SELECT cal.*,
             CASE cal.regla
               WHEN 'consumidor' THEN
                 CASE WHEN v_renglon IS NOT NULL AND cal.fecha >= v_renglon
                      THEN coalesce(floor(cal.total * cal.acumula_neto
                                          / nullif(cal.monto_todo - cal.monto_canje, 0)), 0)::int
                      ELSE floor(cal.total)::int END
               WHEN 'personal'   THEN coalesce(floor(cal.total * cal.acumula_neto
                                                   / nullif(cal.monto_todo - cal.monto_canje, 0)), 0)::int
               ELSE floor(cal.pref_neto)::int
                    + floor(cal.mayoreo_neto
                            * CASE cal.rango WHEN 'diamante' THEN 1 WHEN 'rubi' THEN 0.75
                                             WHEN 'zafiro' THEN 0.5 ELSE 0.25 END)::int
             END AS puntos,
             CASE WHEN cal.regla = 'mayorista' THEN floor(cal.mayoreo_neto
                       * CASE cal.rango WHEN 'diamante' THEN 1 WHEN 'rubi' THEN 0.75
                                        WHEN 'zafiro' THEN 0.5 ELSE 0.25 END)::int END AS puntos_mayoreo
      FROM net cal
    )
    SELECT pts.id AS invoice_id, pts.sucursal, pts.erp_invoice_id, pts.correlativo,
           pts.customer_id, pts.cod_vendedor, pts.total, pts.fecha, pts.puntos,
           pts.regla, pts.rango, pts.puntos_mayoreo,
           round(coalesce(pts.mayoreo_neto, 0), 2) AS monto_mayoreo,
           pts.n_sin_precio::int AS sin_precio, pts.productos_sin_precio
    FROM pts
    WHERE CASE pts.regla
            WHEN 'consumidor' THEN pts.todas AND pts.lleva_producto
            WHEN 'personal'   THEN pts.lleva_producto
            ELSE true END
      AND pts.puntos > 0
      -- Con un producto sin precio, la compra ESPERA dos días (2026-11-10): lo
      -- normal es un producto nuevo cuyo precio todavía no llegó, y el motor
      -- relee 3 días hacia atrás cada minuto. Si en ese tiempo llega, acumula
      -- completa; si no, acumula sin ese producto y `puntos-motor` avisa.
      AND NOT (pts.n_sin_precio > 0
               AND pts.fecha > (now() AT TIME ZONE 'America/El_Salvador')::date - 2)
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
  v_sin_precio jsonb := '[]'::jsonb;
BEGIN
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
           regla text, rango text, puntos_mayoreo int, sin_precio int, productos_sin_precio bigint[])
  LOOP
    v_leidas := v_leidas + 1;
    IF r.customer_id IS NULL THEN v_sin_ficha := v_sin_ficha + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.puntos_lote WHERE invoice_id = r.invoice_id) THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;
    IF r.regla IN ('mayorista', 'personal') THEN
      -- El personal: siempre 1 punto por $1, sin factor de nivel (2026-11-03).
      v_nivel := NULL;
      v_pts := r.puntos;
    ELSE
      -- Desde el 2026-10-24 el nivel se pide CON la fecha de la factura: los
      -- niveles rigen desde `reglas_v2_desde()` (antes, todos en el de entrada).
      v_nivel := public.puntos_nivel_de(public.puntos_compra_12m(r.customer_id, r.fecha, r.invoice_id), r.fecha);
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
            CASE WHEN r.regla = 'mayorista' THEN NULL ELSE coalesce(v_nivel.clave, 'vip') END,
            nullif(concat_ws('. ',
            CASE r.regla WHEN 'mayorista' THEN 'Cliente Mayorista ' || CASE r.rango WHEN 'rubi' THEN 'Rubí' WHEN 'zafiro' THEN 'Zafiro' WHEN 'diamante' THEN 'Diamante' ELSE 'Jade' END
                           || ': ' || coalesce(r.puntos_mayoreo, 0) || ' pts a precio de mayoreo'
                         WHEN 'personal' THEN 'Personal: 1 punto por $1 en cualquier compra' END,
            -- El producto sin precio que no sumó queda dicho en el lote (2026-11-10).
            CASE WHEN coalesce(r.sin_precio, 0) > 0
                 THEN r.sin_precio || ' producto(s) sin precio no sumaron' END), ''))
    RETURNING id INTO v_lote;

    IF coalesce(r.sin_precio, 0) > 0 THEN
      v_sin_precio := v_sin_precio || jsonb_build_object(
        'invoice_id', r.invoice_id, 'sucursal', r.sucursal, 'documento', r.correlativo,
        'productos', to_jsonb(r.productos_sin_precio), 'puntos', v_pts);
    END IF;

    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_pts, ganados = ganados + v_pts, updated_at = now()
     WHERE customer_id = r.customer_id;
  END LOOP;

  RETURN json_build_object(
    'simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'leidas', v_leidas, 'nuevas', v_nuevas, 'puntos', v_puntos,
    'ya_tenian_lote', v_ya, 'sin_ficha', v_sin_ficha,
    'tope_alcanzado', v_leidas >= p_tope,
    -- Las compras que acumularon SIN un producto que no tenía precio: el motor avisa.
    'sin_precio', v_sin_precio
  );
END;
$function$;
