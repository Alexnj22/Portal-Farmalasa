-- Auditoría de Promociones (2026-11-10). Ocho cosas, todas partiendo de la
-- definición VIVA de cada función (pg_get_functiondef), no de un archivo viejo.
--
--  1. `promocion_lineas`: las ventas que cuentan para cada renglón, escritas
--     UNA vez. Hasta hoy vivían copiadas en tres funciones y se habían
--     separado: `get_promocion` (la pantalla) no aplicaba las salas del
--     reparto y el pago sí — en «Leche y suplementos» (#33) la pantalla decía
--     668 unidades y el pago reconocía 76. Además las tres leían la historia
--     COMPLETA de cada producto; ahora una cerca de ids de factura (la misma
--     de `promocion_laboratorio_avance`) acota los renglones de venta al
--     período. Medido sobre todas las promociones: mismo resultado fila por
--     fila (53 pares renglón/sala, 513 unidades) y 11,265 bloques contra los
--     52,766 del corte y 17,362 del avance.
--  2. `promocion_avance`, `promocion_corte_del_lote` y `get_promocion` leen de
--     ahí. `get_promocion` además: el vendedor se reconoce por su código aunque
--     ya no esté activo (como el pago, H19), devuelve `supplier_id` en cada
--     renglón (la pantalla cruzaba el proveedor por su nombre) y las cinco
--     subconsultas por renglón sobre los totales pasan a un solo GROUP BY.
--  3. `rebajas_en_ventas`: la misma cerca sobre el índice parcial de rebajas,
--     que hoy se lee entero aunque se pidan 92 días como mucho.
--  4. `promociones_ciclo_diario` vuelve a registrar los excedentes de lote. La
--     llamada se perdió en 20260902030239 (reescribió el ciclo desde una base
--     anterior) y desde entonces `promociones_registrar_excedentes` no la
--     llamaba nadie. Hoy no hay ningún lote pasado, así que no se perdió nada.
--  5. Excedentes: quien ve Promociones con alcance de una sala ve sólo los de
--     su sala (decisión del usuario, 2026-11-10). Toda la red: todos.
--  6. Vínculos de descuento atómicos para `descuentos-erp` (leer el arreglo en
--     JavaScript y reescribirlo entero perdía un vínculo escrito en el medio).
--  7. `descuentos_espejo_borrar` (la copia se enteraba de un borrado recién en
--     el cron) y `promocion_descuentos` (los descuentos de una promoción desde
--     la copia: reactivar ya no le pregunta a la caja uno por uno).
--  8. Cuatro índices que duplican a otro.
SET lock_timeout = '5s';

-- ── 1 · Las líneas de venta de cada renglón ──────────────────────────────
CREATE OR REPLACE FUNCTION public.promocion_lineas(p_promocion_id bigint DEFAULT NULL,
                                                   p_solo_abiertos boolean DEFAULT false)
RETURNS TABLE(renglon_id bigint, promocion_id bigint, lote_total integer,
              invoice_id bigint, item_id bigint, branch_id bigint,
              cod_vendedor text, fecha date, u_base numeric, u_pago numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $function$
#variable_conflict use_column
DECLARE
    v_ini   date;
    v_fin   date;
    v_prods integer[];
BEGIN
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE (p_promocion_id IS NULL OR r.promocion_id = p_promocion_id)
       AND (NOT p_solo_abiertos OR (r.estado = 'abierto' AND pm.estado = 'activa'));

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    -- Facturas por fecha: SÓLO (id, branch_id, fecha) para que entre por Index
    -- Only Scan sobre `idx_si_fecha_estado_branch` (ver el encabezado viejo de
    -- `promocion_avance`). El vendedor se busca después, por la PK, sólo de
    -- las que cuentan.
    WITH facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND public.venta_valida(si.estado)
    ),
    -- La cerca: el id de factura sigue a la fecha, así que el rango de ids del
    -- período deja al índice (erp_product_id, invoice_id) leer sólo ese tramo.
    -- No decide qué cuenta —eso lo sigue haciendo el join—, sólo cuánto se lee.
    cerca AS MATERIALIZED (
        SELECT min(f.id) AS lo, max(f.id) AS hi FROM facturas f
    ),
    items AS MATERIALIZED (
        SELECT ii.id, ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
          CROSS JOIN cerca c
         WHERE ii.erp_product_id = ANY (v_prods)
           AND ii.invoice_id BETWEEN c.lo AND c.hi
    )
    SELECT r.id, r.promocion_id, r.lote_total,
           f.id, i.id, f.branch_id, si.cod_vendedor, f.fecha,
           (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric,
           CASE WHEN r.factor_unidades IS NULL
                THEN (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
                ELSE i.cantidad::numeric
           END
      FROM items i
      JOIN facturas f ON f.id = i.invoice_id
      JOIN public.promocion_renglon r
        ON r.erp_product_id = i.erp_product_id
       AND f.fecha BETWEEN r.inicio AND r.fin
       AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
       AND (p_promocion_id IS NULL OR r.promocion_id = p_promocion_id)
      JOIN public.promociones pm ON pm.id = r.promocion_id
      JOIN public.sales_invoices si ON si.id = f.id
     WHERE (NOT p_solo_abiertos OR (r.estado = 'abierto' AND pm.estado = 'activa'))
       AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                        WHERE v.invoice_id = f.id)
       -- Las salas donde APLICA: sin ninguna fila de reparto cuenta todas; con
       -- salas marcadas, una venta hecha fuera de ellas no cuenta.
       AND (NOT EXISTS (SELECT 1 FROM public.promocion_reparto pr0
                         WHERE pr0.renglon_id = r.id)
            OR EXISTS (SELECT 1 FROM public.promocion_reparto pr
                        WHERE pr.renglon_id = r.id AND pr.branch_id = f.branch_id));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.promocion_lineas(bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocion_lineas(bigint, boolean) TO service_role;

-- ── 2a · El avance (ciclo diario) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promocion_avance(p_solo_abiertos boolean DEFAULT true)
 RETURNS TABLE(renglon_id bigint, branch_id bigint, vendido numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
    -- Las líneas salen de `promocion_lineas`, la única definición de qué venta
    -- cuenta para qué renglón (la comparten la pantalla y el pago).
    RETURN QUERY
    SELECT l.renglon_id, l.branch_id, sum(l.u_base)::numeric
      FROM public.promocion_lineas(NULL, p_solo_abiertos) l
     GROUP BY l.renglon_id, l.branch_id;
END;
$function$;

-- ── 2b · El corte del lote (pagos y excedentes) ──────────────────────────
CREATE OR REPLACE FUNCTION public.promocion_corte_del_lote(p_promocion_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(renglon_id bigint, promocion_id bigint, cod_vendedor text, employee_id uuid, branch_id bigint, u_dentro numeric, u_excedente numeric, monto_dentro numeric, monto_excedente numeric, fondo_adm numeric, fondo_bodega numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
    RETURN QUERY
    -- Las líneas salen de `promocion_lineas` (salas del reparto incluidas).
    WITH lineas AS MATERIALIZED (
        SELECT l.renglon_id, l.promocion_id, l.lote_total, l.invoice_id, l.item_id,
               l.branch_id, l.cod_vendedor, l.fecha, l.u_base, l.u_pago
          FROM public.promocion_lineas(p_promocion_id, false) l
    ),
    -- La tarifa VIGENTE a la fecha de cada venta. Acá vive «sin retroactividad».
    con_tarifa AS (
        SELECT l.*, t.id AS tarifa_id, t.bono_vendedor, t.bono_adm, t.bono_bodega,
               greatest(coalesce(t.unidades_por_bono, 1), 1) AS upb
          FROM lineas l
          JOIN LATERAL (
              SELECT tt.id, tt.bono_vendedor, tt.bono_adm, tt.bono_bodega,
                     tt.unidades_por_bono
                FROM public.promocion_renglon_tarifa tt
               WHERE tt.renglon_id = l.renglon_id AND tt.desde <= l.fecha
               ORDER BY tt.desde DESC LIMIT 1
          ) t ON true
    ),
    ordenadas AS (
        SELECT c.*,
               sum(c.u_base) OVER (PARTITION BY c.renglon_id
                                   ORDER BY c.fecha, c.invoice_id, c.item_id
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acum
          FROM con_tarifa c
    ),
    partidas AS (
        SELECT o.*,
               greatest(least(o.u_base, o.lote_total - (o.acum - o.u_base)), 0) AS cabe
          FROM ordenadas o
    ),
    por_tramo AS (
        SELECT p.renglon_id, p.promocion_id, p.cod_vendedor, p.branch_id, p.tarifa_id,
               max(p.upb)           AS upb,
               max(p.bono_vendedor) AS monto,
               max(p.bono_adm)      AS monto_adm,
               max(p.bono_bodega)   AS monto_bod,
               sum(p.cabe)                                              AS u_base_dentro,
               sum(p.u_base - p.cabe)                                   AS u_base_fuera,
               sum(p.cabe              * (p.u_pago / nullif(p.u_base,0))) AS u_pago_dentro,
               sum((p.u_base - p.cabe) * (p.u_pago / nullif(p.u_base,0))) AS u_pago_fuera
          FROM partidas p
         GROUP BY p.renglon_id, p.promocion_id, p.cod_vendedor, p.branch_id, p.tarifa_id
    )
    SELECT t.renglon_id, t.promocion_id, t.cod_vendedor,
           e.id, t.branch_id,
           sum(t.u_base_dentro),
           sum(t.u_base_fuera),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto), 2),
           round(sum(floor(t.u_pago_fuera  / t.upb) * t.monto), 2),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto_adm), 2),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto_bod), 2)
      FROM por_tramo t
      -- H19: el código identifica a la ficha (único). Filtrar por ACTIVO de
      -- HOY borraba el bono ya ganado de quien renunció antes de cobrarlo.
      LEFT JOIN public.employees e
             ON e.code = t.cod_vendedor
     GROUP BY t.renglon_id, t.promocion_id, t.cod_vendedor, e.id, t.branch_id
    HAVING sum(t.u_base_dentro + t.u_base_fuera) > 0;
END;
$function$;

-- ── 2c · La pantalla de una promoción ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_promocion(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_promo  public.promociones%ROWTYPE;
    v_ini    date;
    v_fin    date;
    v_desc   int;
    v_salas  json;
    v_out    json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_promo FROM public.promociones WHERE id = p_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    v_desc := coalesce(array_length(v_promo.descuentos_erp, 1), 0);

    -- Las salas donde aplica, del reparto. Vacío = todas, que es como lo lee la
    -- pantalla y como lo escribió quien la creó.
    SELECT coalesce(json_agg(DISTINCT rep.branch_id), '[]'::json)
      INTO v_salas
      FROM public.promocion_reparto rep
      JOIN public.promocion_renglon r ON r.id = rep.renglon_id
     WHERE r.promocion_id = p_id;

    SELECT min(r.inicio), max(r.fin)
      INTO v_ini, v_fin
      FROM public.promocion_renglon r
     WHERE r.promocion_id = p_id;

    IF v_ini IS NULL THEN
        RETURN json_build_object(
            'id', v_promo.id, 'nombre', v_promo.nombre, 'estado', v_promo.estado,
            'nota', v_promo.nota, 'inicio', NULL, 'fin', NULL,
            'descuentos', v_desc, 'salas', v_salas,
            'bonificaciones_activas', public.metas_bono_activo(to_char(now(), 'YYYY-MM')),
            'renglones', '[]'::json, 'vendedores', '[]'::json);
    END IF;

    -- Las líneas salen de `promocion_lineas`: la pantalla cuenta EXACTAMENTE lo
    -- que cuenta el pago (salas del reparto incluidas). Hasta 2026-11-10 tenía
    -- su propia copia sin ese filtro y en #33 mostraba 668 unidades contra 76.
    WITH lineas AS MATERIALIZED (
        SELECT l.renglon_id, l.invoice_id, l.branch_id, l.cod_vendedor, l.fecha,
               l.u_base, l.u_pago
          FROM public.promocion_lineas(p_id, false) l
    ),
    con_tarifa AS (
        SELECT l.*, t.id AS tarifa_id, t.bono_vendedor, t.bono_adm,
               t.bono_bodega, t.unidades_por_bono
          FROM lineas l
          JOIN LATERAL (
              SELECT tt.* FROM public.promocion_renglon_tarifa tt
               WHERE tt.renglon_id = l.renglon_id AND tt.desde <= l.fecha
               ORDER BY tt.desde DESC LIMIT 1
          ) t ON true
    ),
    bono_por_tramo AS (
        SELECT renglon_id, cod_vendedor, tarifa_id,
               sum(u_pago) AS u_pago_tramo,
               max(unidades_por_bono) AS upb,
               max(bono_vendedor)     AS monto,
               max(bono_adm)          AS monto_adm,
               max(bono_bodega)       AS monto_bod
          FROM con_tarifa
         GROUP BY renglon_id, cod_vendedor, tarifa_id
    ),
    vendedor AS (
        SELECT b.renglon_id, b.cod_vendedor,
               sum(floor(b.u_pago_tramo / b.upb) * b.monto)     AS bono,
               sum(floor(b.u_pago_tramo / b.upb) * b.monto_adm) AS fondo_adm,
               sum(floor(b.u_pago_tramo / b.upb) * b.monto_bod) AS fondo_bod
          FROM bono_por_tramo b
         GROUP BY b.renglon_id, b.cod_vendedor
    ),
    totales_vendedor AS (
        SELECT v.renglon_id, v.cod_vendedor, v.bono, v.fondo_adm, v.fondo_bod,
               t.u_base, t.u_pago, t.documentos,
               e.id AS employee_id, e.name AS nombre, e.branch_id AS emp_branch
          FROM vendedor v
          JOIN (SELECT renglon_id, cod_vendedor,
                       sum(u_base) AS u_base, sum(u_pago) AS u_pago,
                       count(DISTINCT invoice_id) AS documentos
                  FROM con_tarifa GROUP BY renglon_id, cod_vendedor) t
            ON t.renglon_id = v.renglon_id AND t.cod_vendedor = v.cod_vendedor
          -- H19, igual que el corte: el código identifica a la ficha aunque ya
          -- no esté activa. Con `status = 'ACTIVO'` quien renunció salía «sin
          -- dueño» en la pantalla y con su bono en el pago.
          LEFT JOIN public.employees e
                 ON e.code = v.cod_vendedor
    ),
    -- Lo que antes eran cinco subconsultas por renglón sobre `totales_vendedor`.
    totales_renglon AS (
        SELECT renglon_id,
               sum(bono)   FILTER (WHERE employee_id IS NOT NULL) AS costo_vendedor,
               sum(bono)   FILTER (WHERE employee_id IS NULL)     AS sin_dueno_monto,
               sum(u_base) FILTER (WHERE employee_id IS NULL)     AS sin_dueno_unidades,
               sum(fondo_adm) AS fondo_adm,
               sum(fondo_bod) AS fondo_bodega
          FROM totales_vendedor GROUP BY renglon_id
    ),
    por_renglon AS (
        SELECT renglon_id,
               sum(u_base)                AS vendido_base,
               sum(u_pago)                AS vendido_pago,
               count(DISTINCT invoice_id) AS documentos
          FROM con_tarifa GROUP BY renglon_id
    ),
    por_sala AS (
        SELECT renglon_id, branch_id, sum(u_base) AS vendido
          FROM con_tarifa GROUP BY renglon_id, branch_id
    )
    SELECT json_build_object(
        'id',     v_promo.id,
        'nombre', v_promo.nombre,
        'estado', v_promo.estado,
        'nota',   v_promo.nota,
        'inicio', v_ini,
        'fin',    v_fin,
        'descuentos', v_desc,
        'salas',      v_salas,
        'bonificaciones_activas',
            public.metas_bono_activo(to_char(v_fin, 'YYYY-MM')),
        'renglones', coalesce((
            SELECT json_agg(to_json(x) ORDER BY x.laboratorio, x.producto)
              FROM (
                SELECT r.id,
                       r.erp_product_id,
                       p.nombre  AS producto,
                       coalesce(lb.nombre, 'Sin laboratorio') AS laboratorio,
                       r.factor_unidades,
                       r.inicio, r.fin, r.lote_total,
                       r.estado, r.cerrado_at, r.cerrado_motivo,
                       r.tiene_bono,
                       r.paga,
                       -- El id, no sólo el nombre: la pantalla cruzaba el
                       -- proveedor por su rótulo y una tilde lo hacía fallar.
                       r.supplier_id,
                       sup.nombre AS proveedor,
                       coalesce(pr.vendido_base, 0)::int AS vendido_base,
                       coalesce(pr.vendido_pago, 0)::int AS vendido_pago,
                       coalesce(pr.documentos, 0)::int   AS documentos,
                       greatest(r.lote_total - coalesce(pr.vendido_base, 0), 0)::int AS queda,
                       CASE WHEN r.lote_total > 0
                            THEN round(coalesce(pr.vendido_base,0)::numeric / r.lote_total * 100, 1)
                       END AS pct,
                       tv.bono_vendedor, tv.bono_adm, tv.bono_bodega, tv.unidades_por_bono,
                       coalesce(tr.costo_vendedor, 0)          AS costo_vendedor,
                       coalesce(tr.sin_dueno_monto, 0)         AS sin_dueno_monto,
                       coalesce(tr.sin_dueno_unidades, 0)::int AS sin_dueno_unidades,
                       coalesce(tr.fondo_adm, 0)               AS fondo_adm,
                       coalesce(tr.fondo_bodega, 0)            AS fondo_bodega,
                       coalesce((
                           SELECT json_agg(to_json(s) ORDER BY s.sala)
                             FROM (
                               SELECT rep.branch_id, b.name AS sala,
                                      rep.asignado_original, rep.asignado_vigente,
                                      coalesce(ps.vendido, 0)::int AS vendido,
                                      greatest(rep.asignado_vigente - coalesce(ps.vendido,0), 0)::int AS queda,
                                      CASE WHEN rep.asignado_vigente > 0
                                           THEN round(coalesce(ps.vendido,0)::numeric / rep.asignado_vigente * 100, 1)
                                      END AS pct,
                                      rep.avisado_80_at, rep.avisado_100_at
                                 FROM public.promocion_reparto rep
                                 JOIN public.branches b ON b.id = rep.branch_id
                                 LEFT JOIN por_sala ps
                                        ON ps.renglon_id = rep.renglon_id AND ps.branch_id = rep.branch_id
                                WHERE rep.renglon_id = r.id
                             ) s), '[]'::json) AS reparto
                  FROM public.promocion_renglon r
                  JOIN public.products p ON p.id = r.erp_product_id
                  LEFT JOIN public.laboratorios lb ON lb.id = p.laboratorio_id
                  LEFT JOIN public.suppliers    sup ON sup.id = r.supplier_id
                  LEFT JOIN por_renglon pr ON pr.renglon_id = r.id
                  LEFT JOIN totales_renglon tr ON tr.renglon_id = r.id
                  LEFT JOIN LATERAL (
                      SELECT tt.bono_vendedor, tt.bono_adm, tt.bono_bodega, tt.unidades_por_bono
                        FROM public.promocion_renglon_tarifa tt
                       WHERE tt.renglon_id = r.id
                       ORDER BY tt.desde DESC LIMIT 1
                  ) tv ON true
                 WHERE r.promocion_id = p_id
              ) x), '[]'::json),
        'vendedores', coalesce((
            SELECT json_agg(to_json(v) ORDER BY v.bono DESC NULLS LAST, v.nombre)
              FROM (
                SELECT tv.employee_id, tv.cod_vendedor,
                       coalesce(tv.nombre, 'Código ' || tv.cod_vendedor) AS nombre,
                       b.name AS sala,
                       sum(tv.u_base)::int     AS unidades,
                       sum(tv.documentos)::int AS documentos,
                       round(sum(tv.bono), 2)  AS bono,
                       (tv.employee_id IS NULL) AS sin_dueno
                  FROM totales_vendedor tv
                  LEFT JOIN public.branches b ON b.id = tv.emp_branch
                 GROUP BY tv.employee_id, tv.cod_vendedor, tv.nombre, b.name
              ) v), '[]'::json),
        'sin_dueno', (
            SELECT json_build_object(
                'unidades', coalesce(sum(tv.u_base), 0)::int,
                'monto',    round(coalesce(sum(tv.bono), 0), 2))
              FROM totales_vendedor tv WHERE tv.employee_id IS NULL)
    ) INTO v_out;

    RETURN v_out;
END;
$function$;

-- ── 3 · Rebajas en ventas: la misma cerca ────────────────────────────────
-- Cuerpo idéntico al vivo salvo `v_lo`/`v_hi` y la línea del candidato.
CREATE OR REPLACE FUNCTION public.rebajas_en_ventas(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  r json;
  v_lo bigint;
  v_hi bigint;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('promociones', 'can_view')) THEN
    RAISE EXCEPTION 'Sin permiso de Promociones.' USING ERRCODE = '42501';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 92 THEN
    RAISE EXCEPTION 'Rango inválido: hasta 92 días.' USING ERRCODE = '22023';
  END IF;

  -- La cerca (2026-11-10): el candidato se leía de TODA la historia del índice
  -- parcial aunque se pidan 92 días como mucho. El rango de ids de las
  -- facturas del período lo acota; quien decide qué cuenta sigue siendo el
  -- join con la fecha. Sin facturas en el período, la cerca es nula y no hay
  -- candidatos.
  SELECT min(si.id), max(si.id) INTO v_lo, v_hi
    FROM public.sales_invoices si
   WHERE si.fecha BETWEEN p_desde AND p_hasta;

  -- Se entra por los renglones candidatos (índice parcial
  -- `sales_invoice_items_con_rebaja_idx`, ~3,800 en toda la tabla) y no por
  -- las facturas del período: un mes eran 78K bloques por el otro lado, 4.8K
  -- por éste. El predicado del índice va escrito IGUAL para que lo use.
  WITH candidato AS MATERIALIZED (
    SELECT ii.id, ii.invoice_id, ii.erp_product_id, ii.descripcion, ii.presentacion,
           ii.cantidad, ii.precio_unitario, ii.total_linea
      FROM public.sales_invoice_items ii
     WHERE ii.total_linea < ii.precio_unitario * ii.cantidad - 0.02
       AND ii.erp_product_id <> 0
       AND ii.invoice_id BETWEEN v_lo AND v_hi
  ), renglon AS (
    SELECT ii.id, si.fecha, si.branch_id, si.correlativo, si.tipo_documento, si.cliente, si.cod_vendedor,
           ii.erp_product_id AS pid, ii.descripcion, ii.presentacion, ii.cantidad, ii.total_linea,
           CASE WHEN si.tipo_documento = 'CCF' THEN 1.13 ELSE 1 END AS iva,
           round(ii.precio_unitario * ii.cantidad / CASE WHEN si.tipo_documento = 'CCF' THEN 1.13 ELSE 1 END, 2) AS bruto
      FROM candidato ii
      JOIN public.sales_invoices si ON si.id = ii.invoice_id
     WHERE si.fecha BETWEEN p_desde AND p_hasta
       AND public.venta_valida(si.estado)
       AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
  ), rebaja AS (
    SELECT x.*, x.bruto - x.total_linea AS monto_rebaja
      FROM renglon x
     WHERE x.total_linea < x.bruto - 0.02
  ), clasificada AS (
    SELECT b.*, c.id AS campana_id, cerca.descripcion AS campana_cercana,
           cerca.motivo AS cercana_motivo, cerca.fin AS cercana_fin
      FROM rebaja b
      LEFT JOIN LATERAL (
        SELECT d.id FROM public.descuentos_espejo d
         WHERE b.pid = ANY (d.productos) AND b.fecha BETWEEN d.inicio AND d.fin
           AND (d.todas_las_salas OR d.branch_id = b.branch_id)
           AND abs(round(CASE WHEN d.tipo = '%' THEN b.bruto * d.monto / 100
                              ELSE d.monto * b.cantidad / b.iva END, 2) - b.monto_rebaja) <= 0.02
         ORDER BY d.id LIMIT 1) c ON true
      LEFT JOIN LATERAL (
        SELECT d.descripcion, d.fin,
               CASE WHEN b.fecha NOT BETWEEN d.inicio AND d.fin THEN 'fuera_de_fecha'
                    WHEN NOT (d.todas_las_salas OR d.branch_id = b.branch_id) THEN 'otra_sala'
                    ELSE 'otro_monto' END AS motivo
          FROM public.descuentos_espejo d
         WHERE c.id IS NULL AND b.pid = ANY (d.productos)
           AND (b.fecha BETWEEN d.inicio AND d.fin
                OR abs(round(CASE WHEN d.tipo = '%' THEN b.bruto * d.monto / 100
                                  ELSE d.monto * b.cantidad / b.iva END, 2) - b.monto_rebaja) <= 0.02)
         ORDER BY (b.fecha BETWEEN d.inicio AND d.fin) DESC, abs(b.fecha - d.fin), d.id
         LIMIT 1) cerca ON true
  )
  SELECT json_build_object(
    'resumen', (SELECT json_build_object(
        'campana', json_build_object('renglones', count(*) FILTER (WHERE campana_id IS NOT NULL),
                                     'monto', coalesce(sum(monto_rebaja) FILTER (WHERE campana_id IS NOT NULL), 0)),
        'a_mano',  json_build_object('renglones', count(*) FILTER (WHERE campana_id IS NULL),
                                     'monto', coalesce(sum(monto_rebaja) FILTER (WHERE campana_id IS NULL), 0)))
      FROM clasificada),
    'por_campana', (SELECT coalesce(json_agg(t ORDER BY t.rebajado DESC), '[]'::json) FROM (
        SELECT d.id, d.descripcion, d.tipo, d.monto, d.inicio, d.fin, d.borrado_at IS NOT NULL AS borrada,
               count(*) AS renglones, sum(k.cantidad) AS unidades,
               sum(k.total_linea) AS cobrado, sum(k.monto_rebaja) AS rebajado
          FROM clasificada k JOIN public.descuentos_espejo d ON d.id = k.campana_id
         GROUP BY d.id) t),
    'a_mano', (SELECT coalesce(json_agg(t ORDER BY t.fecha DESC, t.correlativo), '[]'::json) FROM (
        SELECT k.id, k.fecha, k.branch_id, k.correlativo, k.tipo_documento, k.cliente,
               e.id AS vendedor_id, e.name AS vendedor, k.descripcion AS producto, k.presentacion, k.cantidad,
               k.bruto AS precio, k.total_linea AS cobrado, k.monto_rebaja AS rebaja,
               round(100 * k.monto_rebaja / nullif(k.bruto, 0), 1) AS porcentaje, k.campana_cercana, k.cercana_motivo, k.cercana_fin
          FROM clasificada k
          LEFT JOIN LATERAL (SELECT e.id, e.name FROM public.employees e
                              WHERE e.code = k.cod_vendedor ORDER BY e.id LIMIT 1) e ON true
         WHERE k.campana_id IS NULL) t)
  ) INTO r;
  RETURN r;
END;
$function$;

-- ── 4 · El ciclo diario vuelve a registrar los excedentes ────────────────
-- Se edita la definición VIVA (24 KB) en tres puntos exactos, y si alguno no
-- está se corta: así no se pisa una versión que alguien cambió en el medio.
DO $do$
DECLARE
    d text := pg_get_functiondef('public.promociones_ciclo_diario'::regproc);
    a1 constant text := '    v_lab      integer := 0;';
    a2 constant text := '    v_lab := public.promociones_cerrar_meses_de_laboratorio();';
    a3 constant text := '    IF v_lab   > 0 THEN';
BEGIN
    IF position('promociones_registrar_excedentes' in d) > 0 THEN
        RAISE NOTICE 'el ciclo ya registra los excedentes';
        RETURN;
    END IF;
    IF position(a1 in d) = 0 OR position(a2 in d) = 0 OR position(a3 in d) = 0 THEN
        RAISE EXCEPTION 'promociones_ciclo_diario cambió: revisar antes de editar';
    END IF;
    d := replace(d, a1, a1 || E'\n' || '    v_exced    integer := 0;  -- tramos de excedente registrados o puestos al día');
    d := replace(d, a2,
          '    -- Los excedentes de lote: lo vendido por encima del lote queda por'
          || E'\n' || '    -- decidir en `promocion_excedente`. Se perdió en 20260902030239 al'
          || E'\n' || '    -- reescribir el ciclo; vuelve el 2026-11-10.'
          || E'\n' || '    v_exced := public.promociones_registrar_excedentes();'
          || E'\n\n' || a2);
    d := replace(d, a3,
          '    IF v_exced > 0 THEN v_salida := v_salida || ''excedentes=''         || v_exced || '' ''; END IF;'
          || E'\n' || a3);
    EXECUTE d;
END
$do$;

-- ── 5 · Excedentes: cada sala ve los suyos ───────────────────────────────
DROP POLICY IF EXISTS promocion_excedente_select ON public.promocion_excedente;
CREATE POLICY promocion_excedente_select ON public.promocion_excedente
  FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT public.auth_employee_id())
    OR ((SELECT public.auth_has_module_permission('promociones', 'can_view'))
        AND ((SELECT public.auth_module_scope('promociones')) = 'ALL'
             OR branch_id = (SELECT public.auth_employee_branch_id())))
  );

