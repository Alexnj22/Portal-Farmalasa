-- ═══════════════════════════════════════════════════════════════════════════
-- Reglamento v2 de Puntos Salud — 1 de 4: UNA fecha para todo (borrador 2026-10-24)
--
-- QUÉ CAMBIA
--   · `puntos_config.reglas_v2_desde date NOT NULL DEFAULT '2026-11-15'` y la
--     función `reglas_v2_desde()`: la ÚNICA fecha desde la que rige el v2. Las
--     demás tandas (reservas, mayorista) la leen.
--   · Niveles (cl. 4), factores, cumpleaños por nivel y lo del Cliente
--     Mayorista (puntos y beneficios) se encienden por esa fecha, no por los
--     interruptores. `niveles_activos`, `mayoreo_puntos_activo`,
--     `mayoreo_beneficios_activos`, `acumula_por_renglon_desde` y
--     `solo_personas_naturales_desde` quedan DEPRECADOS: ninguna función de
--     esta tanda los lee (se pueden borrar cuando nada más los lea; hoy el
--     portal y la app todavía los muestran — ver la migración 2).
--     Diseño elegido: `rige = fecha >= reglas_v2_desde()`, sin interruptor de
--     emergencia. Un booleano que «manda después de la fecha» vuelve a abrir la
--     puerta al encendido a mano que el usuario prohibió; la emergencia real es
--     mover la fecha (una fila: UPDATE puntos_config SET reglas_v2_desde = …),
--     que no es DDL y se revierte igual.
--   · `puntos_nivel_de(numeric, date)`: el nivel A ESA FECHA. La de un
--     argumento queda como atajo con el día de hoy en El Salvador.
--   · `ventas_elegibles_puntos`: rama v1 idéntica a la de hoy para facturas
--     antes de la fecha; rama v2 (la de «mayoreo encendido») para las de
--     después, con el CANJE corregido (cl. 3.3/3.4 v2): el renglón del canje
--     (producto 0) ya no descalifica la compra; sólo deja de acumular lo pagado
--     con puntos. Un rango que cruza la fecha se parte en dos.
--   · `puntos_acumular`, `puntos_dar_cumpleanos`, `puntos_subieron_de_nivel`:
--     el nivel con la fecha de la factura / del día.
--
-- DESDE CUÁNDO RIGE: facturas y días >= reglas_v2_desde() (2026-11-15).
--   Antes: idéntico a hoy (verificado comparando la salida v1 contra la
--   función vieja sobre el mismo rango).
--
-- TABLA CALIENTE: no. `puntos_config` es de una fila; el ALTER es instantáneo.
-- CÓMO SE VERIFICÓ: en staging (bbfotmyuvmrtmbuqxmhf) con execute_sql, casos
--   fabricados antes y después de la fecha (ver el informe de la tanda).
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

ALTER TABLE public.puntos_config
  ADD COLUMN IF NOT EXISTS reglas_v2_desde date NOT NULL DEFAULT DATE '2026-11-15';
COMMENT ON COLUMN public.puntos_config.reglas_v2_desde IS
  'Desde qué día rige el Reglamento v2 de Puntos Salud (y lo que cuelga de él: niveles, mayoreo, raspable, canje, reservas). Una sola fecha para todo; nada se enciende a mano.';
COMMENT ON COLUMN public.puntos_config.niveles_activos IS 'DEPRECADO (2026-10-24): rige reglas_v2_desde(). Ninguna función lo lee.';
COMMENT ON COLUMN public.puntos_config.mayoreo_puntos_activo IS 'DEPRECADO (2026-10-24): rige reglas_v2_desde(). Ninguna función lo lee.';
COMMENT ON COLUMN public.puntos_config.mayoreo_beneficios_activos IS 'DEPRECADO (2026-10-24): rige reglas_v2_desde(). Ninguna función lo lee.';
COMMENT ON COLUMN public.puntos_config.acumula_por_renglon_desde IS 'DEPRECADO (2026-10-24): rige reglas_v2_desde(). Ninguna función lo lee.';
COMMENT ON COLUMN public.puntos_config.solo_personas_naturales_desde IS 'DEPRECADO (2026-10-24): rige reglas_v2_desde(). Ninguna función lo lee.';

