-- Promociones — las lecturas.
--
-- ── Por qué la consulta está escrita así, y no de la forma obvia ────────────
--
-- Se midieron TRES formas de contar lo vendido de una promoción de 5 productos
-- en un mes, con EXPLAIN (ANALYZE, TIMING OFF) contra producción:
--
--   entrando por producto, un renglón a la vez ............  248 ms × 5
--   una sola pasada con los renglones en un CTE de VALUES .. 1,145 ms
--   idem, acotando la fecha antes ..........................   930 ms
--   DOS CTE materializados + hash join .....................    72 ms   ← ésta
--
-- Las dos del medio pierden por lo mismo: el planificador estima el CTE de
-- renglones en 1 fila, elige nested loops, y aplica la FECHA DESPUÉS del join —
-- lee 9,725 renglones de venta para quedarse con 604, con una búsqueda por
-- clave primaria para cada uno. Materializar los dos lados (las facturas del
-- período por un lado, los renglones de esos productos por el otro) le da
-- cardinalidades reales y elige dos hash joins.
--
-- Es `plpgsql` y no `sql` A PROPÓSITO: una `LANGUAGE sql` con cláusula `SET`
-- nace con plan genérico y nunca ve un valor (regla 4 de CLAUDE.md). Y como el
-- plan bueno DEPENDE del rango de fechas, además se fuerza el plan
-- personalizado al final del archivo.
--
-- ── Los criterios que se heredan de `get_bono_meta_sala`, sin rediscutir ────
--   · venta válida: estado NOT IN ('NULA','DTE INVALIDADO EN MH') y que no sea
--     de las que no son venta de productos;
--   · quién vendió: sales_invoices.cod_vendedor → employees.code, ACTIVO;
--   · lo que no tiene dueño se muestra aparte y NO se reparte entre los demás.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- get_promocion — el detalle de una, con todo lo que la pantalla necesita
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER y no INVOKER: lee `sales_invoices`, cuya policy exige
-- `ventas` / `minmax_ver_costos` / `dash_top_productos`. Ningún cargo de sala
-- los tiene, así que por el camino ingenuo la lectura no falla — devuelve CERO
-- filas, y la pantalla mostraría la promoción sin una sola venta. Es la misma
-- trampa que costó $478.50 en el widget de la meta.
CREATE OR REPLACE FUNCTION public.get_promocion(p_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_promo  public.promociones%ROWTYPE;
    v_ini    date;
    v_fin    date;
    v_prods  integer[];
    v_out    json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_promo FROM public.promociones WHERE id = p_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    -- La vigencia de la promoción se DERIVA de sus renglones (decisión del
    -- usuario: extender un producto extiende la promoción).
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
     WHERE r.promocion_id = p_id;

    IF v_ini IS NULL THEN
        RETURN json_build_object(
            'id', v_promo.id, 'nombre', v_promo.nombre, 'estado', v_promo.estado,
            'nota', v_promo.nota, 'inicio', NULL, 'fin', NULL,
            'bonificaciones_activas', public.metas_bono_activo(to_char(now(), 'YYYY-MM')),
            'renglones', '[]'::json, 'vendedores', '[]'::json);
    END IF;

    WITH facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.cod_vendedor, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    ),
    items AS MATERIALIZED (
        SELECT ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    ),
    lineas AS (
        SELECT r.id AS renglon_id,
               f.id AS invoice_id,
               f.branch_id,
               f.cod_vendedor,
               f.fecha,
               -- Unidades BASE: para el avance contra el lote, que es lo único
               -- comparable con la factura de compra.
               (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric AS u_base,
               -- Unidades de PAGO: con «cualquier presentación» se paga por
               -- unidad; con una presentación elegida, el monto es POR esa
               -- presentación, así que se cuentan paquetes.
               CASE WHEN r.factor_unidades IS NULL
                    THEN (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
                    ELSE i.cantidad::numeric
               END AS u_pago
          FROM items i
          JOIN facturas f ON f.id = i.invoice_id
          JOIN public.promocion_renglon r
            ON r.promocion_id   = p_id
           AND r.erp_product_id = i.erp_product_id
           AND f.fecha BETWEEN r.inicio AND r.fin
           AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
         WHERE NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                            WHERE v.invoice_id = f.id)
    ),
    -- La tarifa VIGENTE a la fecha de cada venta. Acá vive «sin retroactividad»:
    -- una venta del día 3 se paga con la tarifa del día 3 aunque hoy sea otra.
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
    -- El bono se calcula POR TRAMO DE TARIFA y después se suma: así una venta
    -- de antes del cambio de monto se paga con el monto de antes.
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
          LEFT JOIN public.employees e
                 ON e.code = v.cod_vendedor AND e.status = 'ACTIVO'
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
                       coalesce(pr.vendido_base, 0)::int AS vendido_base,
                       coalesce(pr.vendido_pago, 0)::int AS vendido_pago,
                       coalesce(pr.documentos, 0)::int   AS documentos,
                       greatest(r.lote_total - coalesce(pr.vendido_base, 0), 0)::int AS queda,
                       CASE WHEN r.lote_total > 0
                            THEN round(coalesce(pr.vendido_base,0)::numeric / r.lote_total * 100, 1)
                       END AS pct,
                       tv.bono_vendedor, tv.bono_adm, tv.bono_bodega, tv.unidades_por_bono,
                       coalesce((SELECT sum(tvv.bono)      FROM totales_vendedor tvv WHERE tvv.renglon_id = r.id), 0) AS costo_vendedor,
                       coalesce((SELECT sum(tvv.fondo_adm) FROM totales_vendedor tvv WHERE tvv.renglon_id = r.id), 0) AS fondo_adm,
                       coalesce((SELECT sum(tvv.fondo_bod) FROM totales_vendedor tvv WHERE tvv.renglon_id = r.id), 0) AS fondo_bodega,
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
                  LEFT JOIN por_renglon pr ON pr.renglon_id = r.id
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
        -- Lo que no tiene dueño va aparte y NO se reparte entre los demás:
        -- mismo criterio que el bono de meta.
        'sin_dueno', (
            SELECT json_build_object(
                'unidades', coalesce(sum(tv.u_base), 0)::int,
                'monto',    round(coalesce(sum(tv.bono), 0), 2))
              FROM totales_vendedor tv WHERE tv.employee_id IS NULL)
    ) INTO v_out;

    RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.get_promocion(bigint) IS
  'El detalle de una promoción: renglones con su avance contra el lote, el reparto por sala y lo que habría ganado cada persona. DEFINER porque lee sales_invoices, cuya policy ningún cargo de sala cumple — por INVOKER devolvería cero ventas en silencio.';

