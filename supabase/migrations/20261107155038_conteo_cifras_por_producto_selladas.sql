SET lock_timeout = '5s';

-- Las cifras del conteo que se GUARDAN (lista de conteos, bitácora, PDF, app)
-- seguían contando como diferencia y como faltante lo que sólo cambió de lote:
-- el conteo de Salud 4 (2026-11-07) quedó sellado con «10 diferencias ·
-- faltante $22.59 · sobrante $22.59» con los cinco productos cuadrando.
-- Se guardan tres cifras por producto junto a las de siempre, que se quedan
-- porque son las dos mitades del ajuste que se aplica:
--   productos_con_diferencia — productos cuyo total (en unidades) no cuadra
--   renglones_reacomodo      — renglones con diferencia en productos que sí cuadran
--   valor_reacomodado        — dinero que sólo cambia de renglón; el faltante
--                              neto es valor_faltante − valor_reacomodado
-- Un solo juez: `conteo_cifras_por_producto`, que leen `recalcular_totales_conteo`
-- (lo sellado) y `get_conteo_resumen` (lo vivo). El dinero es el de cada pila
-- (`conteo_lineas_netas`), el mismo que ya sellaba `valor_faltante`; las
-- unidades del producto, con el `mult` de `get_conteo_products_page`.

ALTER TABLE public.conteos_inventario
  ADD COLUMN IF NOT EXISTS productos_con_diferencia integer,
  ADD COLUMN IF NOT EXISTS renglones_reacomodo integer,
  ADD COLUMN IF NOT EXISTS valor_reacomodado numeric;

-- Los conteos se leen por columna (sin SELECT de tabla). Las dos cuentas como
-- `total_diferencias`; el dinero NO: sale por `get_conteos_valor`, con permiso.
GRANT SELECT (productos_con_diferencia, renglones_reacomodo) ON public.conteos_inventario TO authenticated;

