SET lock_timeout = '5s';

-- ── El CTE `facturas` bajaba TODAS las facturas del rango ─────────────────
--
-- Medido el 2026-09-05 con UNA promoción de un producto y un mes:
-- `promocion_corte_del_lote` leía **9,498 bloques (74 MB) y tardaba ~1-2 s**
-- para devolver 30 filas. El CTE materializaba las 21,603 facturas de agosto
-- para quedarse con 64.
--
-- Y escala al revés de lo que uno esperaría: el ciclo diario la llama SIN
-- promoción, y el rango sale de `min(inicio)..max(fin)` de TODOS los renglones
-- — dos campañas en extremos del año materializan el año entero. Medido sobre
-- 12 meses y 12 productos: **Seq Scan de 268,222 facturas, 148 MB, con spill a
-- disco, 2,855 ms**.
--
-- La corrección es INVERTIR la dirección del join: entrar por los renglones de
-- venta —donde el producto filtra fuerte y hay índice
-- (`idx_sii_product_invoice`)— y buscar sus facturas por clave primaria, en vez
-- de barrer las facturas y descartar. Es el mismo hallazgo que ya está escrito
-- en CLAUDE.md sobre `EXISTS` correlacionado, en su versión de CTE
-- materializado.
--
-- Medido en las dos direcciones, que es lo que la regla exige antes de aceptar
-- una reescritura:
--   · un mes, 1 producto  : 6,436 → 1,864 bloques · 33.4 → 4.4 ms
--   · un año, 12 productos: 18,889 → 7,098 bloques · 2,855 → 1,482 ms, sin spill
--
-- **No cambia una sola línea del cálculo.** `facturas` sigue decidiendo qué
-- factura cuenta (mismo rango, mismos estados excluidos); lo único distinto es
-- que ya no mira las que ningún renglón puede referenciar.

CREATE OR REPLACE FUNCTION public.promocion_corte_del_lote(p_promocion_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(renglon_id bigint, promocion_id bigint, cod_vendedor text, employee_id uuid, branch_id bigint, u_dentro numeric, u_excedente numeric, monto_dentro numeric, monto_excedente numeric, fondo_adm numeric, fondo_bodega numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
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
    -- `items` PRIMERO: el producto filtra fuerte y tiene índice. `facturas`
    -- ahora sólo mira las que algún renglón referencia.
    WITH items AS MATERIALIZED (
        SELECT ii.id, ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    ),
    facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.cod_vendedor, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
           AND si.id IN (SELECT i2.invoice_id FROM items i2)
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

-- Lo mismo en `promocion_avance`, que es la que corre el ciclo diario. Es más
-- barata que su hermana —3,574 bloques contra 9,498— porque NO pide
-- `cod_vendedor`, así que `idx_si_fecha_estado_branch` la cubre. Aun así barre
-- el rango entero para quedarse con lo del producto.
CREATE OR REPLACE FUNCTION public.promocion_avance(p_solo_abiertos boolean DEFAULT true)
 RETURNS TABLE(renglon_id bigint, branch_id bigint, vendido numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_ini   date;
    v_fin   date;
    v_prods integer[];
BEGIN
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE NOT p_solo_abiertos
        OR (r.estado = 'abierto' AND pm.estado = 'activa');

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    WITH items AS MATERIALIZED (
        SELECT ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    ),
    facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
           AND si.id IN (SELECT i2.invoice_id FROM items i2)
    )
    SELECT r.id, f.branch_id,
           sum(i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
      FROM items i
      JOIN facturas f ON f.id = i.invoice_id
      JOIN public.promocion_renglon r
        ON r.erp_product_id = i.erp_product_id
       AND f.fecha BETWEEN r.inicio AND r.fin
       AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE (NOT p_solo_abiertos OR (r.estado = 'abierto' AND pm.estado = 'activa'))
       AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                        WHERE v.invoice_id = f.id)
     GROUP BY r.id, f.branch_id;
END;
$function$;
