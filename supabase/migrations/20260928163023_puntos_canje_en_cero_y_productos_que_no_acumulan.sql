SET lock_timeout = '5s';

-- ═══ Puntos: canje que deja la venta en $0, y productos que no acumulan ═════
-- Decisiones del usuario (2026-09-28):
--
--  1. «La venta no puede quedar a 0 ante un canje de puntos.» El canje se hace
--     en el sistema de ventas y el portal no lo puede impedir: lo registra y
--     AVISA a la sala y a supervisión (lo manda `puntos-motor`), y sale en la
--     pestaña Avisos. Medido: 40 de 550 canjes del último año dejaron la venta
--     en $0.00.
--
--  2. Productos que el reglamento excluye (telefonía, bebidas) pero que están
--     cargados en un laboratorio que sí acumula —chips en «5-INSUMOS» y
--     «TRINOMED», Pepsi en «EVENFLO», Jugo Petit en «TRINOMED»— hacían que una
--     compra de sólo eso acumulara. Van en `puntos_producto_no_acumula`, que
--     manda sobre el laboratorio. Tabla aparte y no una columna en `products`:
--     `products` es tabla caliente (CLAUDE.md, 2026-07-08).
--
--  Los convenios ya se excluyen por `customers.acumula_puntos` (hoy MAPFRE).
--  Todas las funciones reescritas desde su definición VIVA.