CREATE OR REPLACE FUNCTION public.conteo_cifras_por_producto(p_conteo_id uuid)
 RETURNS TABLE(productos_con_diferencia integer, renglones_reacomodo integer,
               faltante_neto numeric, sobrante_neto numeric, valor_reacomodado numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH neto AS MATERIALIZED (
    SELECT * FROM public.conteo_lineas_netas(p_conteo_id)
  ),
  it AS MATERIALIZED (
    SELECT ci.erp_product_id, ci.is_vencidos, ci.diferencia,
           nt.grupo_id, nt.neto_grupo, nt.costo_neto, nt.factor,
           bool_or(coalesce(nt.grupo_mixto, false))
             OVER (PARTITION BY ci.erp_product_id, ci.is_vencidos) AS prod_mixto
    FROM public.conteo_inventario_items ci
    LEFT JOIN neto nt ON nt.item_id = ci.id
    WHERE ci.conteo_id = p_conteo_id
  ),
  grupos AS (
    SELECT DISTINCT it.grupo_id, it.erp_product_id, it.is_vencidos, it.neto_grupo, it.costo_neto
    FROM it WHERE it.grupo_id IS NOT NULL
  ),
  dinero AS (
    SELECT g.erp_product_id, g.is_vencidos,
           coalesce(sum(greatest(-g.neto_grupo, 0) * coalesce(g.costo_neto, 0)), 0) AS f,
           coalesce(sum(greatest( g.neto_grupo, 0) * coalesce(g.costo_neto, 0)), 0) AS s
    FROM grupos g GROUP BY 1, 2
  ),
  unidades AS (
    SELECT it.erp_product_id, it.is_vencidos,
           coalesce(sum(it.diferencia * CASE WHEN it.prod_mixto THEN coalesce(it.factor, 1) ELSE 1 END), 0) AS neto_u,
           count(*) FILTER (WHERE it.diferencia IS NOT NULL AND it.diferencia <> 0
                              AND coalesce(it.neto_grupo, 0) <> 0) AS difs
    FROM it GROUP BY 1, 2
  ),
  prod AS (
    SELECT u.neto_u, u.difs, coalesce(d.f, 0) AS f, coalesce(d.s, 0) AS s
    FROM unidades u
    LEFT JOIN dinero d ON d.erp_product_id = u.erp_product_id AND d.is_vencidos = u.is_vencidos
  )
  SELECT count(*) FILTER (WHERE p.neto_u <> 0)::int,
         coalesce(sum(p.difs) FILTER (WHERE p.neto_u = 0), 0)::int,
         coalesce(sum(greatest(p.f - p.s, 0)), 0),
         coalesce(sum(greatest(p.s - p.f, 0)), 0),
         coalesce(sum(least(p.f, p.s)), 0)
  FROM prod p;
$function$;
-- INVOKER: la lee `get_conteo_resumen` (INVOKER) con la sesión del que mira,
-- y el RLS de los renglones sigue decidiendo — como `conteo_lineas_netas`.
REVOKE EXECUTE ON FUNCTION public.conteo_cifras_por_producto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteo_cifras_por_producto(uuid) TO authenticated, service_role;

-- Lo sellado: las tres cifras nuevas junto a las de siempre.
CREATE OR REPLACE FUNCTION public.recalcular_totales_conteo(p_conteo_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH neto AS MATERIALIZED (
    SELECT * FROM public.conteo_lineas_netas(p_conteo_id)
  ),
  grupos AS (
    SELECT DISTINCT n.grupo_id, n.neto_grupo, n.costo_neto FROM neto n
  ),
  dinero AS (
    SELECT COALESCE(SUM(GREATEST(-g.neto_grupo, 0) * COALESCE(g.costo_neto, 0)), 0) AS falt,
           COALESCE(SUM(GREATEST( g.neto_grupo, 0) * COALESCE(g.costo_neto, 0)), 0) AS sobra
    FROM grupos g
  ),
  renglones AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE ci.estado_item != 'PENDIENTE') AS contados,
           count(*) FILTER (WHERE ci.diferencia IS NOT NULL AND ci.diferencia != 0
                              AND COALESCE(nt.neto_grupo, 0) != 0) AS difs,
           count(*) FILTER (WHERE ci.recontado_at IS NOT NULL) AS recontados
    FROM public.conteo_inventario_items ci
    LEFT JOIN neto nt ON nt.item_id = ci.id
    WHERE ci.conteo_id = p_conteo_id
  ),
  cifras AS (
    SELECT * FROM public.conteo_cifras_por_producto(p_conteo_id)
  )
  UPDATE public.conteos_inventario c
  SET total_items = r.n,
      total_contados = r.contados,
      total_diferencias = r.difs,
      total_recontados = r.recontados,
      valor_faltante = d.falt,
      valor_sobrante = d.sobra,
      productos_con_diferencia = k.productos_con_diferencia,
      renglones_reacomodo = k.renglones_reacomodo,
      valor_reacomodado = k.valor_reacomodado
  FROM renglones r, dinero d, cifras k
  WHERE c.id = p_conteo_id;
$function$;

