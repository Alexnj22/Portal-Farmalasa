-- El corte del lote respeta `unidades_por_bono`, como el resto del módulo.
--
-- ── La divergencia que esto cierra ──────────────────────────────────────────
-- Había DOS respuestas a «cuánto ganó esta persona por esta promoción»:
--
--   · `get_promocion` —lo que se ve en Seguimiento— paga por TRAMO:
--     `floor(unidades / unidades_por_bono) * bono_vendedor`. Con «1 bono cada
--     3 unidades», 8 unidades pagan 2 bonos, no 8/3.
--   · `promocion_corte_del_lote` —lo que decide qué es excedente— multiplicaba
--     `unidades * bono_vendedor` directo, sin tramo.
--
-- Las dos coinciden mientras `unidades_por_bono` valga 1, que es el valor por
-- defecto del formulario y el único que hay hoy en producción (medido: cero
-- tarifas con un valor mayor). O sea que la divergencia estaba dormida y se
-- despertaba el día que alguien negociara «1 bono cada 3»: la pantalla diría
-- un número y la liquidación pagaría otro, sin que nada fallara.
--
-- Se corrige acá y no en la otra porque ÉSTA es la que va a pagar: la Fase 5
-- liquida lo que quedó DENTRO del lote, y el excedente sólo si alguien lo
-- aprueba.
--
-- ── Lo que sí queda distinto, y es correcto ────────────────────────────────
-- `floor(dentro) + floor(excedente)` no siempre es `floor(dentro+excedente)`:
-- con 3 unidades por bono, 4 dentro y 2 fuera dan 1 + 0 = 1, y juntas darían 2.
-- Ese bono no se pierde por un descuido del calendario —como pasaría al partir
-- por mes— sino porque el laboratorio se comprometió a un lote y esas unidades
-- están de un lado y del otro de ese compromiso. El lote ES la frontera.
--
-- NOTA: esta función la reemplaza el mismo día 20260902034153, que le agrega
-- los fondos de Administración y Bodega. Se conserva tal cual se aplicó.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.promocion_corte_del_lote(p_promocion_id bigint DEFAULT NULL)
RETURNS TABLE (
    renglon_id      bigint,
    promocion_id    bigint,
    cod_vendedor    text,
    employee_id     uuid,
    branch_id       bigint,
    u_dentro        numeric,
    u_excedente     numeric,
    monto_dentro    numeric,
    monto_excedente numeric
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
        SELECT l.*, t.id AS tarifa_id, t.bono_vendedor,
               greatest(coalesce(t.unidades_por_bono, 1), 1) AS upb
          FROM lineas l
          JOIN LATERAL (
              SELECT tt.id, tt.bono_vendedor, tt.unidades_por_bono
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
           round(sum(floor(t.u_pago_fuera  / t.upb) * t.monto), 2)
      FROM por_tramo t
      LEFT JOIN public.employees e
             ON e.code = t.cod_vendedor AND e.status = 'ACTIVO'
     GROUP BY t.renglon_id, t.promocion_id, t.cod_vendedor, e.id, t.branch_id
    HAVING sum(t.u_base_dentro + t.u_base_fuera) > 0;
END;
$function$;

COMMENT ON FUNCTION public.promocion_corte_del_lote(bigint) IS
  'Parte lo vendido de cada persona en «dentro del lote» y «excedente», cortando en el orden en que se vendio. Una linea que cae sobre el corte se PRORRATEA, y el monto se paga por tramo de unidades_por_bono, igual que get_promocion.';

ALTER FUNCTION public.promocion_corte_del_lote(bigint) SET plan_cache_mode = 'force_custom_plan';

REVOKE EXECUTE ON FUNCTION public.promocion_corte_del_lote(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promocion_corte_del_lote(bigint) TO service_role;
