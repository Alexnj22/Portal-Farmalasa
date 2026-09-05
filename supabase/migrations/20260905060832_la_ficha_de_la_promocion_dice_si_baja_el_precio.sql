SET lock_timeout = '5s';

-- La ficha de una promoción dice si ya baja el precio, y en qué salas aplica.
--
-- Pedido del usuario el 2026-09-05: «el duplicar también permite descuento?».
-- La copia nace sin descuento a propósito —crearlo es escribir en el sistema de
-- ventas, y hacerlo en silencio dejaría precios bajos que nadie pidió— y el
-- aviso decía «se le agrega desde su propia ficha». **Eso era falso**: la
-- pantalla de corregir no tenía dónde, y la de descuentos sólo corrige los que
-- ya existen. O sea que una promoción duplicada no podía tener descuento nunca.
--
-- Para que la ficha pueda ofrecerlo necesita dos datos que no devolvía:
--   · `descuentos` — cuántos tiene. Si ya tiene, no se ofrece crear otro: el
--     sistema de ventas admite UNO por producto y ventana de fechas en toda la
--     cadena (medido cuatro veces el 2026-09-05), así que el segundo se
--     rechazaría.
--   · `salas` — en qué salas aplica, que sale del reparto. El descuento las
--     hereda igual que al crearla; sin esto la ficha tendría que volver a
--     preguntarlas y las dos respuestas podrían no coincidir.
--
-- Se agregan al `json_build_object` de las DOS salidas —la normal y la del
-- atajo de «sin renglones»—: una promoción recién duplicada y todavía vacía
-- sale por la segunda, y ahí el campo faltante se leería como «no tiene
-- descuento» en vez de como «no se sabe».
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
    v_prods  integer[];
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

    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
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
        SELECT r.id AS renglon_id, f.id AS invoice_id, f.branch_id,
               f.cod_vendedor, f.fecha,
               (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric AS u_base,
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
                       -- Lo que faltaba: «sólo mide» y «no vendió nada» se leían
                       -- igual, y sin el proveedor no se sabe a quién cobrarle.
                       r.tiene_bono,
                       r.paga,
                       sup.nombre AS proveedor,
                       coalesce(pr.vendido_base, 0)::int AS vendido_base,
                       coalesce(pr.vendido_pago, 0)::int AS vendido_pago,
                       coalesce(pr.documentos, 0)::int   AS documentos,
                       greatest(r.lote_total - coalesce(pr.vendido_base, 0), 0)::int AS queda,
                       CASE WHEN r.lote_total > 0
                            THEN round(coalesce(pr.vendido_base,0)::numeric / r.lote_total * 100, 1)
                       END AS pct,
                       tv.bono_vendedor, tv.bono_adm, tv.bono_bodega, tv.unidades_por_bono,
                       coalesce((SELECT sum(tvv.bono) FROM totales_vendedor tvv
                                  WHERE tvv.renglon_id = r.id
                                    AND tvv.employee_id IS NOT NULL), 0) AS costo_vendedor,
                       coalesce((SELECT sum(tvv.bono) FROM totales_vendedor tvv
                                  WHERE tvv.renglon_id = r.id
                                    AND tvv.employee_id IS NULL), 0) AS sin_dueno_monto,
                       coalesce((SELECT sum(tvv.u_base) FROM totales_vendedor tvv
                                  WHERE tvv.renglon_id = r.id
                                    AND tvv.employee_id IS NULL), 0)::int AS sin_dueno_unidades,
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
                  LEFT JOIN public.suppliers    sup ON sup.id = r.supplier_id
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
        'sin_dueno', (
            SELECT json_build_object(
                'unidades', coalesce(sum(tv.u_base), 0)::int,
                'monto',    round(coalesce(sum(tv.bono), 0), 2))
              FROM totales_vendedor tv WHERE tv.employee_id IS NULL)
    ) INTO v_out;

    RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_promocion(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_promocion(bigint) TO authenticated, service_role;