-- El valorizado de la lista, con lo que sólo cambió de lote.
CREATE OR REPLACE FUNCTION public.get_conteos_valor(p_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_sala bigint;
BEGIN
    IF NOT coalesce((SELECT public.auth_no_bloqueado()), false)
       OR NOT coalesce((SELECT public.auth_has_module_permission('conteo_inventario_ver_montos', 'can_view')), false)
       OR NOT coalesce((SELECT public.auth_has_module_permission('conteo_inventario', 'can_view')), false) THEN
        RETURN '[]'::json;
    END IF;
    IF (SELECT public.auth_module_scope('conteo_inventario')) IS DISTINCT FROM 'ALL' THEN
        v_sala := (SELECT public.auth_employee_branch_id());
    END IF;
    RETURN coalesce((
        SELECT json_agg(json_build_object('id', c.id, 'valor_faltante', c.valor_faltante,
                                          'valor_sobrante', c.valor_sobrante,
                                          'valor_reacomodado', c.valor_reacomodado))
          FROM public.conteos_inventario c
         WHERE c.id = ANY (p_ids)
           AND (v_sala IS NULL OR c.branch_id = v_sala)), '[]'::json);
END;
$function$;

-- Lo vivo: el resumen de la pantalla lee el mismo juez.
CREATE OR REPLACE FUNCTION public.get_conteo_resumen(p_conteo_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  -- Mismo predicado que las cinco RPCs de lectura: sin el permiso y con el
  -- conteo abierto, las cifras del sistema no salen de la base.
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_montos boolean;
BEGIN
  v_montos := v_ver AND (SELECT public.auth_has_module_permission('conteo_inventario_ver_montos', 'can_view'));
  RETURN (
    WITH it AS MATERIALIZED (
      SELECT ci.id, ci.erp_product_id, ci.is_vencidos, ci.estado_item, ci.recontado_at,
             ci.es_agregado_manual, ci.contado_por, ci.diferencia,
             (SELECT cc.costo_unitario FROM public.conteo_inventario_costos cc WHERE cc.item_id = ci.id) AS costo
      FROM public.conteo_inventario_items ci
      WHERE ci.conteo_id = p_conteo_id
    ),
    pr AS (
      SELECT * FROM public.conteo_cifras_por_producto(p_conteo_id)
    ),
    ag AS (
      SELECT
        count(*)::int                                                                  AS total_items,
        count(DISTINCT it.erp_product_id)::int                                         AS total_productos,
        count(*) FILTER (WHERE it.estado_item <> 'PENDIENTE')::int                     AS contados,
        count(*) FILTER (WHERE it.estado_item = 'PENDIENTE')::int                      AS pendientes,
        count(*) FILTER (WHERE it.estado_item = 'SIN_UBICAR')::int                     AS sin_ubicar,
        count(*) FILTER (WHERE it.recontado_at IS NOT NULL)::int                       AS recontados,
        count(*) FILTER (WHERE it.es_agregado_manual)::int                             AS agregados,
        count(DISTINCT it.contado_por)::int                                            AS contadores,
        count(DISTINCT it.erp_product_id)
          FILTER (WHERE it.estado_item = 'PENDIENTE' AND NOT it.is_vencidos)::int      AS pendientes_bodega,
        count(DISTINCT it.erp_product_id)
          FILTER (WHERE it.estado_item = 'PENDIENTE' AND it.is_vencidos)::int          AS pendientes_vencidos,
        count(DISTINCT it.erp_product_id) FILTER (WHERE NOT it.is_vencidos)::int       AS productos_bodega,
        count(DISTINCT it.erp_product_id) FILTER (WHERE it.is_vencidos)::int           AS productos_vencidos,
        count(*) FILTER (WHERE it.diferencia IS NOT NULL AND it.diferencia <> 0)::int AS con_diferencia_raw,
        COALESCE(SUM(GREATEST(-it.diferencia, 0) * COALESCE(it.costo, 0)), 0)          AS valor_faltante_raw,
        COALESCE(SUM(GREATEST( it.diferencia, 0) * COALESCE(it.costo, 0)), 0)          AS valor_sobrante_raw
      FROM it
    )
    SELECT to_json(t) FROM (
      SELECT ag.total_items, ag.total_productos, ag.contados, ag.pendientes, ag.sin_ubicar,
             ag.recontados, ag.agregados, ag.contadores, ag.pendientes_bodega, ag.pendientes_vencidos,
             ag.productos_bodega, ag.productos_vencidos,
             CASE WHEN v_ver THEN ag.con_diferencia_raw END        AS con_diferencia,
             CASE WHEN v_montos THEN ag.valor_faltante_raw END     AS valor_faltante,
             CASE WHEN v_montos THEN ag.valor_sobrante_raw END     AS valor_sobrante,
             CASE WHEN v_ver THEN pr.productos_con_diferencia END  AS productos_con_diferencia,
             CASE WHEN v_ver THEN pr.renglones_reacomodo END       AS renglones_reacomodo,
             CASE WHEN v_montos THEN pr.faltante_neto END          AS faltante_neto,
             CASE WHEN v_montos THEN pr.sobrante_neto END          AS sobrante_neto,
             CASE WHEN v_montos THEN pr.valor_reacomodado END      AS valor_reacomodado,
             v_ver                                                 AS ver_sistema
      FROM ag CROSS JOIN pr
    ) t
  );
END;
$function$;

-- Los conteos ya sellados: sólo las tres columnas nuevas, sin tocar las demás.
UPDATE public.conteos_inventario c
SET productos_con_diferencia = k.productos_con_diferencia,
    renglones_reacomodo = k.renglones_reacomodo,
    valor_reacomodado = k.valor_reacomodado
FROM public.conteos_inventario c2
CROSS JOIN LATERAL public.conteo_cifras_por_producto(c2.id) k
WHERE c.id = c2.id AND c.status IN ('FINALIZADO', 'CERRADO');
