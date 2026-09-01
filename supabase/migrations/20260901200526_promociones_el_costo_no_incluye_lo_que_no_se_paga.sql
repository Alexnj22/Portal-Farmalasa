-- `costo_vendedor` estaba contando lo que NO se puede pagar.
--
-- La verificación con datos reales lo destapó: el renglón de ORFENAFLEX -D daba
-- costo_vendedor = $3,169.00 sobre 3,169 unidades, y adentro venían 10 unidades
-- ($10.00) cuyo código de vendedor no da con nadie activo. Por la regla que se
-- hereda del bono de meta, ese bono NO se paga y NO se reparte entre los demás
-- — así que sumarlo al costo miente sobre lo que la promoción cuesta.
--
-- Queda separado en tres números que no son el mismo:
--
--   costo_vendedor  lo que se pagaría a personas identificadas
--   sin_dueno       lo que se generó y no tiene a quién pagarse
--   fondo_adm/bod   NO se filtran: el fondo es del ÁREA, no de quien vendió.
--                   El producto salió igual, así que el aporte existe aunque no
--                   se sepa quién lo facturó.
--
-- Es la misma forma del bono de meta, que separa `pagado` de `no_pagado` en vez
-- de dar un total que nadie puede cobrar entero.
--
-- Medido después del cambio: $3,159.00 pagable + $10.00 sin dueño = $3,169.

SET lock_timeout = '5s';

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
                       -- Sólo lo que tiene a quién pagarse.
                       coalesce((SELECT sum(tvv.bono) FROM totales_vendedor tvv
                                  WHERE tvv.renglon_id = r.id
                                    AND tvv.employee_id IS NOT NULL), 0) AS costo_vendedor,
                       -- Lo generado que no se puede pagar, aparte.
                       coalesce((SELECT sum(tvv.bono) FROM totales_vendedor tvv
                                  WHERE tvv.renglon_id = r.id
                                    AND tvv.employee_id IS NULL), 0) AS sin_dueno_monto,
                       coalesce((SELECT sum(tvv.u_base) FROM totales_vendedor tvv
                                  WHERE tvv.renglon_id = r.id
                                    AND tvv.employee_id IS NULL), 0)::int AS sin_dueno_unidades,
                       -- Los fondos NO se filtran: son del área, no de quien
                       -- vendió. El producto salió igual.
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
  'El detalle de una promoción. `costo_vendedor` cuenta SÓLO lo que tiene a quién pagarse; lo que no tiene dueño va aparte y no se reparte. Los fondos de Administración y Bodega sí lo incluyen: son del área, no de quien vendió.';

ALTER FUNCTION public.get_promocion(bigint) SET plan_cache_mode = 'force_custom_plan';