-- El plan bueno depende del rango de fechas (72 ms contra 930 con el genérico),
-- así que no se puede reutilizar uno solo para todas las llamadas.
ALTER FUNCTION public.get_promocion(bigint) SET plan_cache_mode = 'force_custom_plan';

-- ─────────────────────────────────────────────────────────────────────────────
-- get_promociones — la lista, con lo justo para pintar las tarjetas
-- ─────────────────────────────────────────────────────────────────────────────
-- No calcula ventas: la lista de una vista con paginación no puede pagar el
-- cruce contra 618,464 renglones por cada tarjeta. El avance se ve al abrir.
CREATE OR REPLACE FUNCTION public.get_promociones(p_estado text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_out json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.inicio DESC NULLS LAST, x.nombre), '[]'::json)
      INTO v_out
      FROM (
        SELECT pm.id, pm.nombre, pm.estado, pm.nota, pm.created_at,
               r.inicio, r.fin, r.renglones, r.lote_total, r.abiertos,
               r.laboratorios
          FROM public.promociones pm
          LEFT JOIN LATERAL (
              SELECT min(rr.inicio) AS inicio,
                     max(rr.fin)    AS fin,
                     count(*)::int  AS renglones,
                     sum(rr.lote_total)::int AS lote_total,
                     count(*) FILTER (WHERE rr.estado = 'abierto')::int AS abiertos,
                     (SELECT json_agg(DISTINCT coalesce(lb.nombre,'Sin laboratorio'))
                        FROM public.promocion_renglon r2
                        JOIN public.products p2 ON p2.id = r2.erp_product_id
                        LEFT JOIN public.laboratorios lb ON lb.id = p2.laboratorio_id
                       WHERE r2.promocion_id = pm.id) AS laboratorios
                FROM public.promocion_renglon rr
               WHERE rr.promocion_id = pm.id
          ) r ON true
         WHERE p_estado IS NULL OR pm.estado = p_estado
      ) x;

    RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.get_promociones(text) IS
  'La lista de promociones con su vigencia derivada y el tamaño del lote. NO calcula ventas a propósito: el avance se ve al abrir una.';

REVOKE EXECUTE ON FUNCTION public.get_promocion(bigint)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_promociones(text)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_promocion(bigint)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_promociones(text)   TO authenticated, service_role;