CREATE TABLE IF NOT EXISTS public.puntos_producto_no_acumula (
  product_id  bigint PRIMARY KEY,
  motivo      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.puntos_producto_no_acumula ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS puntos_producto_no_acumula_select ON public.puntos_producto_no_acumula;
CREATE POLICY puntos_producto_no_acumula_select ON public.puntos_producto_no_acumula FOR SELECT TO authenticated
  USING (true);
REVOKE ALL ON public.puntos_producto_no_acumula FROM anon;

INSERT INTO public.puntos_producto_no_acumula (product_id, motivo)
SELECT p.id, CASE WHEN upper(p.nombre) LIKE 'CHIP %' THEN 'telefonía' ELSE 'bebida' END
  FROM public.products p
 WHERE upper(p.nombre) ~ '^(CHIP (TIGO|MOVISTAR|CLARO|DIGICEL)|PEPSI|JUGO PETIT)'
ON CONFLICT (product_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ventas_elegibles_puntos(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 100000)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v json;
BEGIN
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
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_barrer_canjes(p_desde date, p_hasta date, p_simular boolean DEFAULT true, p_tope integer DEFAULT 500)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record; res json;
  v_vistas int := 0; v_registrados int := 0; v_puntos bigint := 0;
  v_sin_saldo int := 0; v_convenio int := 0; v_nada int := 0;
  v_avisos json[] := '{}';
  v_devueltos json;
  v_total numeric; v_doc text; v_sala text; v_en_cero int := 0;
BEGIN
  -- El piso del arranque: un canje anterior ya se descontó en el sistema
  -- anterior y viene en el historial migrado. Registrarlo acá lo cobraría dos
  -- veces.
  p_desde := public.puntos_desde_efectivo(p_desde);

  -- Primero se devuelve lo que se anuló después de registrado (2026-09-28): así
  -- el saldo ya está completo cuando llega la factura que lo reemplaza.
  v_devueltos := public.puntos_devolver_canjes_anulados(p_desde, p_hasta, p_simular);

  FOR r IN
    SELECT si.id FROM public.sales_invoices si
     WHERE si.fecha BETWEEN p_desde AND p_hasta
       AND si.has_puntos
       AND si.customer_id IS NOT NULL
       -- Sólo una venta válida canjea (2026-09-28): la anulada se rehace en
       -- otra factura, que trae el mismo canje.
       AND public.venta_valida(si.estado)
       AND NOT EXISTS (SELECT 1 FROM public.puntos_salida s
                        WHERE s.invoice_id = si.id AND s.tipo = 'canje')
     ORDER BY si.fecha, si.id
     LIMIT p_tope
  LOOP
    v_vistas := v_vistas + 1;
    res := public.puntos_registrar_canje(r.id, p_simular);
    IF (res->>'accion') = 'ninguna' THEN v_convenio := v_convenio + 1; CONTINUE; END IF;
    IF NOT coalesce((res->>'ok')::boolean, false) THEN v_nada := v_nada + 1; CONTINUE; END IF;
    v_registrados := v_registrados + 1;
    v_puntos := v_puntos + coalesce((res->>'puntos')::int, 0);
    -- Regla del usuario (2026-09-28): un canje no puede dejar la venta en
    -- $0.00. El portal no lo puede impedir —el canje se hace en el sistema de
    -- ventas—, así que lo avisa. El canje se registra igual: el descuento ya se
    -- dio y los puntos se usaron.
    SELECT si.total, si.correlativo, b.codigo_puntos INTO v_total, v_doc, v_sala
      FROM public.sales_invoices si LEFT JOIN public.branches b ON b.id = si.branch_id
     WHERE si.id = r.id;
    IF coalesce(v_total, 0) <= 0 THEN
      v_en_cero := v_en_cero + 1;
      IF v_en_cero <= 100 THEN
        v_avisos := v_avisos || json_build_object('tipo', 'venta_en_cero', 'invoice_id', r.id,
          'sucursal', v_sala, 'customer_id', (SELECT customer_id FROM public.sales_invoices WHERE id = r.id),
          'documento', v_doc, 'puntos', coalesce((res->>'puntos')::int, 0));
      END IF;
    END IF;
    IF coalesce((res->>'avisar')::boolean, false)
       OR (p_simular AND NOT coalesce((res->>'alcanza')::boolean, true)) THEN
      v_sin_saldo := v_sin_saldo + 1;
      IF v_sin_saldo <= 100 THEN v_avisos := v_avisos || coalesce(res->'aviso', res); END IF;
    END IF;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'vistas', v_vistas, 'registrados', v_registrados, 'puntos', v_puntos,
    'sin_saldo_suficiente', v_sin_saldo, 'de_convenio', v_convenio, 'sin_efecto', v_nada,
    'devueltos', v_devueltos, 'venta_en_cero', v_en_cero,
    'avisos', to_json(v_avisos), 'tope_alcanzado', v_vistas >= p_tope);
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_panel_avisos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los avisos de puntos.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(json_agg(x ORDER BY x.cuando DESC), '[]'::json) INTO v FROM (
    SELECT 'canje_sin_saldo' AS tipo, s.created_at AS cuando, s.customer_id, c.name AS cliente,
           coalesce(b.name, s.sucursal) AS sala, si.correlativo AS documento, si.id AS invoice_id,
           s.puntos AS puntos,
           nullif(substring(s.motivo FROM 'faltaron ([0-9]+) puntos'), '')::int AS faltaron
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.invoice_id IS NOT NULL AND s.motivo LIKE '%faltaron%'
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'anulada_con_puntos_gastados', g.created_at, g.customer_id, c.name,
           coalesce(b.name, g.sucursal), si.correlativo, si.id,
           g.no_recuperados, g.no_recuperados
      FROM public.puntos_anulacion_gastada g
      JOIN public.sales_invoices si ON si.id = g.invoice_id
      LEFT JOIN public.customers c ON c.id = g.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = g.sucursal
     WHERE g.created_at >= now() - interval '60 days'
    UNION ALL
    -- Regla del usuario (2026-09-28): un canje no puede dejar la venta en $0.00.
    SELECT 'canje_venta_en_cero', s.created_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int
      FROM public.puntos_salida s
      JOIN public.sales_invoices si ON si.id = s.invoice_id
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL AND si.total <= 0
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'canje_devuelto', s.revertida_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at >= now() - interval '60 days'
  ) x;
  RETURN v;
END;
$function$;