CREATE OR REPLACE FUNCTION public.get_excedentes(p_estado text DEFAULT 'por_decidir'::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_out   json;
    v_todo  boolean;
    v_sala  bigint;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    -- Con alcance de una sala, sólo los de su sala (2026-11-10). Los montos son
    -- de otras personas: no se muestran fuera de donde se ganaron.
    v_todo := public.auth_module_scope('promociones') = 'ALL';
    v_sala := public.auth_employee_branch_id();

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.created_at DESC), '[]'::json)
      INTO v_out
      FROM (
        SELECT ex.id, ex.unidades, ex.monto, ex.estado, ex.motivo,
               ex.decidido_at, ex.created_at,
               e.name  AS persona,
               b.name  AS sala,
               p.nombre AS producto,
               pm.id    AS promocion_id,
               pm.nombre AS promocion,
               r.lote_total,
               d.name  AS decidido_por
          FROM public.promocion_excedente ex
          JOIN public.promocion_renglon r  ON r.id  = ex.renglon_id
          JOIN public.promociones       pm ON pm.id = r.promocion_id
          JOIN public.products          p  ON p.id  = r.erp_product_id
          JOIN public.employees         e  ON e.id  = ex.employee_id
          LEFT JOIN public.branches     b  ON b.id  = ex.branch_id
          LEFT JOIN public.employees    d  ON d.id  = ex.decidido_por
         WHERE (p_estado IS NULL OR ex.estado = p_estado)
           AND (v_todo OR ex.branch_id = v_sala)
      ) x;

    RETURN v_out;
