-- El corte del lote devuelve también los fondos de Administración y Bodega.
--
-- Los necesita la liquidación de la Fase 5, y tienen que salir de ACÁ y no de
-- `get_promocion`: el fondo se genera por las mismas unidades que el bono del
-- vendedor, así que si el bono se corta en el lote, el fondo también. Sacarlo
-- de la otra función —que no aplica el corte— pagaría fondo por unidades que
-- el laboratorio no cubrió, y la diferencia no aparecería en ningún lado
-- porque los dos números se ven en pantallas distintas.
--
-- El fondo NO se filtra por «tiene dueño», y eso es deliberado: es del ÁREA, no
-- de quien vendió. Una venta sin código de vendedor genera fondo igual.
--
-- Se agregan dos columnas al resultado, así que hay que DROP antes: un
-- `CREATE OR REPLACE` que cambia el tipo de retorno no reemplaza, falla. Su
-- único llamador —`promociones_registrar_excedentes`— pide columnas por nombre,
-- así que dos más no lo tocan.

SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.promocion_corte_del_lote(bigint);

CREATE FUNCTION public.promocion_corte_del_lote(p_promocion_id bigint DEFAULT NULL)
RETURNS TABLE (
    renglon_id      bigint,
    promocion_id    bigint,
    cod_vendedor    text,
    employee_id     uuid,
    branch_id       bigint,
    u_dentro        numeric,
    u_excedente     numeric,
    monto_dentro    numeric,
    monto_excedente numeric,
    fondo_adm       numeric,
    fondo_bodega    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_ini   date;
    v_fin   date;
    v_prods integer[];
BEGIN
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
     WHERE p_promocion_id IS NULL OR r.promocion_id = p_promocion_id;

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    WITH facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.cod_vendedor, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    ),
    items AS MATERIALIZED (
        SELECT ii.id, ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    ),
    lineas AS (
        SELECT r.id AS renglon_id, r.promocion_id, r.lote_total,
               f.id AS invoice_id, i.id AS item_id,
               f.branch_id, f.cod_vendedor, f.fecha,
               (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric AS u_base,
               CASE WHEN r.factor_unidades IS NULL
                    THEN (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
                    ELSE i.cantidad::numeric
               END AS u_pago
          FROM items i
          JOIN facturas f ON f.id = i.invoice_id
          JOIN public.promocion_renglon r
            ON r.erp_product_id = i.erp_product_id
           AND f.fecha BETWEEN r.inicio AND r.fin
           AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
           AND (p_promocion_id IS NULL OR r.promocion_id = p_promocion_id)
         WHERE NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                            WHERE v.invoice_id = f.id)
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
    -- El acumulado en el ORDEN en que se vendió. `item_id` desempata dos ventas
    -- del mismo día para que el corte sea estable entre corridas.
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
           -- Por TRAMO, como `get_promocion`: floor(unidades / cada cuántas) × monto.
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto), 2),
           round(sum(floor(t.u_pago_fuera  / t.upb) * t.monto), 2),
           -- Los fondos se generan SÓLO por lo que entró en el lote, igual que
           -- el bono. Lo de afuera no está acordado con nadie.
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto_adm), 2),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto_bod), 2)
      FROM por_tramo t
      LEFT JOIN public.employees e
             ON e.code = t.cod_vendedor AND e.status = 'ACTIVO'
     GROUP BY t.renglon_id, t.promocion_id, t.cod_vendedor, e.id, t.branch_id
    HAVING sum(t.u_base_dentro + t.u_base_fuera) > 0;
END;
$function$;

COMMENT ON FUNCTION public.promocion_corte_del_lote(bigint) IS
  'Parte lo vendido de cada persona en «dentro del lote» y «excedente», cortando en el orden en que se vendio. Prorratea la linea que cae sobre el corte, paga por tramo de unidades_por_bono igual que get_promocion, y devuelve los fondos de Administracion y Bodega generados por lo que entro en el lote.';

ALTER FUNCTION public.promocion_corte_del_lote(bigint) SET plan_cache_mode = 'force_custom_plan';

REVOKE EXECUTE ON FUNCTION public.promocion_corte_del_lote(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promocion_corte_del_lote(bigint) TO service_role;
