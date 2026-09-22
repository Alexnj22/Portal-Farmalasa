-- Ventas: la búsqueda y el detalle de producto dejan de pagar el RLS fila por fila.
--
-- Medido el 2026-09-22 llamando COMO USUARIO (`authenticated`, que es como
-- llega el portal) y no como `postgres`, que se salta el RLS:
--
--                                            postgres   authenticated
--   buscar «EXFORGE HCT», un año                59 ms       15,143 ms
--   detalle de producto, un mes (bloques)       8,707          57,535
--   detalle de producto, un año (bloques)      73,879         683,904  (5.3 GB)
--
-- Producción lo confirmaba sin saberlo: `get_product_drill_summary` promediaba
-- 617,313 bloques por llamada —la que más lee de toda la base— y las 47
-- búsquedas del 21-sep morían por timeout. La migración 20260922145014 arregló
-- el plan de afuera, pero la medición se hizo como `postgres` y por eso no vio
-- que por la API la búsqueda seguía en 15 s.
--
-- El porqué es distinto en cada una y la salida es la misma:
--
--   · Búsqueda. `norm_search(col) LIKE …` usa `textlike`, que NO es
--     leakproof. Con RLS, Postgres no puede evaluar una condición no-leakproof
--     antes de la policy, así que no la deja entrar al índice de trigramas:
--     recorre las facturas del rango y llama a `norm_search` tres veces por fila.
--   · Detalle. Bajo la policy el planificador abandona `idx_sii_product_invoice`
--     (entrar por el producto: 5,500 bloques) y recorre los renglones de las
--     13,301 facturas del mes una por una (53,242).
--
-- Las tres pasan a SECURITY DEFINER y aplican el MISMO alcance que la policy
-- `sales_invoices_select` + `bloqueo_global`, escrito una sola vez en
-- `alcance_de_ventas()`. Comprobado antes de aplicar, con una cuenta de alcance
-- total y una de Salud 1 (scope BRANCH): la versión DEFINER devuelve el mismo
-- conjunto que la INVOKER bajo RLS (md5).
--
-- ⚠️ Si la policy `sales_invoices_select` cambia, `alcance_de_ventas()` cambia
-- con ella: son la misma regla dicha dos veces, y una sin la otra hace que la
-- búsqueda y el detalle vean distinto que la lista.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.alcance_de_ventas(OUT puede boolean, OUT sala integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
-- Quién puede ver qué facturas: lo mismo que `sales_invoices_select` y
-- `bloqueo_global`, para las funciones DEFINER que leen `sales_invoices` sin
-- pasar por el RLS. `sala` NULL = todas.
--
-- La policy es (ventas ∧ (ALL ∨ propia)) ∨ (minmax_ver_costos ∧ …) ∨
-- (dash_top_productos ∧ …), que se reordena en «alguno con ALL» o «alguno
-- con la sala propia».
DECLARE
  v_todas  boolean;
  v_alguno boolean;
BEGIN
  -- Sin JWT (cron, gates, una sesión directa) o con service_role: son los que
  -- ya se saltaban el RLS, y siguen viendo lo mismo que antes.
  IF coalesce(current_setting('request.jwt.claims', true), '') = ''
     OR (SELECT auth.role()) = 'service_role' THEN
    puede := true; sala := NULL; RETURN;
  END IF;

  IF NOT coalesce((SELECT public.auth_no_bloqueado()), false) THEN
    puede := false; sala := NULL; RETURN;
  END IF;

  v_todas :=
       (coalesce((SELECT public.auth_has_module_permission('ventas', 'can_view')), false)
        AND (SELECT public.auth_module_scope('ventas')) = 'ALL')
    OR (coalesce((SELECT public.auth_has_module_permission('minmax_ver_costos', 'can_view')), false)
        AND (SELECT public.auth_module_scope('minmax_ver_costos')) = 'ALL')
    OR (coalesce((SELECT public.auth_has_module_permission('dash_top_productos', 'can_view')), false)
        AND (SELECT public.auth_module_scope('dash_top_productos')) = 'ALL');
  v_alguno :=
       coalesce((SELECT public.auth_has_module_permission('ventas', 'can_view')), false)
    OR coalesce((SELECT public.auth_has_module_permission('minmax_ver_costos', 'can_view')), false)
    OR coalesce((SELECT public.auth_has_module_permission('dash_top_productos', 'can_view')), false);

  IF coalesce(v_todas, false) THEN
    puede := true; sala := NULL; RETURN;
  END IF;
  sala  := (SELECT public.auth_employee_branch_id());
  -- Sin sala propia, `branch_id = NULL` de la policy no deja pasar ninguna.
  puede := coalesce(v_alguno, false) AND sala IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.alcance_de_ventas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alcance_de_ventas() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_ventas_ids(p_search text, p_fini date DEFAULT NULL::date, p_ffin date DEFAULT NULL::date)
 RETURNS TABLE(id bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_pats  text[];
  v_first text;
  v_puede boolean;
  v_sala  integer;
BEGIN
  -- DEFINER para que el `LIKE` entre al índice de trigramas (ver el encabezado
  -- de la migración); el alcance del RLS lo pone `alcance_de_ventas()`.
  SELECT a.puede, a.sala INTO v_puede, v_sala FROM public.alcance_de_ventas() a;
  IF NOT coalesce(v_puede, false) THEN RETURN; END IF;

  SELECT array_agg('%' || tok || '%')
    INTO v_pats
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
   WHERE tok <> '';

  IF v_pats IS NULL THEN
    RETURN QUERY
    SELECT si.id
      FROM public.sales_invoices si
     WHERE (p_fini IS NULL OR si.fecha >= p_fini)
       AND (p_ffin IS NULL OR si.fecha <= p_ffin)
       AND (v_sala IS NULL OR si.branch_id = v_sala);
    RETURN;
  END IF;

  v_first := v_pats[1];

  RETURN QUERY
  SELECT si.id
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (v_sala IS NULL OR si.branch_id = v_sala)
     AND (
          (public.norm_search(si.erp_invoice_id) LIKE v_first
           AND public.norm_search(si.erp_invoice_id) LIKE ALL (v_pats))
       OR (public.norm_search(si.correlativo)    LIKE v_first
           AND public.norm_search(si.correlativo)    LIKE ALL (v_pats))
       OR (public.norm_search(si.cliente)        LIKE v_first
           AND public.norm_search(si.cliente)        LIKE ALL (v_pats))
     )
  UNION
  -- Las facturas que llevan un producto cuyo nombre tiene todas las palabras.
  SELECT si.id
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (v_sala IS NULL OR si.branch_id = v_sala)
     AND si.id IN (
           SELECT ii.invoice_id
             FROM public.sales_invoice_items ii
            WHERE ii.erp_product_id IN (
                  SELECT pr.id
                    FROM public.products pr
                   WHERE pr.nombre_norm LIKE v_first
                     AND pr.nombre_norm LIKE ALL (v_pats)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_product_drill_summary(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- DEFINER: bajo el RLS este detalle leía 5.3 GB en un año (ver el encabezado
-- de la migración). El alcance de la policy entra por `alc`, en el mismo CTE
-- que ya acota las facturas del período.
WITH alc AS MATERIALIZED (
  SELECT a.puede, a.sala FROM public.alcance_de_ventas() a
),
inv AS MATERIALIZED (
  SELECT si.id, si.branch_id, si.cod_vendedor, si.tipo_documento
  FROM public.sales_invoices si
  CROSS JOIN alc
  WHERE alc.puede
    AND si.fecha BETWEEN p_fini AND p_ffin
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    AND (alc.sala IS NULL OR si.branch_id = alc.sala)
),
lines AS MATERIALIZED (
  SELECT inv.branch_id, inv.cod_vendedor, sii.presentacion,
         sii.cantidad::numeric    AS cantidad,
         sii.total_linea::numeric AS total_linea,
         CASE WHEN inv.tipo_documento = 'CCF'
              THEN sii.total_linea::numeric
              ELSE sii.total_linea::numeric / 1.13
         END AS neto
  FROM inv
  JOIN public.sales_invoice_items sii ON sii.invoice_id = inv.id
  WHERE sii.erp_product_id = p_erp_product_id
),
-- factor por presentación: mismo heurístico que get_product_sales_agg, y
-- factor 0 = 1 (igual que el `|| 1` del cliente).
-- MATERIALIZED: sin eso se resuelve una vez por renglón, no por presentación.
fac AS MATERIALIZED (
  SELECT d.presentacion,
    COALESCE(NULLIF((
      SELECT pp.factor
      FROM public.product_precios pp
      JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
      WHERE pp.product_id = p_erp_product_id
        AND pp.activo = true
        AND UPPER(d.presentacion) LIKE UPPER(pr.tipo) || ' %'
      ORDER BY length(pr.tipo) DESC
      LIMIT 1
    ), 0), 1) AS factor
  FROM (SELECT DISTINCT presentacion FROM lines) d
),
con_factor AS MATERIALIZED (
  SELECT l.branch_id, l.cod_vendedor, l.cantidad * f.factor AS cantidad_base, l.neto, l.total_linea
  FROM lines l
  JOIN fac f ON f.presentacion IS NOT DISTINCT FROM l.presentacion
),
por_suc AS (
  SELECT branch_id, SUM(cantidad_base) AS cantidad_base, SUM(neto) AS neto
  FROM con_factor GROUP BY branch_id
),
-- Paso intermedio por (vendedor, sala) para poder elegir la sala donde MÁS
-- vendió, y de paso saber si vendió en más de una.
por_vend_suc AS (
  SELECT cod_vendedor, branch_id,
         SUM(cantidad_base) AS cantidad_base, SUM(neto) AS neto, count(*) AS ventas
  FROM con_factor GROUP BY cod_vendedor, branch_id
),
por_vend AS (
  SELECT cod_vendedor,
         SUM(cantidad_base) AS cantidad_base,
         SUM(neto)          AS neto,
         SUM(ventas)        AS ventas,
         count(*)           AS sucursales,
         (array_agg(branch_id ORDER BY neto DESC, branch_id))[1] AS branch_id
  FROM por_vend_suc GROUP BY cod_vendedor
)
SELECT json_build_object(
  'total_count',         (SELECT count(*) FROM lines),
  'total_cantidad_base', COALESCE((SELECT SUM(cantidad_base) FROM por_suc), 0),
  'total_display',       COALESCE((SELECT SUM(total_linea) FROM lines), 0),
  'por_sucursal',        COALESCE((SELECT json_agg(json_build_object(
                             'branch_id',     ps.branch_id,
                             'cantidad_base', ps.cantidad_base,
                             'neto',          ps.neto
                           ) ORDER BY ps.neto DESC, ps.branch_id) FROM por_suc ps), '[]'::json),
  'por_vendedor',        COALESCE((SELECT json_agg(json_build_object(
                             'cod_vendedor',  pv.cod_vendedor,
                             'cantidad_base', pv.cantidad_base,
                             'neto',          pv.neto,
                             'ventas',        pv.ventas,
                             'branch_id',     pv.branch_id,
                             'sucursales',    pv.sucursales
                           ) ORDER BY pv.neto DESC, pv.cod_vendedor) FROM por_vend pv), '[]'::json)
);
$function$;

CREATE OR REPLACE FUNCTION public.get_product_drill_lines(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS TABLE(item_id bigint, presentacion text, id_presentacion integer, cantidad numeric, precio_unitario numeric, neto numeric, invoice_id bigint, fecha date, erp_invoice_id text, correlativo text, cliente text, branch_id integer, tipo_documento text, cod_vendedor text, tipo_pago text, lote text, fecha_vencimiento date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    -- DEFINER, con el alcance de la policy en `alc`: ver el encabezado de la
    -- migración y `get_product_drill_summary`.
    WITH alc AS MATERIALIZED (
        SELECT a.puede, a.sala FROM public.alcance_de_ventas() a
    ),
    -- MATERIALIZED a propósito: sin eso el planificador vuelve a entrar por el
    -- producto y a preguntar por clave primaria factura por factura.
    inv AS MATERIALIZED (
        SELECT si.id, si.fecha
        FROM public.sales_invoices si
        CROSS JOIN alc
        WHERE alc.puede
          AND si.fecha BETWEEN p_fini AND p_ffin
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
          AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
          AND (alc.sala IS NULL OR si.branch_id = alc.sala)
    ),
    -- El recorte a 300 se hace con lo mínimo (id del renglón, id de la factura);
    -- las 17 columnas se buscan después, sólo para esas 300.
    top300 AS (
        SELECT sii.id AS item_id, inv.id AS inv_id
        FROM inv
        JOIN public.sales_invoice_items sii ON sii.invoice_id = inv.id
        WHERE sii.erp_product_id = p_erp_product_id
        ORDER BY inv.fecha DESC, inv.id DESC
        LIMIT 300
    )
    SELECT sii.id, sii.presentacion, sii.id_presentacion, sii.cantidad::numeric,
        CASE WHEN si.tipo_documento='CCF' THEN sii.precio_unitario::numeric ELSE sii.precio_unitario::numeric/1.13 END,
        CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea::numeric     ELSE sii.total_linea::numeric/1.13 END,
        si.id, si.fecha, si.erp_invoice_id, si.correlativo, si.cliente, si.branch_id,
        si.tipo_documento, si.cod_vendedor, si.tipo_pago, sii.lote, sii.fecha_vencimiento
    FROM top300
    JOIN public.sales_invoice_items sii ON sii.id = top300.item_id
    JOIN public.sales_invoices si       ON si.id  = top300.inv_id
    ORDER BY si.fecha DESC, si.id DESC;
$function$;