CREATE OR REPLACE FUNCTION public.reglas_v2_desde() RETURNS date LANGUAGE sql STABLE
SET search_path = public, extensions AS $$ SELECT reglas_v2_desde FROM public.puntos_config LIMIT 1 $$;
REVOKE EXECUTE ON FUNCTION public.reglas_v2_desde() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reglas_v2_desde() TO authenticated, service_role;

-- ── El nivel a una fecha ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_nivel_de(p_compra numeric, p_fecha date)
 RETURNS puntos_niveles
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Antes de `reglas_v2_desde()` todos están en el nivel de entrada (lo de
  -- hoy); desde ella, el de su compra de 12 meses (cl. 4.1).
  SELECT n.* FROM public.puntos_niveles n
   WHERE n.desde <= CASE WHEN p_fecha >= public.reglas_v2_desde()
                         THEN coalesce(p_compra, 0) ELSE 0 END
   ORDER BY n.desde DESC LIMIT 1;
$function$;
-- Los mismos permisos que la de un argumento: sólo el servidor.
REVOKE EXECUTE ON FUNCTION public.puntos_nivel_de(numeric, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_nivel_de(numeric, date) TO service_role;

CREATE OR REPLACE FUNCTION public.puntos_nivel_de(p_compra numeric)
 RETURNS puntos_niveles
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Atajo: el nivel HOY (El Salvador). Lo usan el panel y la app.
  SELECT * FROM public.puntos_nivel_de(p_compra, (now() AT TIME ZONE 'America/El_Salvador')::date);
$function$;

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
           -- «Por cada US$1.00 se otorga 1 punto. Las fracciones no acumulan.»
           -- Desde `v_renglon`, la parte del total que corresponde a lo que
           -- acumula: proporcional y no la suma de renglones, para que el IVA
           -- del crédito fiscal y la retención queden como en el total.
           CASE WHEN v_renglon IS NOT NULL AND inv.fecha >= v_renglon
                THEN floor(inv.total * agg.monto_acumula / nullif(agg.monto_todo, 0))::int
                ELSE floor(inv.total)::int END AS puntos
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas AND agg.lleva_producto
      -- Una mixta donde lo que acumula no llega a US$1.00 no da lote en cero.
      AND (v_renglon IS NULL OR inv.fecha < v_renglon
           OR floor(inv.total * agg.monto_acumula / nullif(agg.monto_todo, 0)) >= 1)
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
             -- El renglón del canje (producto 0): lo pagado con puntos. Medido
             -- 102 de 102 desde septiembre: todo canje lo trae y sólo el canje.
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
      SELECT lin.invoice_id, lin.acumula, lin.total_linea, lin.canje,
             -- El canje no es «otro descuento» (cl. 3.4): no descalifica la compra.
             coalesce(e.ok, false) OR lin.canje AS ok, coalesce(e.ok_lista, false) AS ok_lista
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
             sum(total_linea) FILTER (WHERE ok AND NOT canje)                AS monto_ok,
             sum(total_linea) FILTER (WHERE acumula AND ok)                  AS monto_pref,
             sum(total_linea) FILTER (WHERE acumula AND NOT ok AND ok_lista) AS monto_mayoreo,
             sum(total_linea) FILTER (WHERE acumula)                         AS monto_acumula,
             sum(total_linea) FILTER (WHERE NOT canje)                       AS monto_todo,
             coalesce(sum(total_linea) FILTER (WHERE canje), 0)              AS monto_canje
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
    -- Lo pagado con puntos sale de lo que acumula (cl. 6.2: el descuento va
    -- sobre los medicamentos e insumos, que son los que acumulan). Para el
    -- mayorista, primero de lo comprado a Preferente y el resto de lo de mayoreo.
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
                 -- `total` ya viene sin lo pagado con puntos; la proporción
                 -- (para el IVA del crédito fiscal y la retención) es sobre lo
                 -- que se pagó en dinero.
                 CASE WHEN v_renglon IS NOT NULL AND cal.fecha >= v_renglon
                      THEN coalesce(floor(cal.total * cal.acumula_neto
                                          / nullif(cal.monto_todo - cal.monto_canje, 0)), 0)::int
                      ELSE floor(cal.total)::int END
               WHEN 'personal'   THEN floor(cal.ok_neto)::int
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
           round(coalesce(pts.mayoreo_neto, 0), 2) AS monto_mayoreo
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
    -- nivel de Puntos Salud. `regla` sólo llega para facturas desde
    -- `reglas_v2_desde()`; antes es NULL y todo sigue como antes.
    IF r.regla = 'mayorista' THEN
      v_nivel := NULL;
      v_pts := r.puntos;
    ELSE
      -- El nivel (2026-10-07): lo comprado en los 12 meses hasta ese día, sin
      -- contar esta venta. «Las fracciones no acumulan»: hacia abajo.
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

CREATE OR REPLACE FUNCTION public.puntos_dar_cumpleanos(p_dia date DEFAULT NULL::date, p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dia date := coalesce(p_dia, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_pts integer;
  v_bisiesto boolean;
  v_may boolean;
  v_niveles boolean;
  v_rango text;
  r record; v_n integer := 0; v_total bigint := 0; v_n_may integer := 0;
  v_mios integer;
BEGIN
  -- Antes del arranque los regala el sistema anterior: dos a la vez daría dos.
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  SELECT puntos_cumpleanos INTO v_pts FROM public.puntos_config WHERE id;
  -- Reglamento v2 (2026-10-24): el cumpleaños por nivel (cl. 4.2) y el del
  -- Cliente Mayorista por rango rigen por FECHA, `reglas_v2_desde()`; ya no
  -- por los interruptores `niveles_activos` / `mayoreo_beneficios_activos`.
  -- Antes de la fecha: todos el del nivel de entrada, como siempre.
  v_niveles := v_dia >= public.reglas_v2_desde();
  v_may     := v_niveles;
  -- El regalo del nivel de entrada. Desde el 2026-10-19 vive en el nivel y
  -- `puntos_nivel_guardar` mantiene `puntos_config.puntos_cumpleanos` igual.
  v_pts := coalesce((SELECT n.puntos_cumpleanos FROM public.puntos_niveles n ORDER BY n.orden LIMIT 1), v_pts, 0);
  v_bisiesto := (date_part('year', v_dia)::int % 4 = 0 AND date_part('year', v_dia)::int % 100 <> 0)
                OR date_part('year', v_dia)::int % 400 = 0;

  FOR r IN
    SELECT c.id,
           (v_may AND EXISTS (SELECT 1 FROM public.clientes_mayoristas cm
                               WHERE cm.customer_id = c.id AND cm.estado = 'aprobado')) AS es_mayorista
      FROM public.customers c
     WHERE c.fecha_nacimiento IS NOT NULL
       AND coalesce(c.acumula_puntos, true)
       -- Tampoco se le regala a quien salió del programa (2026-09-28).
       AND c.acepta_programa_puntos IS DISTINCT FROM false
       -- Ni a una cuenta unida a otra (2026-10-15).
       AND NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc
                        WHERE pc.customer_id = c.id AND pc.fusionada_en IS NOT NULL)
       AND (to_char(c.fecha_nacimiento, 'MM-DD') = to_char(v_dia, 'MM-DD')
            -- El 29 de febrero, en un año que no lo tiene, cumple el 28.
            OR (NOT v_bisiesto AND to_char(v_dia, 'MM-DD') = '02-28'
                AND to_char(c.fecha_nacimiento, 'MM-DD') = '02-29'))
       -- Ya regalado este año (por el portal).
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l
                        WHERE l.customer_id = c.id AND l.origen = 'cumpleanos'
                          AND date_part('year', l.ganado_el) = date_part('year', v_dia))
       -- Ya regalado a mano en el sistema anterior en los últimos dos meses: la
       -- persona que los daba lo hacía en el mes del cumpleaños, a veces antes.
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l
                        WHERE l.customer_id = c.id AND l.motivo ILIKE 'cortes%cumple%'
                          AND l.ganado_el >= v_dia - 60)
  LOOP
    IF r.es_mayorista THEN
      -- Condiciones §5: Jade 50, Zafiro 75, Rubí y Diamante 100 (configurable).
      -- Sólo persona natural con fecha de nacimiento: la fecha es el filtro.
      v_rango := public.mayorista_rango(r.id);
      v_mios := coalesce((SELECT b.puntos_cumpleanos FROM public.puntos_mayoreo_beneficios b WHERE b.clave = v_rango), v_pts);
    ELSIF v_niveles THEN
      -- Según el nivel (2026-10-07), con la compra completa de 12 meses.
      v_mios := coalesce((public.puntos_nivel_de(public.puntos_compra_12m(r.id, v_dia), v_dia)).puntos_cumpleanos, v_pts);
    ELSE
      -- Apagados: todos en el nivel de entrada; no hace falta sumar la compra.
      v_mios := v_pts;
    END IF;
    CONTINUE WHEN coalesce(v_mios, 0) <= 0;
    v_n := v_n + 1;
    v_total := v_total + v_mios;
    IF r.es_mayorista THEN v_n_may := v_n_may + 1; END IF;
    CONTINUE WHEN p_simular;
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.id) ON CONFLICT (customer_id) DO NOTHING;
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.id, 'cumpleanos', v_mios, v_mios, v_dia, public.puntos_vence_el(v_dia), 'Cortesía Cumpleaños');
    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_mios, ganados = ganados + v_mios, updated_at = now()
     WHERE customer_id = r.id;
  END LOOP;

  RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', v_n, 'puntos', v_total,
                           'mayoristas', v_n_may);
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_subieron_de_nivel(p_invoices bigint[])
 RETURNS TABLE(customer_id bigint, invoice_id bigint, clave text, nombre text, antes text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v_v2 date := public.reglas_v2_desde();
BEGIN
  -- Reglamento v2 (2026-10-24): los niveles rigen por la FECHA DE LA FACTURA,
  -- desde `reglas_v2_desde()`; antes de ella nadie sube (todos en la entrada).
  -- Ya no se leen `niveles_activos` ni `mayoreo_beneficios_activos`.
  RETURN QUERY
  WITH v AS (
    SELECT si.id, public.puntos_titular(si.customer_id) AS c, si.fecha, coalesce(si.hora, '00:00'::time) AS hora
      FROM public.sales_invoices si
     WHERE si.id = ANY (p_invoices) AND public.venta_valida(si.estado)
       AND si.fecha >= v_v2
  ), m AS (
    SELECT v.id, v.c, v.fecha,
      (SELECT coalesce(sum(s.total), 0) FROM public.sales_invoices s
        WHERE s.customer_id = ANY (public.puntos_clientes_de(v.c))
          AND s.fecha > v.fecha - 365 AND s.fecha <= v.fecha AND public.venta_valida(s.estado)
          AND (s.fecha, coalesce(s.hora, '00:00'::time), s.id) < (v.fecha, v.hora, v.id)) AS compra_antes,
      (SELECT coalesce(sum(s.total), 0) FROM public.sales_invoices s
        WHERE s.customer_id = ANY (public.puntos_clientes_de(v.c))
          AND s.fecha > v.fecha - 365 AND s.fecha <= v.fecha AND public.venta_valida(s.estado)
          AND (s.fecha, coalesce(s.hora, '00:00'::time), s.id) <= (v.fecha, v.hora, v.id)) AS compra_despues
      FROM v
  )
  SELECT m.c, m.id, d.clave, d.nombre, a.clave
    FROM m
    CROSS JOIN LATERAL public.puntos_nivel_de(m.compra_antes, m.fecha) a
    CROSS JOIN LATERAL public.puntos_nivel_de(m.compra_despues, m.fecha) d
   WHERE d.orden > a.orden
     -- Un Cliente Mayorista aprobado no tiene nivel (Condiciones §5), cuando
     -- sus beneficios están encendidos.
     AND NOT (EXISTS (SELECT 1 FROM public.clientes_mayoristas cm
                                                 WHERE cm.customer_id = m.c AND cm.estado = 'aprobado'));
END $function$;