END;
$function$;

-- ── 6 · Vínculos de descuento atómicos (para `descuentos-erp`) ───────────
-- Leer `descuentos_erp` en JavaScript y reescribirlo entero perdía un vínculo
-- que el cron o la ventana escribieran entre la lectura y la escritura.
CREATE OR REPLACE FUNCTION public.promocion_agregar_descuento_erp(p_promocion bigint, p_descuento integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
    UPDATE public.promociones
       SET descuentos_erp = array_append(coalesce(descuentos_erp, '{}'), p_descuento),
           updated_at = now()
     WHERE id = p_promocion
       AND NOT (p_descuento = ANY (coalesce(descuentos_erp, '{}')));
    -- true = la promoción existe y el descuento queda ligado (ya estaba o se ligó).
    RETURN EXISTS (SELECT 1 FROM public.promociones WHERE id = p_promocion);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.promocion_agregar_descuento_erp(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocion_agregar_descuento_erp(bigint, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.promocion_soltar_descuento_erp(p_descuento integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE n integer;
BEGIN
    UPDATE public.promociones
       SET descuentos_erp = array_remove(descuentos_erp, p_descuento),
           updated_at = now()
     WHERE p_descuento = ANY (descuentos_erp);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.promocion_soltar_descuento_erp(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocion_soltar_descuento_erp(integer) TO service_role;

-- ── 7a · La copia se entera del borrado al momento ───────────────────────
CREATE OR REPLACE FUNCTION public.descuentos_espejo_borrar(p_id integer)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
    WITH u AS (
        UPDATE public.descuentos_espejo SET borrado_at = now(), updated_at = now()
         WHERE id = p_id AND borrado_at IS NULL
        RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM u);
$function$;
REVOKE EXECUTE ON FUNCTION public.descuentos_espejo_borrar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.descuentos_espejo_borrar(integer) TO service_role;

-- ── 7b · Los descuentos de una promoción, desde la copia ─────────────────
-- Reactivar pedía cada descuento a la caja (una llamada, con su login, por
-- descuento) sólo para mostrarlo; la escritura igual relee el origen antes de
-- tocar nada. Ligados y candidatos (mismo juez que el cron), con sus productos
-- ya nombrados. Un ligado que la copia no tiene vuelve con `en_copia = false`
-- y la pantalla lo pide a la caja.
CREATE OR REPLACE FUNCTION public.promocion_descuentos(p_id bigint)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_ligados integer[];
BEGIN
    IF NOT public.auth_has_module_permission('promociones', 'can_view') THEN
        RETURN NULL;
    END IF;
    SELECT coalesce(descuentos_erp, '{}') INTO v_ligados FROM public.promociones WHERE id = p_id;
    IF NOT FOUND THEN RETURN '[]'::json; END IF;

    RETURN (
        WITH quienes AS (
            SELECT x.id, true AS ligado, 1 AS candidatas
              FROM unnest(v_ligados) AS x(id)
            UNION ALL
            SELECT s.descuento_id, false, s.candidatas
              FROM public.promociones_descuentos_sin_ligar() s
             WHERE s.promocion_id = p_id AND NOT (s.descuento_id = ANY (v_ligados))
        )
        SELECT coalesce(json_agg(json_build_object(
                   'id', q.id, 'ligado', q.ligado, 'candidatas', q.candidatas,
                   'en_copia', d.id IS NOT NULL,
                   'borrado', d.borrado_at IS NOT NULL,
                   'descripcion', d.descripcion, 'tipo', d.tipo, 'monto', d.monto,
                   'inicio', d.inicio, 'fin', d.fin,
                   'todas_las_salas', d.todas_las_salas, 'branch_id', d.branch_id,
                   'productos', coalesce((
                       SELECT json_agg(json_build_object('id', pid, 'nombre', coalesce(p.nombre, 'Producto ' || pid))
                                       ORDER BY p.nombre)
                         FROM unnest(d.productos) AS u(pid)
                         LEFT JOIN public.products p ON p.id = u.pid), '[]'::json))
                 ORDER BY q.ligado DESC, q.id), '[]'::json)
          FROM quienes q
          LEFT JOIN public.descuentos_espejo d ON d.id = q.id
    );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.promocion_descuentos(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promocion_descuentos(bigint) TO authenticated, service_role;

-- ── 8 · Índices que duplican a otro ──────────────────────────────────────
-- (renglon_id, desde DESC) lo cubre el único (renglon_id, desde) recorrido al
-- revés; los otros tres son el prefijo de su índice único.
DROP INDEX IF EXISTS public.promocion_renglon_tarifa_renglon_idx;
DROP INDEX IF EXISTS public.idx_promocion_nivel_promo;
DROP INDEX IF EXISTS public.idx_promocion_laboratorio_promo;
DROP INDEX IF EXISTS public.idx_promocion_cierre_sala_promo;
